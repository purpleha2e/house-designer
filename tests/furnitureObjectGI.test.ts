import test from 'node:test'
import assert from 'node:assert/strict'
import {Box3,DataUtils,MeshStandardMaterial,ShaderLib,Vector3,type WebGLRenderer} from 'three'
import {createIndirectField} from '../src/indirectLighting.ts'
import {createIndirectUniforms,applyIndirectLightingShader} from '../src/indirectLightingShader.ts'
import {sampleObjectGI,evaluateObjectGI,patchObjectGIShader} from './furnitureObjectGI.ts'

test('object SH keeps direction, excludes neighbouring-room energy and samples outside furniture',()=>{
 const polygon=(x:number)=>[{x,y:0},{x:x+4,y:0},{x:x+4,y:4},{x,y:4}],field=createIndirectField([{id:'floor',elevation:0,height:3,rooms:[{signature:'A',polygon:polygon(0)},{signature:'B',polygon:polygon(4.1)}]}]),box=new Box3(new Vector3(1,.1,1),new Vector3(2,1.1,2))
 try{
  for(const p of field.probes){field.positionData[p.index*4+3]=1;for(let c=0;c<3;c++)for(let k=0;k<4;k++)field.coefficients[c][p.index*4+k]=DataUtils.toHalfFloat(p.region.id===1?([1,.2,0,0][k]):100)}
  for(const strategy of ['above','centre-adjacent','four','eight'] as const){const r=sampleObjectGI(field,box,strategy);assert.ok(r.ok);if(!r.ok)continue;assert.equal(r.actualCount,r.requestedCount);assert.ok(r.samples.every(s=>!box.containsPoint(new Vector3().fromArray(s.position))));assert.ok(r.coefficients.every(v=>Math.abs(v)<=1.001));assert.ok(evaluateObjectGI(r.coefficients,new Vector3(0,1,0))[0]>evaluateObjectGI(r.coefficients,new Vector3(0,-1,0))[0]);assert.deepEqual(r.coefficients,sampleObjectGI(field,box,strategy).ok?(sampleObjectGI(field,box,strategy) as typeof r).coefficients:[])}
  const crossing=sampleObjectGI(field,new Box3(new Vector3(3.8,.1,1),new Vector3(4.4,1,2)),'four');assert.equal(crossing.ok,false)
 }finally{field.dispose()}
})
test('object shader replaces display irradiance and retains the original capture path',()=>{
 const field=createIndirectField([]),material=new MeshStandardMaterial(),uniforms=createIndirectUniforms(field)
 try{applyIndirectLightingShader(material,uniforms);const shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader as never,{} as WebGLRenderer);const source=patchObjectGIShader(shader.fragmentShader),start=source.indexOf('if(hdGICapture<.5){vec4 basis'),end=source.indexOf('}else{',start),display=source.slice(start,end)
  assert.ok(display.includes('dot(objectSHR,basis)'));assert.ok(!display.includes('hdGIVolumeIrradiance'));assert.ok(!display.includes('hdGIReceiver('));assert.ok(source.includes('hdGICapture < .5 ? 0.0 : hdGIReceiver('));assert.ok(source.slice(end).includes('hdGIVolumeIrradiance(hdGIId'));assert.ok(source.includes('hdGILight + vec3(hdGICapture > .5 ? 0.0 : hdGIIndoorFill)'));assert.throws(()=>patchObjectGIShader('wrong contract'))
 }finally{material.dispose();field.dispose()}
})
