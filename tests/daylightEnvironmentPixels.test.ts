import assert from 'node:assert/strict'
import test from 'node:test'
import {DataUtils,Vector3} from 'three'
import {daylightEnvironmentPixels} from '../src/daylightEnvironmentPixels.ts'

test('environment sky scales once and preserves the independent solar-ground basis at zero sky',()=>{
 const base=new Uint16Array([2,4,8,1].map(DataUtils.toHalfFloat)),ground=new Uint16Array([1,1,1,1].map(DataUtils.toHalfFloat)),sun=new Vector3(.25,.5,1)
 for(const strength of [0,.5,1,1.5,2,3]){
  const result=Array.from(daylightEnvironmentPixels(base,ground,sun,strength),DataUtils.fromHalfFloat)
  assert.deepEqual(result,[2*strength+.25,4*strength+.5,8*strength+1,1])
 }
 assert.deepEqual(Array.from(base,DataUtils.fromHalfFloat),[2,4,8,1],'the immutable environment basis is not accumulated into')
})
