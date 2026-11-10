import {FloatType,Mesh,MeshStandardMaterial,OrthographicCamera,PlaneGeometry,Scene,ShaderMaterial,Vector3,WebGLRenderer,WebGLRenderTarget} from 'three'
import {barrierFixture,rebuildBarrierFixture} from '../giBarrierFixtures'
import {buildBarrierMetadata,sampleBarrierField} from '../giBarrierGeometry'
import {barrierTexture,injectBarrierShader} from '../giBarrierShader'
import {applyIndirectLightingShader,createIndirectUniforms,indirectVolumeShaderDeclarations} from '../../src/indirectLightingShader'
import type {RootState} from '@react-three/fiber'
import {barrierWorker,installBarrierComparison} from './giBarrierComparison'

const renderer=new WebGLRenderer({antialias:false});renderer.setSize(32,32);document.body.appendChild(renderer.domElement)
async function run(){
 const results=[]
 for(const [kind,thickness]of [['thin-wall',.006],['partition-100',.1],['wall-150',.15],['closed-door',.035],['doorway',.035],['open-window',.006],['furniture-panel',.006],['panel-edge',.006],['slab',.006],['stairwell',.006]] as [string,number][]){
  const f=barrierFixture(kind,thickness),visibility=rebuildBarrierFixture(f)
  try{
   const metadata=await buildBarrierMetadata(f.field,visibility.snapshot()),uniforms=createIndirectUniforms(f.field);uniforms.hdGIUseVolume.value=1
   const scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1),geometry=new PlaneGeometry(2,2),target=new WebGLRenderTarget(2,1,{type:FloatType,depthBuffer:false}),modes:Record<string,unknown>={}
   for(const mode of ['legacy','A','B'] as const){
    const atlas=mode==='legacy'?undefined:barrierTexture(mode==='A'?metadata.a:metadata.b)
    let fragment=`${indirectVolumeShaderDeclarations}\nuniform vec3 point,receiverNormal;uniform float isFloor;void main(){vec3 mean;float support;vec3 light=gl_FragCoord.x<1.?hdGIVolumeSample(0.,point,receiverNormal,isFloor,mean,support):hdGIVolumeIrradiance(0.,point,receiverNormal,isFloor,mean);gl_FragColor=vec4(light,1.);}`
    if(mode!=='legacy')fragment=injectBarrierShader(fragment,mode)
    const material=new ShaderMaterial({uniforms:{...uniforms,...atlas?.uniforms,point:{value:f.receiver.clone()},receiverNormal:{value:f.normal.clone()},isFloor:{value:f.floorLayer?1:0}},depthTest:false,depthWrite:false,toneMapped:false,vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:fragment}),quad=new Mesh(geometry,material);scene.add(quad)
    const values=new Float32Array(8);renderer.setRenderTarget(target);renderer.render(scene,camera);await renderer.readRenderTargetPixelsAsync(target,0,0,2,1,values)
    const cpu=sampleBarrierField(f.field,metadata,f.receiver,f.normal,0,f.floorLayer,mode)
    if(Math.abs(values[0]-cpu.rgb[0])>.0015)throw Error(`${kind}/${mode} GPU ${values[0]} != CPU ${cpu.rgb[0]}`)
    if(!['doorway','open-window','panel-edge','stairwell'].includes(kind)&&mode!=='legacy'&&Math.abs(values[4]-.1)>.0015)throw Error(`${kind}/${mode} storey blend leaked: ${values[4]}`)
    modes[mode]={sample:Array.from(values.subarray(0,3)),storeyBlend:Array.from(values.subarray(4,7)),cpu,barrierCell:metadata.cells.get(cpu.cell)?.plane?'certified plane':'exact or open'}
    scene.remove(quad);material.dispose();atlas?.texture.dispose()
   }
   results.push({kind,thickness,receiver:f.receiver.toArray(),modes,statistics:metadata.statistics});geometry.dispose();target.dispose()
  }finally{visibility.dispose();f.dispose()}
 }
 // A genuinely dark valid corner is not discarded during normalization.
 return{results,glError:renderer.getContext().getError(),renderer:renderer.getContext().getParameter(renderer.getContext().getExtension('WEBGL_debug_renderer_info')!.UNMASKED_RENDERER_WEBGL),normal:new Vector3(0,1,0).toArray()}
}
async function cancellation(){
 const f=barrierFixture(),client=barrierWorker({scene:f.scene} as RootState)
 f.scene.userData.getLightingField=()=>f.field
 try{
  const requests=[]
  for(let i=0;i<3;i++){f.scene.children[0].position.x=f.wallX+i*.05;f.scene.updateMatrixWorld(true);requests.push(client.request())}
  const results=await Promise.allSettled(requests),last=results[2]
  if(results[0].status!=='rejected'||results[1].status!=='rejected'||last.status!=='fulfilled')throw Error('Obsolete generation publication')
  const visibility=rebuildBarrierFixture(f)
  try{const fresh=await buildBarrierMetadata(f.field,visibility.snapshot())
   for(const mode of ['a','b'] as const){const actual=last.value[mode].data,expected=fresh[mode].data;if(actual.length!==expected.length||actual.some((v,i)=>v!==expected[i]))throw Error('Latest edit differs from fresh metadata')}
   return{statuses:results.map(r=>r.status),publishedGeneration:last.value.id,latestMatchesFresh:true}
  }finally{visibility.dispose()}
 }finally{client.dispose();f.dispose()}
}
async function cachedPrograms(){
 const f=barrierFixture(),visibility=rebuildBarrierFixture(f),camera=new OrthographicCamera(-4,4,4,-4,.01,20),target=new WebGLRenderTarget(8,8,{type:FloatType})
 camera.position.set(0,2,5);camera.lookAt(f.receiver);camera.updateMatrixWorld()
 const material=(f.scene.children[0] as Mesh).material as MeshStandardMaterial,restore=applyIndirectLightingShader(material,createIndirectUniforms(f.field))
 const metadata=await buildBarrierMetadata(f.field,visibility.snapshot()),control=installBarrierComparison({scene:f.scene} as RootState,{id:1,a:metadata.a,b:metadata.b,statistics:metadata.statistics}),modes=[]
 try{renderer.setRenderTarget(target)
  for(const mode of ['A','B','legacy'] as const){control.setMode(mode);await renderer.compileAsync(f.scene,camera)}
  for(const mode of ['legacy','A','B','legacy','B','A'] as const){control.setMode(mode);renderer.render(f.scene,camera);const error=renderer.getContext().getError();if(error)throw Error(`${mode} cached PBR program GL error ${error}`);modes.push({mode,glError:error})}
  return modes
 }finally{control.dispose();restore();visibility.dispose();f.dispose();target.dispose();renderer.setRenderTarget(null)}
}
Object.assign(window,{runBarrierRegression:run,runBarrierCancellation:cancellation,runBarrierCachedPrograms:cachedPrograms})
