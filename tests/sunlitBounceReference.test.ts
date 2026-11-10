import test from 'node:test'
import assert from 'node:assert/strict'
import {createSceneLightingReference,type ReferenceSceneData} from './sceneLightingReference.ts'
test('selective solar attribution preserves sky, lamps, geometry and paired paths',()=>{
 const data:ReferenceSceneData={positions:new Float32Array([1,-100,-100,1,-100,100,1,100,100,1,-100,-100,1,100,100,1,100,-100]),uvs:new Float32Array(12),materialIndices:new Uint16Array([0,0]),materials:[{color:[.5,.5,.5],metalness:0,map:-1,matrix:[1,0,0,0,1,0,0,0,1],wrapS:1000,wrapT:1000}],textures:[],skyBase:[.65,.72,.82],skySun:[0,0,0],skyMode:'overcast',sunDirection:[-1,0,0],sunIrradiance:[3,2,1],daylightGain:3.5,lights:[{position:[0,2,0],color:[1,1,1],intensity:1,distance:0,decay:2}],sourceCategories:new Uint8Array([1,1])}
 const ref=createSceneLightingReference(data),receiver={name:'receiver',position:[0,0,0],normal:[1,0,0],geometricNormal:[1,0,0]}
 try{const original=ref.evaluate(receiver,16384,6,901,6),tagged=ref.evaluate(receiver,16384,6,901,6,true),duvet=tagged.solarContributions![1].cumulative[5]
  assert.deepEqual(original.reflected,tagged.reflected);assert.deepEqual(original.sky,tagged.sky)
  assert.deepEqual(tagged.solarContributions![2].cumulative[5],[0,0,0]);assert.deepEqual(tagged.solarContributions![0].cumulative[5],duvet)
  data.sunIrradiance=[0,0,0];const excluded=ref.evaluate(receiver,16384,6,901,6)
  for(let c=0;c<3;c++)assert.ok(Math.abs(tagged.reflected[c]-excluded.reflected[c]-duvet[c])<1e-10)
  assert.ok(excluded.reflected[0]>.1,'sky and local lamp reflection survive exclusion')
 }finally{ref.dispose()}
})
