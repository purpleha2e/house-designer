import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createLocalLightSampler,reconstructLocalLight,type LocalLink} from './localLightReconstruction.ts'
const link=(index:number,position:number[],value:number,visible=true):LocalLink=>({index,position,regionId:0,distance:Math.hypot(...position),spatialWeight:1,visible,coefficients:[value/.886227,0,0,0,value/.886227,0,0,0,value/.886227,0,0,0]})
test('visible dark cross measurement cannot replace a valid local estimate in masking',()=>{
 const links=[link(1,[.2,.2,0],1),link(2,[-.2,.2,0],1),link(3,[2.5,.2,0],.1)]
 const q=reconstructLocalLight(links,[0,0,0],[0,1,0],2,'spatial',true)
 assert.ok(q.validLocal);assert.ok(Math.abs(q.production[0]-.7)<1e-7);assert.ok(Math.abs(q.maskedRGB[0]-1)<1e-7)
 links[2].visible=false;const blocked=reconstructLocalLight(links,[0,0,0],[0,1,0],2,'spatial',true)
 assert.deepEqual(blocked.maskedRGB,q.maskedRGB)
})
test('bright cross correction is bounded and does not sum a second source',()=>{
 const q=reconstructLocalLight([link(1,[.2,.2,0],.1),link(2,[-.2,.2,0],.1),link(3,[2.5,.2,0],1)],[0,0,0],[0,1,0],2,'spatial')
 assert.ok(Math.abs(q.maskedRGB[0]-.4)<1e-7);assert.ok(q.maskedRGB[0]<=1)
})
test('opaque geometry, missing support and zero measurements do not invent light',()=>{
 const links=[link(1,[.2,.2,0],0),link(2,[-.2,.2,0],0),link(3,[2.5,.2,0],10,false)]
 assert.deepEqual(reconstructLocalLight(links,[0,0,0],[0,1,0],2,'spatial').maskedRGB,[0,0,0])
 links[1].visible=false;const q=reconstructLocalLight(links,[0,0,0],[0,1,0],2,'spatial');assert.equal(q.validLocal,false);assert.deepEqual(q.maskedRGB,q.production)
 assert.deepEqual(reconstructLocalLight([],[0,0,0],[0,1,0],2,'spatial').maskedRGB,[0,0,0])
})
test('membership is independent of brightness and newly visible cross probes',()=>{
 const links=[link(1,[.2,.2,0],.1),link(2,[-.2,.2,0],.2),link(3,[2.5,.2,0],100,false)]
 const a=reconstructLocalLight(links,[0,0,0],[0,1,0],2,'spatial');links[2].visible=true;links[0].coefficients.fill(-1)
 const b=reconstructLocalLight(links,[0,0,0],[0,1,0],2,'spatial');assert.deepEqual(a.candidates.map(p=>p.local),b.candidates.map(p=>p.local))
})
test('signed SH is blended before irradiance clamping',()=>{
 const a=link(1,[.2,.2,0],1),b=link(2,[-.2,.2,0],1);a.coefficients=[-1,0,0,0,-1,0,0,0,-1,0,0,0];b.coefficients=b.coefficients.map((v,k)=>k%4===0?3:v)
 const q=reconstructLocalLight([a,b],[0,0,0],[0,1,0],2,'spatial');assert.ok(Math.abs(q.conservative[0]-.886227)<1e-7)
})
test('diagnostic sampler cannot be enabled by an ordinary caller',()=>{
 assert.throws(()=>createLocalLightSampler({} as any,{} as any),/explicit diagnostic opt-in/)
})
test('a fixed cell set cannot admit a newly visible cross probe',()=>{
 const links=[link(1,[.2,.2,0],.2),link(2,[-.2,.2,0],.2),link(3,[.1,.1,0],10)],fixed=new Set([1,2,8,9])
 const q=reconstructLocalLight(links,[0,0,0],[0,1,0],2,'cell-four',true,undefined,fixed)
 assert.equal(q.candidates.find(p=>p.index===3)!.local,false);assert.ok(Math.abs(q.conservative[0]-.2)<1e-7)
})
