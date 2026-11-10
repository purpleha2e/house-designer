import assert from 'node:assert/strict'
import test from 'node:test'
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,Vector3} from 'three'
import {createIndirectVisibility} from '../src/indirectVisibility.ts'
import {gatherLocalIndirect,localFinalGatherEnabled,type GatherIdentity} from './localFinalGather.ts'

const identity:GatherIdentity={geometry:1,lighting:2,source:'surface-sun',bounces:1}
const receiver={position:[0,0,0],normal:[0,1,0],geometricNormal:[0,1,0]}
function enclosure(){const scene=new Group(),geometry=new BoxGeometry(4,4,4),material=new MeshStandardMaterial();scene.add(new Mesh(geometry,material));const visibility=createIndirectVisibility(scene);return{visibility,dispose(){visibility.dispose();geometry.dispose();material.dispose()}}}
const read=(rgb:number[])=> (hit:any,direction:Vector3)=>({valid:true,rgb,primitive:hit.faceIndex,side:hit.face.normal.dot(direction)<0?1:-1,identity})

test('diagnostic feature is disabled unless explicitly requested and traces nothing',()=>{
  assert.equal(localFinalGatherEnabled([]),false);assert.equal(localFinalGatherEnabled(['--local-final-gather']),true)
  const result=gatherLocalIndirect({enabled:false,receiver,rays:64,identity,visibility:{hit(){throw Error('disabled query')}} as never,lookup(){throw Error('disabled lookup')}})
  assert.equal(result.state,'disabled');assert.equal(result.rays,0)
})
test('cosine estimator returns PI times constant radiance, with signed linear channels',()=>{
  const box=enclosure()
  try{for(const rays of [8,16,32,64]){const result=gatherLocalIndirect({enabled:true,receiver,rays,identity,visibility:box.visibility,lookup:read([.2,-.1,.4])});assert.equal(result.state,'ready');result.irradiance!.forEach((v,c)=>assert.ok(Math.abs(v-Math.PI*[.2,-.1,.4][c])<1e-12));assert.equal(result.hits,rays)}}finally{box.dispose()}
})
test('deterministic samples form nested prefixes suitable for progressive refinement',()=>{
  const box=enclosure(),directions:number[][]=[]
  try{
    const sample=(rays:number)=>gatherLocalIndirect({enabled:true,receiver,rays,seed:12,identity,visibility:box.visibility,lookup:(hit,direction)=>{directions.push(direction.toArray());return read([1,1,1])(hit,direction)}})
    sample(8);const first=directions.splice(0);sample(16);assert.deepEqual(directions.slice(0,8),first)
    for(const d of directions)assert.ok(d[1]>=0&&Math.abs(Math.hypot(...d)-1)<1e-12)
  }finally{box.dispose()}
})
test('missing samples never become black or receive a biased renormalization',()=>{
  const box=enclosure();let count=0
  try{const result=gatherLocalIndirect({enabled:true,receiver,rays:8,identity,visibility:box.visibility,lookup:(hit,direction)=>++count===1?{valid:false,rgb:[0,0,0],identity,reason:'no-surface-identity'}:read([1,1,1])(hit,direction)});assert.equal(result.state,'incomplete');assert.equal(result.irradiance,null);assert.equal(result.standardError,null);assert.equal(result.confidence,7/8);assert.equal(result.reasons?.['no-surface-identity'],1)}finally{box.dispose()}
})
test('stale geometry, light generation, source, bounce depth, primitive and side are rejected',()=>{
  const box=enclosure()
  try{for(const patch of [{identity:{...identity,geometry:3}},{identity:{...identity,lighting:3}},{identity:{...identity,source:'sky'}},{identity:{...identity,bounces:6}},{primitive:-1},{side:0}]){
    const result=gatherLocalIndirect({enabled:true,receiver,rays:8,identity,visibility:box.visibility,lookup:(hit,direction)=>({...read([1,1,1])(hit,direction),...patch})})
    assert.equal(result.state,'incomplete');assert.equal(result.irradiance,null)
  }}finally{box.dispose()}
})
test('existing nearest-hit query stops at a thin opaque blocker before a bright surface',()=>{
  const scene=new Group(),material=new MeshStandardMaterial(),thin=new BoxGeometry(4,.004,4),bright=new BoxGeometry(8,.01,8),a=new Mesh(thin,material),b=new Mesh(bright,material);a.position.y=.3;b.position.y=1;scene.add(a,b)
  const visibility=createIndirectVisibility(scene);let blocker=0
  try{const result=gatherLocalIndirect({enabled:true,receiver,rays:64,identity,visibility,lookup:(hit,direction)=>{assert.ok(hit.point.y<.31);blocker++;return read([0,0,0])(hit,direction)}});assert.equal(result.state,'ready');assert.ok(blocker>48);assert.deepEqual(result.irradiance,[0,0,0])}finally{visibility.dispose();thin.dispose();bright.dispose();material.dispose()}
})
test('escaped rays and zero sun radiance produce zero surface sunlight; cancellation publishes nothing',()=>{
  const empty=createIndirectVisibility(new Group())
  try{const result=gatherLocalIndirect({enabled:true,receiver,rays:64,identity,visibility:empty,lookup(){throw Error('No surface hit')}});assert.equal(result.state,'ready');assert.deepEqual(result.irradiance,[0,0,0])
    const cancelled=gatherLocalIndirect({enabled:true,receiver,rays:64,identity,visibility:empty,lookup:read([1,1,1]),cancelled:()=>true});assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.rays,0);assert.equal(cancelled.irradiance,null)
  }finally{empty.dispose()}
})
