import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeSunBounceStrength,sunBounceIrradiance,packSunBounceTexture} from '../src/indirectSunBounce.ts'
import {Data3DTexture,HalfFloatType} from 'three'

test('experimental strength defaults to one and is bounded in quarter steps',()=>{
  for(const value of [undefined,null,NaN,Infinity,'2'])assert.equal(normalizeSunBounceStrength(value),1)
  assert.equal(normalizeSunBounceStrength(-1),0);assert.equal(normalizeSunBounceStrength(8),4)
  assert.equal(normalizeSunBounceStrength(1.62),1.5);assert.equal(normalizeSunBounceStrength(1.64),1.75)
})
test('display blend reproduces full GI exactly at one and sun-disabled GI at zero',()=>{
  const full=[.17,.29,.38],off=[.07,.12,.23],copy=[...full]
  assert.deepEqual(sunBounceIrradiance(full,off,1),full)
  assert.deepEqual(sunBounceIrradiance(full,off,0),off)
  for(const strength of [.5,1.5,2,3,4])sunBounceIrradiance(full,off,strength).forEach((v,c)=>assert.ok(Math.abs(v-(off[c]+strength*(full[c]-off[c])))<1e-14))
  assert.deepEqual(full,copy)
})
test('negative source differences survive until final nonnegative irradiance',()=>{
  sunBounceIrradiance([.1,.3,.5],[.2,.2,.1],.5).forEach((v,c)=>assert.ok(Math.abs(v-[.15,.25,.3][c])<1e-14))
  assert.equal(sunBounceIrradiance([.1],[.2],4)[0],0)
})
test('packed source textures interleave complete Y slabs per Z slice without changing inputs',()=>{
  const a=new Data3DTexture(new Uint16Array([1,2,3,4,5,6,7,8]),1,1,2),b=new Data3DTexture(new Uint16Array([9,10,11,12,13,14,15,16]),1,1,2)
  a.type=HalfFloatType;const packed=packSunBounceTexture(a,b)
  assert.deepEqual(Array.from(packed.image.data!),[1,2,3,4,9,10,11,12,5,6,7,8,13,14,15,16])
  assert.equal(packed.image.height,2);assert.equal(packed.type,HalfFloatType)
  assert.deepEqual(Array.from(a.image.data!),[1,2,3,4,5,6,7,8])
  assert.throws(()=>packSunBounceTexture(a,new Data3DTexture(new Uint16Array(4),1,1,1)),/layouts differ/)
  a.dispose();b.dispose();packed.dispose()
})
