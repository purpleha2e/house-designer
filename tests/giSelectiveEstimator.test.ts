import assert from 'node:assert/strict'
import test from 'node:test'
import {BoxGeometry} from 'three'
import {createSelectiveEstimator} from './giSelectiveEstimator.ts'
import type {ReferenceSceneData} from './sceneLightingReference.ts'

const material={color:[.5,.5,.5] as [number,number,number],metalness:0,map:-1,matrix:[1,0,0,0,1,0,0,0,1],wrapS:1001,wrapT:1001}
test('local Lambertian resampling returns rho * terminal irradiance, without adding receiver GI',()=>{
  const box=new BoxGeometry(10,10,10),geometry=box.toNonIndexed(),positions=geometry.attributes.position.array as Float32Array
  const scene:ReferenceSceneData={positions,uvs:new Float32Array(positions.length/3*2),materialIndices:new Uint16Array(positions.length/9),materials:[material],textures:[],skyBase:[0,0,0],skySun:[0,0,0],skyMode:'clear',sunDirection:[0,1,0],sunIrradiance:[0,0,0],daylightGain:1,lights:[]}
  const estimator=createSelectiveEstimator(scene,()=>[2,4,6]),point={name:'centre',position:[0,0,0],normal:[0,1,0],geometricNormal:[0,1,0]}
  try{for(const budget of [4,8,16,32])for(const seed of [1723,7753,51001]){const r=estimator.evaluate(point,budget,seed);r.replace.forEach((v,c)=>assert.ok(Math.abs(v-[1,2,3][c])<1e-12))}
    const ordinary=estimator.select(point,.3,12,0,0,25);assert.equal(ordinary.selected,false,'darkness is not a selection criterion')
    assert.ok(estimator.select(point,6,12,0,0,25).reasons.includes('offset-crosses-geometry'))
    assert.ok(estimator.select(point,.3,12,0,0,1049).selected)
  }finally{estimator.dispose();geometry.dispose();box.dispose()}
})
test('constant SH control cancels exactly, without adding its energy twice',()=>{
  const box=new BoxGeometry(10,10,10),g=box.toNonIndexed(),positions=g.attributes.position.array as Float32Array
  const scene:ReferenceSceneData={positions,uvs:new Float32Array(positions.length/3*2),materialIndices:new Uint16Array(positions.length/9),materials:[material],textures:[],skyBase:[0,0,0],skySun:[0,0,0],skyMode:'clear',sunDirection:[0,1,0],sunIrradiance:[0,0,0],daylightGain:1,lights:[]},e=createSelectiveEstimator(scene,()=>[2,2,2])
  try{const r=e.evaluate({name:'centre',position:[0,0,0],normal:[0,1,0],geometricNormal:[0,1,0]},4,1234,[[1,0,0,0],[1,0,0,0],[1,0,0,0]]);r.control.forEach(v=>assert.ok(Math.abs(v-1)<1e-5))}finally{e.dispose();g.dispose();box.dispose()}
})
