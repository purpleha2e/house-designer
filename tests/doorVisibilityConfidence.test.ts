import assert from 'node:assert/strict'
import test from 'node:test'
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,DataUtils,Vector3} from 'three'
import {createIndirectField} from '../src/indirectLighting.ts'
import {createIndirectVisibility} from '../src/indirectVisibility.ts'
import {createDoorConfidenceSampler,confidenceCandidates} from './doorVisibilityConfidence.ts'

function fixture(kind:string){
 const field=createIndirectField([{id:'ground',elevation:0,height:3,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:0,y:4}]}]}],0)
 const scene=new Group(),material=new MeshStandardMaterial(),geometries:BoxGeometry[]=[]
 const box=(p:number[],size:number[])=>{const g=new BoxGeometry(...size as[number,number,number]),m=new Mesh(g,material);m.position.fromArray(p);scene.add(m);geometries.push(g)}
 if(kind==='thin-wall')box([2.5,1.5,2],[.006,3,4])
 if(kind==='closed-door')box([2.5,1,2],[.035,2,1])
 if(kind==='broad-door'||kind==='narrow-door'||kind==='window'){
  const gap=kind==='narrow-door'?.03:1
  box([2.5,1.5,(2-gap/2)/2],[.035,3,2-gap/2]);box([2.5,1.5,3+gap/4],[.035,3,2-gap/2])
  if(kind==='window')box([2.5,.4,2],[.035,.8,gap])
 }
 if(kind==='cabinet')box([2.5,.55,2],[.8,1,.8])
 if(kind==='cushion-gap'){box([2.5,.3,1.7],[.2,.6,.55]);box([2.5,.3,2.3],[.2,.6,.55])}
 if(kind==='table-leg')box([2.5,.4,2],[.04,.8,.04])
 if(kind==='slab')box([2.5,1.5,2],[5,.1,4])
 if(kind==='stairwell'){box([.6,1.5,2],[1.2,.1,4]);box([4.4,1.5,2],[1.2,.1,4])}
 field.probes.splice(2);field.positionData.fill(0)
 const vertical=kind==='slab'||kind==='stairwell'
 field.probes.forEach((p,i)=>{p.position.set(vertical?2:i?3.5:1.5,vertical?(i?2:1):kind==='window'?1.4:.18,2);p.position.toArray(field.positionData,p.index*4);field.positionData[p.index*4+3]=1;field.coefficients.forEach(c=>c[p.index*4]=DataUtils.toHalfFloat((i?1:.1)/.886227))})
 const point=vertical?[2,1.016,2]:kind==='window'?[2.4,1.4,2]:[2.4,.016,2]
 return{field,point,visibility:createIndirectVisibility(scene),dispose(){field.dispose();material.dispose();geometries.forEach(g=>g.dispose())}}
}

for(const kind of ['thin-wall','closed-door','broad-door','narrow-door','window','cabinet','cushion-gap','table-leg','slab','stairwell','open-room'])test(`confidence keeps central visibility constraints: ${kind}`,()=>{
 const f=fixture(kind)
 try{
  const sampler=createDoorConfidenceSampler(f.field,f.visibility),result=sampler.sample(f.point)
  for(const [name,v]of Object.entries(result.variants)){
   assert.ok(v.confidence.every(x=>Number.isFinite(x)&&x>=0&&x<=1),name)
   result.links.forEach((l,i)=>{if(!l.central)assert.equal(v.weights[i],0,`${kind}/${name}: blocked probes cannot enter`)} )
   assert.ok(v.rgb.every(Number.isFinite),name)
  }
  if(['thin-wall','closed-door','slab'].includes(kind))for(const v of Object.values(result.variants))assert.ok(v.rgb[0]<.101,'no bright opposite-side leakage')
  if(['open-room','broad-door','window','stairwell'].includes(kind))for(const v of Object.values(result.variants))assert.deepEqual(v.rgb,result.variants.binary.rgb,'stable broad visibility must be unchanged')
  if(kind==='narrow-door')assert.ok(result.links.some(l=>l.central&&l.index===f.field.probes[1].index),'narrow opening admits the central ray')
  const repeat=sampler.sample(f.point)
  assert.deepEqual(repeat,result,'deterministic geometry patterns')
 }finally{f.visibility.dispose();f.dispose()}
})

test('constant radiance and full support are conserved in unobstructed space',()=>{
 const f=fixture('open-room')
 try{for(const p of f.field.probes)for(const c of f.field.coefficients)c[p.index*4]=DataUtils.toHalfFloat(.4/.886227)
  const result=createDoorConfidenceSampler(f.field,f.visibility).sample(f.point)
  for(const name of confidenceCandidates){assert.ok(Math.abs(result.variants[name].rgb[0]-.4)<.0003);assert.equal(result.variants[name].normalizedWeights.reduce((a,b)=>a+b,0),1)}
 }finally{f.visibility.dispose();f.dispose()}
})
