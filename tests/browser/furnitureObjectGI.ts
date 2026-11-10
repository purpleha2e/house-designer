import {Box3,Mesh,Vector3,Vector4,type Material,type Object3D} from 'three'
import type {RootState} from '@react-three/fiber'
import type {IndirectField} from '../../src/indirectLighting.ts'
import {sampleObjectGI,evaluateObjectGI,patchObjectGIShader,type ObjectGIStrategy} from '../furnitureObjectGI.ts'
import {getEditorFiber} from './rendererTestModules.ts'
import {measureKitchenFrames} from './kitchenFrameMeasurements.ts'

export function furnitureObjectExperiment(s:RootState,rootName='model-transform-96cca887-d5d4-4fef-a941-c3638911c06a'){
 if(new URLSearchParams(location.search).get('furnitureGI')!=='object')throw Error('Requires explicit furnitureGI=object experiment flag')
 const root=s.scene.getObjectByName(rootName)!;if(!root||!root.name.startsWith('model-transform-')||root.userData.indirectLightModel||root.userData.indirectStairModel)throw Error('Eligible imported furniture root required')
 const field=s.scene.userData.getLightingField() as IndirectField;if(field.shOrder!==1)throw Error('Bounded experiment requires completed L1 field')
 const generation=s.scene.userData.indirectLighting.generation,bounds=new Box3(),otherBounds:Box3[]=[],meshes:Mesh[]=[],original=new Map<Mesh,Material|Material[]>(),materials=new Map<Material,Material>(),uniforms={objectSHR:{value:new Vector4()},objectSHG:{value:new Vector4()},objectSHB:{value:new Vector4()}}
 s.scene.traverse(o=>{if(o!==root&&o.name.startsWith('model-transform-')&&!o.userData.indirectLightModel)otherBounds.push(new Box3().setFromObject(o))})
 root.traverse(o=>{if(o instanceof Mesh&&!o.userData.selectionDecoration){meshes.push(o);original.set(o,o.material)}})
 let compileCount=0,mode='production',coefficientUpdates=0,latest:ReturnType<typeof sampleObjectGI>|undefined,compiledSource='',updateFrame=0,lastCandidateDrawAt=0,candidateDraws=0
 const afterRender=new Map(meshes.map(mesh=>[mesh,mesh.onAfterRender]))
 for(const mesh of meshes)mesh.onAfterRender=(...args)=>{afterRender.get(mesh)!.apply(mesh,args);if((args[1]===s.scene||args[1].userData.retainedViewport)&&args[4].customProgramCacheKey().includes(':object-directional-v1:'+rootName)){lastCandidateDrawAt=performance.now();candidateDraws++}}
 const autoUpdates:any[]=[]
 const clone=(source:Material)=>{let m=materials.get(source);if(m)return m;m=source.clone();Object.assign(m,{defaultAttributeValues:Reflect.get(source,'defaultAttributeValues')});const hook=source.onBeforeCompile,key=source.customProgramCacheKey();m.onBeforeCompile=(shader,renderer)=>{compileCount++;hook.call(source,shader,renderer);Object.assign(shader.uniforms,uniforms);shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform vec4 objectSHR;uniform vec4 objectSHG;uniform vec4 objectSHB;');shader.fragmentShader=patchObjectGIShader(shader.fragmentShader);compiledSource=shader.fragmentShader};m.customProgramCacheKey=()=>key+':object-directional-v1:'+rootName;m.needsUpdate=true;materials.set(source,m);return m}
 for(const mesh of meshes){const material=original.get(mesh)!;if(Array.isArray(material))material.forEach(clone);else clone(material)}
 let composer:any;const visit=(f:ReturnType<typeof getEditorFiber>)=>{if(!f)return;if(f.ref?.current?.passes)composer=f.ref.current;visit(f.child);visit(f.sibling)};visit(getEditorFiber());if(!composer)throw Error('Composer unavailable')
 const ao=composer.passes.find((p:any)=>'configuration'in p&&'aoRadius'in p.configuration),originalAO=ao.enabled,fakeAO:{o:Object3D;visible:boolean}[]=[]
 s.scene.traverse(o=>{if(String(o.userData.houseDesignerRole).startsWith('fake-ambient-occlusion'))fakeAO.push({o,visible:o.visible})})
 function setAO(enabled:boolean){ao.enabled=enabled;for(const {o,visible}of fakeAO)o.visible=enabled?visible:false}
 function calculate(strategy:ObjectGIStrategy){root.updateWorldMatrix(true,true);bounds.setFromObject(root);const result=sampleObjectGI(s.scene.userData.getLightingField(),bounds,strategy,otherBounds);return result}
 function setMode(value:'production'|ObjectGIStrategy){
  mode=value
  if(value!=='production'){latest=calculate(value);if(!latest.ok){mode='production'}else{for(let c=0;c<3;c++)[uniforms.objectSHR,uniforms.objectSHG,uniforms.objectSHB][c].value.fromArray(latest.coefficients,c*4);coefficientUpdates++}}
  for(const mesh of meshes){const m=original.get(mesh)!;mesh.material=mode==='production'?m:Array.isArray(m)?m.map(clone):clone(m)}
  return{mode,result:latest,coefficientUpdates}
 }
 async function warm(){await s.gl.compileAsync(s.scene,s.camera);for(let i=0;i<6;i++){await new Promise(requestAnimationFrame);composer.render(1/60)}}
 function measureReceivers(points:any[]){return points.map(p=>({name:p.name,face:p.face,rgb:latest?.ok?evaluateObjectGI(latest.coefficients,new Vector3().fromArray(p.normal)):p.volume}))}
 return{setMode,setAO,warm,calculate,measureReceivers,
  startUpdates(strategy:ObjectGIStrategy){cancelAnimationFrame(updateFrame);const stamp=()=>{const g=s.scene.userData.indirectLighting;return[g.generation,g.previewUpdates,g.fullPassPublications,g.state].join(':')};let matrix=root.matrixWorld.elements.slice(),fieldRef=s.scene.userData.getLightingField(),publication=stamp();const tick=()=>{root.updateWorldMatrix(true,true);const current=s.scene.userData.getLightingField(),nextPublication=stamp();if(!matrix.every((v,i)=>v===root.matrixWorld.elements[i])||current!==fieldRef||nextPublication!==publication){const at=performance.now(),reason=matrix.every((v,i)=>v===root.matrixWorld.elements[i])?'field-publication':'transform',result=setMode(strategy);autoUpdates.push({at,reason,cpuMs:performance.now()-at,mode:result.mode,coefficients:latest?.ok?latest.coefficients:undefined});matrix=root.matrixWorld.elements.slice();fieldRef=current;publication=nextPublication}updateFrame=requestAnimationFrame(tick)};updateFrame=requestAnimationFrame(tick)},
  autoUpdates:()=>autoUpdates,
  renderState:()=>({lastCandidateDrawAt,candidateDraws,activeMeshes:meshes.filter(mesh=>(Array.isArray(mesh.material)?mesh.material:[mesh.material]).every(m=>[...materials.values()].includes(m))).length}),
  metadata:()=>({mode,root:rootName,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},meshCount:meshes.length,materialCount:materials.size,compileCount,coefficientUpdates,generation,uniformBytes:48,uniformVec4s:3,additionalTextureReads:0,additionalGeometryBytes:0,latest,shaderContainsObjectSH:compiledSource.includes('dot(objectSHR'),scope:'Test-page flag only; display replacement, original capture branch retained; same-room nearest eight valid probes per representative point; equal averaging of directional SH across points; no rays, BVH, volume reads, geometry or global-field mutation.'}),
  async frames(){return measureKitchenFrames(s,composer,{cases:[['fixed object GI mode',()=>{}]],restore:()=>{}})},
  async move(dx:number,strategy:ObjectGIStrategy){const begin=performance.now();root.position.x+=dx;root.updateWorldMatrix(true,true);const geometryMs=performance.now()-begin,selectAt=performance.now(),r=setMode(strategy),coefficientMs=performance.now()-selectAt;await new Promise(requestAnimationFrame);composer.render(1/60);return{dx,geometryMs,selectionAndCoefficientMs:coefficientMs,firstRenderSubmissionMs:performance.now()-begin,result:r,houseGenerationBefore:generation,houseGenerationAfter:s.scene.userData.indirectLighting.generation,scope:'Isolated transform using the existing completed field while the diagnostic freezes the editor loop. Not an editor invalidation/bake timing.'}},
  dispose(){cancelAnimationFrame(updateFrame);for(const[m,v]of original){m.material=v;m.onAfterRender=afterRender.get(m)!}for(const m of materials.values())m.dispose();ao.enabled=originalAO;for(const {o,visible}of fakeAO)o.visible=visible}}
}
