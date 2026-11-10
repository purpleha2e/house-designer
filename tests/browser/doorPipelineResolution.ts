import {BoxGeometry,Color,CubeCamera,DataUtils,HalfFloatType,LinearSRGBColorSpace,Mesh,MeshStandardMaterial,RGBAFormat,Scene,Vector3,WebGLCubeRenderTarget,WebGLRenderer} from 'three'
import {createIndirectField,writeIndirectPosition} from '../../src/indirectLighting'
import {createIndirectVisibility} from '../../src/indirectVisibility'
import {createIndirectUniforms,applyIndirectLightingShader,updateIndirectUniforms} from '../../src/indirectLightingShader'
import {createIndirectCaptureScene} from '../../src/indirectCaptureScene'
import {createIndirectSurfaceCache} from '../../src/indirectSurfaceCache'
import {createIndirectVolumeLookup,writeIndirectVolumeRow,sampleIndirectCoefficients} from '../../src/indirectVolume'
import {createIndirectFloorLookup,writeIndirectFloorLayer,indirectFloorConfidence} from '../../src/indirectFloorLighting'
import {snapshotReferenceScene} from './sceneReferenceSnapshot'
import {createSceneLightingReference} from '../sceneLightingReference'
import {indirectSHIrradianceBasis} from '../../src/indirectSH'

/** Disposable fixture; calls the existing capture, six-pass cached transport,
 * visibility lookup, floor and volume builders without changing their code. */
