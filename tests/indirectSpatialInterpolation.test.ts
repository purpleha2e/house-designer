import assert from 'node:assert/strict'
import test from 'node:test'
import {BoxGeometry,DataUtils,Mesh,MeshStandardMaterial,Scene} from 'three'
import {createIndirectField,restoreIndirectField,serializeIndirectField} from '../src/indirectLighting.ts'
import {createIndirectFloorLookup} from '../src/indirectFloorLighting.ts'
import {createIndirectVolumeLookup} from '../src/indirectVolume.ts'
import {createIndirectVisibility} from '../src/indirectVisibility.ts'
import {indirectLocalFloorReceiver} from '../src/indirectSpatialInterpolation.ts'
import {indirectLightingSettingsKey,saveIndirectLighting,savedIndirectLightingMatches} from '../src/indirectLightingPersistence.ts'

function fixture(){
 const floors=[{id:'ground',elevation:0,height:2.8,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:0,y:4}]}]}]
 const field=createIndirectField(floors,0,1,'occluder-local'),scene=new Scene(),geometry=new BoxGeometry(1.6,.1,1.2),material=new MeshStandardMaterial(),table=new Mesh(geometry,material)
 table.position.set(2.5,.9,2);scene.add(table)
 field.probes.splice(2);field.positionData.fill(0)
 field.probes.forEach((p,i)=>{p.position.set(i?3.7:2,.25,2);p.position.toArray(field.positionData,p.index*4);field.positionData[p.index*4+3]=1;field.coefficients.forEach(c=>c[p.index*4]=DataUtils.toHalfFloat(i?1:.1))})
 const mask=field.mask.image.data as Uint8Array;for(let i=0;i<mask.length;i+=4)if(mask[i]){mask[i+1]=255;mask[i+2]=255}
 const n=field.floorLayer.n,ix=Math.round((2.5-field.bounds.minX)/field.bounds.size*(n-1)),iz=Math.round((2-field.bounds.minZ)/field.bounds.size*(n-1)),voxel=iz*n+ix,x=field.bounds.minX+ix/(n-1)*field.bounds.size,z=field.bounds.minZ+iz/(n-1)*field.bounds.size
 const visibility=createIndirectVisibility(scene),sample=(lookup:ReturnType<typeof createIndirectFloorLookup>)=>{const values=new Float64Array(12),support=lookup(0,x,.016,z,voxel,values);return{values,support}}
 return{field,scene,geometry,material,table,visibility,x,z,voxel,sample,dispose(){visibility.dispose();field.dispose();geometry.dispose();material.dispose()}}
}
test('opt-in local floor interpolation favours nearby valid radiance without changing support or volume interpolation',()=>{
 const f=fixture();try{
  const local=f.sample(createIndirectFloorLookup(f.field,f.visibility)),volume=new Float64Array(12)
  createIndirectVolumeLookup(f.field,f.visibility)(0,f.x,.016,f.z,0,volume)
  f.field.spatialInterpolation='legacy';const legacy=f.sample(createIndirectFloorLookup(f.field,f.visibility))
  assert.ok(local.values[0]<legacy.values[0]-.02)
  assert.equal(local.support,legacy.support,'geometric support is not a brightness control')
  assert.deepEqual(volume,legacy.values,'3D volume retains the legacy interpolation')
 }finally{f.dispose()}
})
test('a uniform measured field is conserved, and unoccluded floor remains exactly unchanged',()=>{
 const f=fixture();try{
  f.field.coefficients.forEach(c=>f.field.probes.forEach(p=>c[p.index*4]=DataUtils.toHalfFloat(.4)))
  const local=f.sample(createIndirectFloorLookup(f.field,f.visibility));assert.ok(Math.abs(local.values[0]-DataUtils.fromHalfFloat(DataUtils.toHalfFloat(.4)))<1e-12)
  f.table.position.x=8;const empty=createIndirectVisibility(f.scene)
  try{const a=f.sample(createIndirectFloorLookup(f.field,empty));f.field.spatialInterpolation='legacy';const b=f.sample(createIndirectFloorLookup(f.field,empty));assert.deepEqual(a,b)}finally{empty.dispose()}
 }finally{f.dispose()}
})
test('GPU interpolation graph preserves CPU weighted radiance and original support',()=>{
 const f=fixture();try{
  const lookup=createIndirectFloorLookup(f.field,f.visibility),cpu=f.sample(lookup),graph=lookup.graph(),start=graph.offsets[f.voxel],count=graph.counts[f.voxel]
  let sum=0,support=0,total=0;for(let i=start;i<start+count;i++){support+=graph.supports![i];total+=graph.weights[i];sum+=graph.weights[i]*DataUtils.fromHalfFloat(f.field.coefficients[0][graph.indices[i]*4])}
  assert.ok(Math.abs(support-cpu.support)<1e-6);assert.ok(Math.abs(sum/total-cpu.values[0])<1e-7)
  // An uncaptured near probe must not distort confidence for a far valid one.
  f.field.positionData[f.field.probes[0].index*4+3]=0
  const partial=f.sample(lookup),visible=Array.from({length:count},(_,i)=>start+i).filter(i=>f.field.positionData[graph.indices[i]*4+3]>.5)
  assert.ok(Math.abs(visible.reduce((s,i)=>s+graph.supports![i],0)-partial.support)<1e-6)
 }finally{f.dispose()}
})
test('moving furniture invalidates cached underside classification and reuses unaffected visibility',()=>{
 const f=fixture();try{
  const original=createIndirectFloorLookup(f.field,f.visibility);f.sample(original)
  assert.equal(original.statistics().localFloorCells,1)
  f.table.position.x=8;const moved=createIndirectVisibility(f.scene)
  try{
   const reuse=createIndirectFloorLookup(f.field,moved,{previous:original.reuseData(),changes:[{floorId:'ground',min:[1.7,.85,1.4],max:[8.8,.95,2.6]}]})
   const reused=f.sample(reuse),fresh=f.sample(createIndirectFloorLookup(f.field,moved))
   assert.equal(reuse.statistics().reuseAccepted,true);assert.equal(reuse.statistics().localFloorCells,0);assert.deepEqual(reused,fresh)
  }finally{moved.dispose()}
 }finally{f.dispose()}
})
test('structural ceilings do not classify an ordinary floor as furniture-local',()=>{
 const f=fixture();try{
  f.table.position.y=2.79;const ceiling=createIndirectVisibility(f.scene)
  try{assert.equal(indirectLocalFloorReceiver(f.field,ceiling,0,f.x,.016,f.z),false)}finally{ceiling.dispose()}
 }finally{f.dispose()}
})
test('field serialization and settings keys preserve experimental cache isolation and old-project fallback',()=>{
 const f=fixture();try{
  const data=serializeIndirectField(f.field),restored=restoreIndirectField(data),old=restoreIndirectField({...data,spatialInterpolation:undefined})
  try{assert.equal(restored.spatialInterpolation,'occluder-local');assert.equal(old.spatialInterpolation,'legacy')}finally{restored.dispose();old.dispose()}
  const settings={daylight:true,lights:false,shadows:true,lightShadows:false,hideRoofs:false,floorSlabs:true,ambientTerm:0,softAmbientShading:false,softAmbientStrength:0,groundPlane:false}
  assert.notEqual(indirectLightingSettingsKey(settings),indirectLightingSettingsKey({...settings,spatialInterpolation:'occluder-local'}))
 }finally{f.dispose()}
})
test('experimental saves require matching settings and never match the legacy cache key',async()=>{
 const f=fixture();try{
  const settings={daylight:true,lights:false,shadows:true,lightShadows:false,hideRoofs:false,floorSlabs:true,ambientTerm:0,softAmbientShading:false,softAmbientStrength:0,groundPlane:false}
  await assert.rejects(saveIndirectLighting(f.field,'project','asset','geometry',settings,[]),/spatial interpolation differ/)
  const cache=await saveIndirectLighting(f.field,'project','asset','geometry',{...settings,spatialInterpolation:'occluder-local'},[])
  assert.equal(savedIndirectLightingMatches(cache,'project','asset',settings),false)
  assert.equal(savedIndirectLightingMatches(cache,'project','asset',{...settings,spatialInterpolation:'occluder-local'}),true)
  // An existing editor field can predate the new property during hot refresh.
  Reflect.deleteProperty(f.field,'spatialInterpolation')
  const old=await saveIndirectLighting(f.field,'project','asset','geometry',settings,[])
  assert.equal(savedIndirectLightingMatches(old,'project','asset',settings),true)
 }finally{f.dispose()}
})
test('solid geometry blocks cross-room interpolation while an open doorway retains valid influence',()=>{
 const f=fixture(),wallGeometry=new BoxGeometry(.1,2.8,4),partGeometry=new BoxGeometry(.1,2.8,1.4)
 try{
  f.scene.remove(f.table);const wall=new Mesh(wallGeometry,f.material);wall.position.set(3,1.4,2);f.scene.add(wall)
  const closed=createIndirectVisibility(f.scene)
  let darkness:number
  try{darkness=f.sample(createIndirectFloorLookup(f.field,closed)).values[0];assert.ok(Math.abs(darkness-DataUtils.fromHalfFloat(DataUtils.toHalfFloat(.1)))<1e-12)}finally{closed.dispose()}
  f.scene.remove(wall);for(const z of [.7,3.3]){const part=new Mesh(partGeometry,f.material);part.position.set(3,1.4,z);f.scene.add(part)}
  const open=createIndirectVisibility(f.scene)
  try{assert.ok(f.sample(createIndirectFloorLookup(f.field,open)).values[0]>darkness+.05)}finally{open.dispose()}
 }finally{wallGeometry.dispose();partGeometry.dispose();f.dispose()}
})
