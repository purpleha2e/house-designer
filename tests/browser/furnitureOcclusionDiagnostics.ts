import {Box3,DataUtils,FloatType,Matrix3,Mesh,MeshBasicMaterial,MeshStandardMaterial,Raycaster,Vector2,Vector3,WebGLRenderTarget,type Material} from 'three'
import type {RootState} from '@react-three/fiber'
import type {EffectComposer} from 'postprocessing'
import {getEditorFiber} from './rendererTestModules'
import {spatialHouseView} from './giSpatialHouse.ts'
import {createIndirectVisibility} from '../../src/indirectVisibility'
import {sampleIndirectCoefficients} from '../../src/indirectVolume'
import {indirectSHIrradianceBasis} from '../../src/indirectSH'
import {snapshotReferenceScene} from './sceneReferenceSnapshot'

// Diagnostic hooks only. No production shaders, captures, coefficients or
// authored geometry are changed. Dispose before allowing editor GI updates.
export function furnitureOcclusionDiagnostics(s:RootState){
 let composer:EffectComposer|undefined
 const visit=(f:ReturnType<typeof getEditorFiber>)=>{if(!f)return;const v=f.ref?.current;if(v?.passes)composer=v;visit(f.child);visit(f.sibling)};visit(getEditorFiber())
 if(!composer)throw Error('Missing compositor')
 const c=composer,ao=c.passes.find(p=>'configuration'in p&&'aoRadius'in(p.configuration as object))!,aoEnabled=ao.enabled
 // Cached Three programs retain uniform object identity across attachments.
 // Reuse this object after an edit instead of writing an unbound replacement.
 const view=spatialHouseView(s),u=s.scene.userData.getIndirectUniforms(),mode=(s.scene.userData.furnitureDiagnosticMode??={value:0}),strength=u.hdGIProbeStrength.value,white=u.hdWhiteModel.value
 const smallBias=(s.scene.userData.furnitureDiagnosticSmallBias??={value:0})
 const fakeAO:{object:RootState['scene'];visible:boolean}[]=[]
 s.scene.traverse(o=>{if(String(o.userData.houseDesignerRole).startsWith('fake-ambient-occlusion')){fakeAO.push({object:o as RootState['scene'],visible:o.visible});o.visible=false}})
 const original=new Map<Material,{hook:Material['onBeforeCompile'];key:Material['customProgramCacheKey']}>()
 s.scene.traverse(o=>{if(!(o instanceof Mesh))return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
  if(!(m instanceof MeshStandardMaterial)||original.has(m))continue
  const hook=m.onBeforeCompile,key=m.customProgramCacheKey;original.set(m,{hook,key})
  m.onBeforeCompile=(shader,renderer)=>{hook.call(m,shader,renderer);if(!shader.fragmentShader.includes('vec3 hdGIVolumeSample('))return
   shader.uniforms.hdFurnitureDiagnostic=mode;shader.uniforms.hdFurnitureSmallBias=smallBias
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float hdFurnitureDiagnostic,hdFurnitureSmallBias;')
    .replace('float bias = floorReceiver > .5 ? .004 : .02 + dot(abs(surfaceNormal), stepSize);','float bias = floorReceiver > .5 ? .004 : mix(.02 + dot(abs(surfaceNormal), stepSize),.002,hdFurnitureSmallBias);')
    .replace('if (hdGICapture < .5) hdGILight *= hdGIProbeStrength * hdGIDisplayStrength;','if (hdGICapture < .5) hdGILight *= hdGIProbeStrength * hdGIDisplayStrength;')
    .replace('#include <opaque_fragment>',`if(hdFurnitureDiagnostic>.5){
      vec3 gn=normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal,viewMatrix));
      vec3 sn=normalize(transformNormalByInverseViewMatrix(geometryNormal,viewMatrix)),p,meanLight;float fr,support=0.;
      float id=hdGIReceiver(hdGIWorldPosition,hdGIReceiverWorldOffset,gn,hdGIFloorLayerReady,p,fr);
      vec3 gi=vec3(0.);if(id>=0.)gi=hdGIVolumeIrradiance(id,p,sn,fr,meanLight);
      if(hdFurnitureDiagnostic<1.5)outgoingLight=hdGIWorldPosition;
      else if(hdFurnitureDiagnostic<2.5)outgoingLight=gn;
      else if(hdFurnitureDiagnostic<3.5)outgoingLight=sn;
      else if(hdFurnitureDiagnostic<4.5)outgoingLight=p;
      else if(hdFurnitureDiagnostic<5.5)outgoingLight=gi;
      else if(hdFurnitureDiagnostic<6.5)outgoingLight=diffuseColor.rgb;
      else if(hdFurnitureDiagnostic<7.5)outgoingLight=reflectedLight.directDiffuse*PI/max(material.diffuseColor,vec3(.00001));
      else if(hdFurnitureDiagnostic<8.5){if(id>=0.)hdGIVolumeSample(id,p,sn,fr,meanLight,support);outgoingLight=vec3(id,fr,support);}
      else if(hdFurnitureDiagnostic<9.5)outgoingLight=vec3(1.);
      else outgoingLight=gn*.5+.5;
    }\n#include <opaque_fragment>`)
  };m.customProgramCacheKey=()=>key.call(m)+':furniture-stage-diagnostic-v2';m.needsUpdate=true
 }})
 const target=new WebGLRenderTarget(s.gl.domElement.width,s.gl.domElement.height,{type:FloatType,depthBuffer:true})
 const probes=s.scene.getObjectByName('indirect-lighting-probes'),probesVisible=probes?.visible;if(probes)probes.visible=false
 function state(gi=true,diagnostic=0){ao.enabled=false;u.hdWhiteModel.value=white;u.hdGIProbeStrength.value=gi?strength:0;mode.value=diagnostic}
 async function capture(gi=true,diagnostic=0){state(gi,diagnostic);return view.capture(false)}
 async function raster(points:{name:string;x:number;y:number}[],only?:Mesh,candidate=false){
  const width=s.gl.domElement.width,height=s.gl.domElement.height;target.setSize(width,height)
  const previous=s.gl.getRenderTarget(),auto=s.gl.autoClear,tone=s.gl.toneMapping,background=s.scene.background,shadowAuto=s.gl.shadowMap.autoUpdate,shadowUpdate=s.gl.shadowMap.needsUpdate,hidden:{visible:boolean}[]=[],oldVisibility:boolean[]=[],materialVisibility:[Material,boolean][]=[]
  const ancestors=new Set();for(let parent=only;parent;parent=parent.parent as Mesh)ancestors.add(parent)
  if(only){s.scene.traverse(o=>{if(o instanceof Mesh||ancestors.has(o)){hidden.push(o);oldVisibility.push(o.visible);o.visible=ancestors.has(o)}});for(const m of Array.isArray(only.material)?only.material:[only.material]){materialVisibility.push([m,m.visible]);m.visible=true}}
  const values:Record<string,number[][]>={}
  try{ s.gl.autoClear=true;s.scene.background=null;s.gl.toneMapping=0;s.gl.shadowMap.autoUpdate=false;s.gl.shadowMap.needsUpdate=false;smallBias.value=candidate?1:0
   for(const [key,m] of [['worldPosition',1],['surfaceNormal',2],['shadingNormal',3],['samplePosition',4],['shaderIrradiance',5],['albedo',6],['directIrradiance',7],['selection',8],['linearHDR',0]] as const){
    state(true,m);s.gl.setRenderTarget(target);s.gl.clear();s.gl.render(s.scene,s.camera)
    const pixels=new Float32Array(width*height*4);await s.gl.readRenderTargetPixelsAsync(target,0,0,width,height,pixels)
    values[key]=points.map(p=>Array.from(pixels.subarray(((height-1-p.y)*width+p.x)*4,((height-1-p.y)*width+p.x)*4+3)))
   }
   return points.map((p,i)=>({...p,...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v[i]]))}))
  }finally{hidden.forEach((o,i)=>o.visible=oldVisibility[i]);materialVisibility.forEach(([m,v])=>m.visible=v);s.scene.background=background;s.gl.toneMapping=tone;s.gl.autoClear=auto;s.gl.shadowMap.autoUpdate=shadowAuto;s.gl.shadowMap.needsUpdate=shadowUpdate;s.gl.setRenderTarget(previous);smallBias.value=0;state()}
 }
 function ownerAt(point:number[]){
  const ray=new Raycaster(),ndc=new Vector3().fromArray(point).project(s.camera);ray.setFromCamera(new Vector2(ndc.x,ndc.y),s.camera)
  const hits:ReturnType<Raycaster['intersectObject']>=[],box=new Box3()
  s.scene.traverse(o=>{if(!(o instanceof Mesh)||!o.geometry.attributes.position||!(Array.isArray(o.material)?o.material:[o.material]).some(m=>m instanceof MeshStandardMaterial)||!box.setFromObject(o).expandByScalar(.00002).containsPoint(new Vector3().fromArray(point)))return;Mesh.prototype.raycast.call(o,ray,hits)})
  hits.sort((a,b)=>a.point.distanceToSquared(new Vector3().fromArray(point))-b.point.distanceToSquared(new Vector3().fromArray(point)))
  return hits[0]
 }
 function describe(point:number[]){const h=ownerAt(point);if(!h)return null;const mesh=h.object as Mesh,parents=[];for(let o:Mesh|null=mesh;o;o=o.parent as Mesh|null)parents.push(o.name||o.type)
  return{mesh:mesh.name,uuid:mesh.uuid,parents,faceIndex:h.faceIndex,face:h.face,point:h.point.toArray(),role:mesh.userData.houseDesignerRole,material:(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>({name:m.name,type:m.type,side:m.side,visible:m.visible})),determinant:mesh.matrixWorld.determinant(),castShadow:mesh.castShadow,receiveShadow:mesh.receiveShadow}
 }
 function stages(points:Record<string,any>[]){
  const field=s.scene.userData.getLightingField(),visibility=createIndirectVisibility(s.scene)
  const exact=(p:Vector3,n:Vector3,floor:number)=>{const coefficients=new Float64Array(field.coefficientCount*3),links:{index:number;blocked:boolean;kernel:number}[]=[]
   const wrapped={...visibility,occluded(origin:Vector3,d:Vector3,max:number,near=.025){const blocked=visibility.occluded(origin,d,max,near),probe=field.probes.find((q:any)=>new Vector3().fromArray(field.positionData,q.index*4).distanceToSquared(origin)<1e-12);if(probe)links.push({index:probe.index,blocked,kernel:(1-origin.distanceToSquared(p)/(field.spacing*1.75)**2)**2});return blocked}}
   const support=sampleIndirectCoefficients(field,floor,p.x,p.y,p.z,coefficients,wrapped),basis=indirectSHIrradianceBasis(n,field.shOrder),rgb=[0,1,2].map(c=>Math.max(0,basis.reduce((sum,b,k)=>sum+b*coefficients[c*field.coefficientCount+k],0)))
   const total=links.reduce((s,l)=>s+(l.blocked?0:l.kernel),0);return{rgb,support,coefficients:Array.from(coefficients),links:links.map(l=>({...l,weight:l.blocked?0:l.kernel/total}))}
  }
  try{return points.map(p=>{const surface=new Vector3().fromArray(p.worldPosition),n=new Vector3().fromArray(p.shadingNormal).normalize(),gn=new Vector3().fromArray(p.surfaceNormal).normalize(),sample=new Vector3().fromArray(p.samplePosition),delta=sample.clone().sub(surface),distance=delta.length(),hit=visibility.hit(surface.clone().addScaledVector(gn,.0002),delta.normalize(),Math.max(.0001,distance-.001),.0001),floor=Math.round(p.selection[0]),owner=ownerAt(p.worldPosition),faceNormal=owner?.face?.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(owner.object.matrixWorld))??gn.clone();if(faceNormal.dot(gn)<0)faceNormal.negate();const error=owner?.point.distanceTo(surface)??Infinity;return{...p,position:p.worldPosition,normal:p.shadingNormal,geometricNormal:faceNormal.toArray(),physicalPositionError:error,validPhysicalReceiver:error<.002,offsetDistance:distance,firstCrossedSurface:hit?{point:hit.point.toArray(),distance:hit.distance}:null,preFilterAtSurface:exact(surface.clone().addScaledVector(gn,.004),n,floor),preFilterAtShaderPosition:exact(sample,n,floor),owner:describe(p.worldPosition)}})}finally{visibility.dispose()}
 }
 async function reference(points:Record<string,any>[],samples=8192,probeAudit=false){state();const snapshot=await snapshotReferenceScene(s),field=s.scene.userData.getLightingField(),indices=new Set<number>()
  if(probeAudit)for(const p of points)for(const l of p.preFilterAtShaderPosition?.links.filter((l:any)=>!l.blocked).sort((a:any,b:any)=>b.weight-a.weight).slice(0,2)??[])if(indices.size<12)indices.add(l.index)
  const probes=[...indices].map(index=>({index,position:new Vector3().fromArray(field.positionData,index*4).toArray(),coefficients:field.coefficients.map((a:Uint16Array)=>Array.from(a.subarray(index*field.coefficientCount,(index+1)*field.coefficientCount),v=>DataUtils.fromHalfFloat(v))),capture:[] as {direction:number[];weight:number;rgb:number[]}[]}))
  const atlas=(window as any).furnitureAtlas?.atlas(),cache=s.scene.userData.getIndirectSurfaceCache()
  if(atlas&&cache)for(const probe of probes)for(let face=0;face<6;face++){
   const size=cache.layout.size,[x,y]=cache.layout.tile(probe.index,face),pixels=new Uint16Array(size*size*4)
   await s.gl.readRenderTargetPixelsAsync(atlas,x,y,size,size,pixels)
   for(let row=0;row<size;row++)for(let col=0;col<size;col++){
    const u=-1+(col+.5)*2/size,v=1-(row+.5)*2/size,d=new Vector3().fromArray(face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1]),offset=(row*size+col)*4,weight=4/d.length()**3
    probe.capture.push({direction:d.normalize().toArray(),weight,rgb:[0,1,2].map(c=>DataUtils.fromHalfFloat(pixels[offset+c]))})
   }
  }
  return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./furnitureOcclusionReference.worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{if(e.data.progress){s.scene.userData.furnitureReferenceProgress=e.data.progress;return}worker.terminate();e.data.ok?resolve({metadata:{snapshotMs:snapshot.snapshotMs,triangles:snapshot.triangles,textureBytes:snapshot.textureBytes},...e.data}):reject(Error(e.data.error))};worker.onerror=e=>{worker.terminate();reject(Error(e.message))};worker.postMessage({scene:snapshot.data,points,samples,probes})})}
 function project(p:number[]){const v=new Vector3().fromArray(p).project(s.camera);return{x:Math.floor((v.x+1)*s.gl.domElement.width/2),y:Math.floor((1-v.y)*s.gl.domElement.height/2)}}
 function wallMesh(p:number[]){const hit=ownerAt(p);if(!hit)throw Error('No wall mesh');return hit.object as Mesh}
 async function profile(layout?:{top:number;bounds:{min:number[];max:number[]}}){
  const z=10.573946002270626,x=6.220947265625,root=s.scene.getObjectByName('model-transform-46781408-4e43-455d-971c-4d580142191c');if(!root&&!layout)throw Error('Kitchen cabinet not found')
  const bounds=root?new Box3().setFromObject(root):new Box3(new Vector3().fromArray(layout!.bounds.min),new Vector3().fromArray(layout!.bounds.max)),top=layout?.top??bounds.max.y
  const heights=[-.2,-.15,-.1,-.05,-.02,-.01,0,.01,.02,.03,.04,.05,.06,.08,.1,.12,.15,.2,.25,.3,.35,.4,.45,.5,.55,.6].map(d=>top+d)
  view.setCamera([4.65,top+.2,z],[x,top+.2,z],45)
  const mesh=wallMesh([x,top+.3,z]),pixels=heights.map((height,i)=>({name:`wall-${i}`,requestedHeight:height,...project([x,height,z])}))
  const points=stages(await raster(pixels,mesh));if(points.some(p=>Math.abs(p.position[0]-x)>.002)){s.scene.userData.furnitureProfileFailure={points,wall:describe([x,top+.3,z])};throw Error('Profile did not rasterize the selected wall')}
  return{top,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},camera:{position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray(),fov:45},wall:describe([x,top+.3,z]),points}
 }
 async function sofaMaterial(kind:'basic'|'wireframe'){
  const root=s.scene.getObjectByName('model-transform-96cca887-d5d4-4fef-a941-c3638911c06a');if(!root)throw Error('Missing sofa')
  const changed:{o:Mesh;material:Mesh['material']}[]=[],temporary:Material[]=[]
  root.traverse(o=>{if(!(o instanceof Mesh))return;changed.push({o,material:o.material});const convert=(m:Material)=>{const p=m as MeshStandardMaterial,basic=new MeshBasicMaterial({color:p.color,map:p.map,side:p.side,alphaMap:p.alphaMap,alphaTest:p.alphaTest,transparent:p.transparent,opacity:p.opacity,wireframe:kind==='wireframe'});temporary.push(basic);return basic};o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material)})
  try{return await capture()}finally{changed.forEach(({o,material})=>o.material=material);temporary.forEach(m=>m.dispose())}
 }
 function triangleAudit(points:Record<string,any>[]){return points.map(p=>{const hit=ownerAt(p.position);if(!hit)return{name:p.name,error:'No mesh'};const mesh=hit.object as Mesh,g=mesh.geometry,face=hit.face!,ids=[face.a,face.b,face.c],v=ids.map(i=>new Vector3().fromBufferAttribute(g.attributes.position,i).applyMatrix4(mesh.matrixWorld)),fn=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])),area=fn.length()/2;fn.normalize()
   return{name:p.name,...describe(p.position),vertices:v.map(v=>v.toArray()),vertexNormals:ids.map(i=>g.attributes.normal?new Vector3().fromBufferAttribute(g.attributes.normal,i).applyNormalMatrix(new Matrix3().getNormalMatrix(mesh.matrixWorld)).toArray():null),faceNormal:fn.toArray(),area,groups:g.groups.filter(group=>(hit.faceIndex??0)*3>=group.start&&(hit.faceIndex??0)*3<group.start+group.count),attributes:Object.keys(g.attributes),material:(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>{const q=m as MeshStandardMaterial;return{name:m.name,side:m.side,normalMap:!!q.normalMap,map:!!q.map,color:q.color?.toArray(),metalness:q.metalness,roughness:q.roughness}})}
  })}
 function sofaTopology(){
  const root=s.scene.getObjectByName('model-transform-96cca887-d5d4-4fef-a941-c3638911c06a'),meshes:any[]=[];if(!root)throw Error('Missing sofa')
  root.traverse(o=>{if(!(o instanceof Mesh)||!o.geometry.attributes.position)return;const g=o.geometry,position=g.attributes.position,normal=g.attributes.normal,count=g.index?.count??position.count,seen=new Map<string,number>(),degenerate:number[]=[],duplicates:number[][]=[],opposedNormals:number[]=[],v=[new Vector3(),new Vector3(),new Vector3()],fn=new Vector3(),nm=new Matrix3().getNormalMatrix(o.matrixWorld),normalVector=new Vector3()
   for(let t=0;t<count;t+=3){const indices=[0,1,2].map(c=>g.index?.getX(t+c)??t+c);indices.forEach((index,c)=>v[c].fromBufferAttribute(position,index).applyMatrix4(o.matrixWorld));fn.copy(v[1]).sub(v[0]).cross(v[2].clone().sub(v[0]));if(fn.lengthSq()<1e-20)degenerate.push(t/3);else{fn.normalize();if(normal&&indices.some(i=>normalVector.fromBufferAttribute(normal,i).applyNormalMatrix(nm).dot(fn)<-.01))opposedNormals.push(t/3)}
    const key=v.map(v=>v.toArray().map(n=>Math.round(n*1e6)).join(',')).sort().join('|'),previous=seen.get(key);if(previous!==undefined)duplicates.push([previous,t/3]);else seen.set(key,t/3)
   }
   meshes.push({name:o.name,uuid:o.uuid,triangles:count/3,degenerate,duplicates,opposedNormals,determinant:o.matrixWorld.determinant(),groups:g.groups,castShadow:o.castShadow,receiveShadow:o.receiveShadow})
  });return{meshes,duplicateToleranceMetres:1e-6,scope:'Exact/coincident triangles within each sofa mesh, winding against authored vertex normals, degeneracy and transforms. Near intersections between distinct noncoincident faces are identified by the receiver-crossing BVH measurements, not exhaustively pair-tested.'}
 }
 function status(){const field=s.scene.userData.getLightingField(),heap=(performance as any).memory;return{gi:{...s.scene.userData.indirectLighting},spatialInterpolation:field.spatialInterpolation,contactMode:u.hdGIContactMode.value,probeStrength:strength,displayStrength:u.hdGIDisplayStrength.value,indoorFill:u.hdGIIndoorFill.value,exposure:s.gl.toneMappingExposure,shadows:s.gl.shadowMap.enabled,memory:s.gl.info.memory,javascriptHeap:heap?{usedJSHeapSize:heap.usedJSHeapSize,totalJSHeapSize:heap.totalJSHeapSize,jsHeapSizeLimit:heap.jsHeapSizeLimit,scope:'Chrome heap estimate during diagnostics, including reference allocations; not OS resident CPU memory'}:null,volumeBytes:field.volume.data.byteLength,floorBytes:field.floorLayer.data.byteLength,coefficientCount:field.coefficientCount,ao:ao.enabled,fakeAO:fakeAO.some(f=>f.object.visible),fakeAOObjects:fakeAO.length,width:s.gl.domElement.width,height:s.gl.domElement.height,probePositions:field.probes.map((p:any)=>({index:p.index,position:new Vector3().fromArray(field.positionData,p.index*4).toArray()}))}}
 return{setCamera:view.setCamera,capture,raster,stages,reference,profile,sofaMaterial,triangleAudit,sofaTopology,project,wallMesh,describe,status,performance:view.performance,state,
  dispose(){for(const [m,v]of original){m.onBeforeCompile=v.hook;m.customProgramCacheKey=v.key;m.needsUpdate=true}u.hdGIProbeStrength.value=strength;u.hdWhiteModel.value=white;if(probes)probes.visible=probesVisible!;fakeAO.forEach(({object,visible})=>object.visible=visible);target.dispose();view.dispose();ao.enabled=aoEnabled}}
}