export async function doorResolution(){
 const renderer=new WebGLRenderer();renderer.setSize(64,64);document.body.append(renderer.domElement)
 const scene=new Scene(),white=new MeshStandardMaterial({color:new Color().setRGB(.65,.65,.65),roughness:1}),floorMaterial=white.clone();floorMaterial.color.setRGB(.35,.3,.25)
 const boxes:any[]=[]
 const box=(position:number[],size:number[],material=white,rotation=0)=>{const m=new Mesh(new BoxGeometry(...size as[number,number,number]),material);m.position.fromArray(position);m.rotation.y=rotation;scene.add(m);boxes.push({position,size,rotation});return m}
 box([2.5,-.05,2],[5,.1,4],floorMaterial);box([2.5,2.85,2],[5,.1,4]);box([0,1.4,2],[.1,2.8,4]);box([5,1.4,2],[.1,2.8,4]);box([2.5,1.4,4],[5,2.8,.1])
 box([2.5,1.4,.75],[.15,2.8,1.5]);box([2.5,1.4,3.25],[.15,2.8,1.5]);box([2.5,2.5,2],[.15,.6,1]);box([2.77,1.05,1.87],[.035,2.1,.85],white,.7)
 // Open front is the single sky aperture. No direct sun or ambient term.
 const floors=[{id:'room',elevation:0,height:2.8,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:0,y:4}]}]}]
 const points=[];for(let z=1.6;z<2.41;z+=.2)for(let i=0;i<=40;i++)points.push({name:`${z}-${i}`,position:[1.5+i*.05,.016,z],normal:[0,1,0],geometricNormal:[0,0,0]})
 const results=[];let references:any[],reference:any
 try{
 for(const step of [0,.5,.25]){
  const start=performance.now(),field=createIndirectField(floors,0),uniforms=createIndirectUniforms(field)
  field.probes.length=0;field.positionData.fill(0)
  const add=(x:number,y:number,z:number)=>{const index=field.probes.length,position=new Vector3(x,y,z);field.probes.push({index,position,region:field.regions[0]});writeIndirectPosition(field.positionData,index,position)}
  for(const x of [.5,2.5,4.5])for(const z of [.5,2.5])for(const y of [.18,1.8])add(x,y,z)
  if(step)for(let x=1.75;x<=3.25;x+=step)for(let z=1.5;z<=2.5;z+=step)if(Math.abs(x-2.5)>.09)add(x,.18,z)
  uniforms.hdGIIndoorFill.value=0;uniforms.hdGICapture.value=1;uniforms.hdGIDiffuseCapture.value=1;uniforms.hdSkyMode.value=2;uniforms.hdSkyRadianceBase.value.set(.65,.72,.82)
  scene.userData.getIndirectUniforms=()=>uniforms
  const restore=[white,floorMaterial].map(m=>applyIndirectLightingShader(m,uniforms));scene.updateMatrixWorld(true)
  const visibility=createIndirectVisibility(scene),capture=createIndirectCaptureScene(scene,false),size=16,cache=createIndirectSurfaceCache(renderer,field.probes.map(p=>p.index),size,uniforms,false)!
  capture.enableSurfaceRadianceCapture(false)
  const cube=new WebGLCubeRenderTarget(size,{type:HalfFloatType,format:RGBAFormat,colorSpace:LinearSRGBColorSpace,generateMipmaps:false}),camera=new CubeCamera(.03,80,cube);camera.coordinateSystem=renderer.coordinateSystem;camera.updateCoordinateSystem()
  try{
   if(!reference){const snapshot=await snapshotReferenceScene({scene,gl:renderer} as any);reference=createSceneLightingReference(snapshot.data);references=points.map(p=>reference.evaluate(p,16384,6,7341))}
   await cache.compile()
   for(const p of field.probes){camera.position.copy(p.position);camera.updateMatrixWorld(true);renderer.autoClear=false
    for(let face=0;face<6;face++){cache.beginFace(p.index,face,new Color());renderer.render(capture.scene,camera.children[face]);cache.copyFace(p.index,face,new Color(),cube,true)}cache.ready.add(p.index)
   }renderer.autoClear=true;renderer.setRenderTarget(null)
   const volumeLookup=createIndirectVolumeLookup(field,visibility),floorLookup=createIndirectFloorLookup(field,visibility),passes=[]
   for(let pass=1;pass<=6;pass++){
    const values=pass===1?new Map(await Promise.all(field.probes.map(async p=>[p.index,await cache.read(p.index,1)] as const))):await cache.readBatch(field.probes.map(p=>p.index),()=>false)
    for(const [index,sh]of values!)for(let c=0;c<3;c++)for(let k=0;k<4;k++)field.coefficients[c][index*4+k]=DataUtils.toHalfFloat(sh.coefficients[k].getComponent(c))
    volumeLookup.refreshCoefficients();floorLookup.refreshCoefficients();const scratch=new Float64Array(12)
    for(let row=0;row<field.volume.rows;row++)writeIndirectVolumeRow(field,row,scratch,visibility,volumeLookup)
    writeIndirectFloorLayer(field,visibility,floorLookup);field.volume.maps.forEach(m=>m.needsUpdate=true);field.maps.forEach(m=>m.needsUpdate=true);updateIndirectUniforms(uniforms,field);uniforms.hdGIUseVolume.value=1
    passes.push(field.probes.map(p=>[0,1,2].map(c=>.886227*DataUtils.fromHalfFloat(field.coefficients[c][p.index*4])+1.023328*DataUtils.fromHalfFloat(field.coefficients[c][p.index*4+1]))))
   }
   const basis=indirectSHIrradianceBasis(new Vector3(0,1,0)),coeff=new Float64Array(12),rgb=()=>[0,1,2].map(c=>Math.max(0,basis.reduce((s,b,k)=>s+b*coeff[c*4+k],0)))
   const measurements=points.map(p=>{const support=sampleIndirectCoefficients(field,0,...p.position as[number,number,number],coeff,visibility);return{...p,production:rgb().map(v=>v*indirectFloorConfidence(support))}})
   const probeReferences=field.probes.map(p=>reference.evaluate({name:`probe-${p.index}`,position:p.position.toArray(),normal:[0,1,0],geometricNormal:[0,0,0]},32768,6,8231))
   field.coefficients.forEach((a,c)=>{a.fill(0);field.probes.forEach((p,i)=>a[p.index*4]=DataUtils.toHalfFloat((probeReferences[i].sky[c]+probeReferences[i].reflected[c])/.886227))})
   measurements.forEach((p:any)=>{const support=sampleIndirectCoefficients(field,0,...p.position as[number,number,number],coeff,visibility);p.referenceProbeBlend=rgb().map(v=>v*indirectFloorConfidence(support))})
   results.push({step,probeCount:field.probes.length,positions:field.probes.map(p=>p.position.toArray()),measurements,probeReferences,passes,elapsedMs:performance.now()-start,cacheBytes:cache.layout.bytes,lookup:floorLookup.statistics()})
  }finally{cache.dispose();capture.dispose();cube.dispose();visibility.dispose();field.dispose();restore.forEach(r=>r())}
 }
 return{boxes,results,references:references!,points,glError:renderer.getContext().getError(),scope:'Actual existing GPU capture/cache six-pass solver, L1, 16px faces. 2m base layout; added floor probes retain the same 3.5m influence radius. Surface-position reference samples are the upper bound, not deployable transport.'}
 }finally{reference?.dispose();scene.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose()});white.dispose();floorMaterial.dispose();renderer.dispose();renderer.domElement.remove()}
}
