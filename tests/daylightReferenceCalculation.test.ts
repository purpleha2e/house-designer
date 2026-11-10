import test from 'node:test'
import assert from 'node:assert/strict'
import { referenceIrradiance } from './daylightReferenceCalculation.ts'
test('independent reference: a sealed unlit room is black and diffuse bounces converge',()=>{
  const p:[number,number,number]=[2.5,.005,1],n:[number,number,number]=[0,1,0]
  assert.deepEqual(referenceIrradiance(p,n,{sealed:true,samples:1024}),[0,0,0])
  const one=referenceIrradiance(p,n,{depth:0}),two=referenceIrradiance(p,n,{depth:1}),six=referenceIrradiance(p,n),ten=referenceIrradiance(p,n,{depth:10})
  assert.ok(one[0]>0&&two[0]>one[0]&&six[0]>two[0])
  assert.ok(Math.abs(ten[0]-six[0])/ten[0]<.12)
})
