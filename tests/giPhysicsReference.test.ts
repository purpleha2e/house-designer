import assert from 'node:assert/strict'
import test from 'node:test'
import {roomHit,roomReference,squareTransfer,srgbLinear,type V} from './giPhysicsReference.ts'

test('independent square quadrature agrees with the analytic differential rectangle view factor',()=>{
 for(const d of [1,2,4]){
  const ratio=1/Math.sqrt(1+d*d),expected=4*ratio*Math.atan(ratio)
  const actual=squareTransfer([0,0,d],[0,0,-1],[1,1,1])[0]
  assert.ok(Math.abs(actual/expected-1)<2e-6,`${d}: ${actual} != ${expected}`)
 }
 assert.deepEqual(squareTransfer([0,0,1],[0,0,1],[1,1,1]),[0,0,0])
 assert.deepEqual(squareTransfer([0,0,1],[0,0,-1],[1,1,1],32,true),[0,0,0])
})

test('independent box geometry has the specified inward normals and window visibility',()=>{
 const point:V=[2,1.5,2]
 for(const [d,face,n] of [
  [[-1,0,0],0,[1,0,0]],[[1,0,0],1,[-1,0,0]],[[0,-1,0],2,[0,1,0]],
  [[0,1,0],3,[0,-1,0]],[[0,0,-1],4,[0,0,1]],[[0,0,1],5,[0,0,-1]],
 ] as [V,number,V][]){const hit=roomHit(point,d,false);assert.equal(hit?.face,face);assert.deepEqual(hit?.n,n)}
 assert.equal(roomHit(point,[0,0,-1],true),undefined)
 assert.equal(roomHit([.5,1.5,2],[0,0,-1],true)?.face,4)
 assert.equal(roomHit([2,.4,2],[0,0,-1],true)?.face,4)
})

test('independent path tracer reproduces the analytic six-term uniform cavity solution in each RGB channel',()=>{
 for(const rho of [0,.2,.5,.8,1]){
  const result=roomReference([2,.025,2],[0,1,0],{name:'reference-self-test',rho:[rho,rho,rho],emission:'all',window:false,sun:0,direction:[0,1,0]},4096,6)
  for(let k=0;k<6;k++)for(let c=0;c<3;c++){
   const expected=Math.PI*[1,.5,.25][c]*rho**k
   assert.ok(Math.abs(result.increments[k][c]-expected)<1e-11)
   const cumulative=Math.PI*[1,.5,.25][c]*Array.from({length:k+1},(_,i)=>rho**i).reduce((a,b)=>a+b,0)
   assert.ok(Math.abs(result.cumulative[k][c]-cumulative)<1e-10)
  }
 }
})

test('sRGB reference checks the toe and nonlinear branch against fixed published-function values',()=>{
 assert.equal(srgbLinear(0),0);assert.equal(srgbLinear(1),1)
 assert.ok(Math.abs(srgbLinear(.02)-.0015479876160990713)<1e-15)
 assert.ok(Math.abs(srgbLinear(.5)-.21404114048223255)<1e-15)
 assert.ok(Math.abs(srgbLinear(.8)-.6038273388553378)<1e-15)
})
