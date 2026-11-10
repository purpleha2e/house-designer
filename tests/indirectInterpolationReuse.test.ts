import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, DataUtils, Group, Mesh, MeshStandardMaterial } from 'three'
import { createIndirectField } from '../src/indirectLighting.ts'
import { createIndirectVisibility } from '../src/indirectVisibility.ts'
import { createIndirectVolume, createIndirectVolumeLookup, writeIndirectVolumeRow } from '../src/indirectVolume.ts'
import { createIndirectFloorLayer, createIndirectFloorLookup, writeIndirectFloorLayer } from '../src/indirectFloorLighting.ts'
import type { IndirectZoneChange } from '../src/indirectLightingZones.ts'

function fixture(order: 1 | 2 = 1) {
  const field=createIndirectField([{id:'ground',elevation:0,height:2.5,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:12,y:0},{x:12,y:4},{x:0,y:4}]}]}], 1, order)
  field.volume.dispose();field.volume=createIndirectVolume(field.bounds.size,1,.7,20,field.coefficientCount)
  field.floorLayer.dispose();field.floorLayer=createIndirectFloorLayer(field.bounds.size,1,.7,20,field.coefficientCount)
  const mask=field.mask.image.data as Uint8Array
  for(let i=0;i<mask.length;i+=4)if(mask[i]){mask[i+1]=255;mask[i+2]=255}
  for(const p of field.probes){
    field.positionData[p.index*4+3]=1
    field.coefficients.forEach((data,c)=>{for(let k=0;k<field.coefficientCount;k++)data[p.index*field.coefficientCount+k]=DataUtils.toHalfFloat(k===0?.5+(p.index%7)*.1+c*.15:Math.sin(p.index+k+c)*.15)})
  }
  const scene=new Group(),material=new MeshStandardMaterial(),geometry=new BoxGeometry(.3,2.5,1.2),box=new Mesh(geometry,material)
  box.position.set(2,1.25,2);scene.add(box)
  const bounds=():IndirectZoneChange=>({floorId:'ground',min:[box.position.x-.15,0,box.position.z-.6],max:[box.position.x+.15,2.5,box.position.z+.6]})
  const render=(volume:ReturnType<typeof createIndirectVolumeLookup>,floor:ReturnType<typeof createIndirectFloorLookup>,visibility:ReturnType<typeof createIndirectVisibility>)=>{
    const result=new Float64Array(field.coefficientCount*3);volume.refreshCoefficients();floor.refreshCoefficients()
    for(let row=0;row<field.volume.rows;row++)writeIndirectVolumeRow(field,row,result,visibility,volume)
    writeIndirectFloorLayer(field,visibility,floor)
    return {volume:field.volume.data.slice(),floor:field.floorLayer.data.slice()}
  }
  return{field,scene,box,bounds,render,dispose(){field.dispose();geometry.dispose();material.dispose()}}
}

for(const order of [1,2] as const) test(`L${order}: local moves, additions and removal retain every volume coefficient`,()=>{
  const f=fixture(order);let visibility=createIndirectVisibility(f.scene),volume=createIndirectVolumeLookup(f.field,visibility),floor=createIndirectFloorLookup(f.field,visibility)
  try{
    const before=f.render(volume,floor,visibility)
    for(const edit of ['move','remove','add'] as const){
      const changes=[f.bounds()]
      if(edit==='move')f.box.position.z+=1.3
      else if(edit==='remove')f.scene.remove(f.box)
      else{f.box.position.x+=1;f.scene.add(f.box)}
      changes.push(f.bounds())
      const oldVolume=volume.reuseData(),oldFloor=floor.reuseData();visibility.dispose();visibility=createIndirectVisibility(f.scene)
      volume=createIndirectVolumeLookup(f.field,visibility,undefined,{previous:oldVolume,changes})
      floor=createIndirectFloorLookup(f.field,visibility,{previous:oldFloor,changes})
      const actual=f.render(volume,floor,visibility)
      const freshVolume=createIndirectVolumeLookup(f.field,visibility),freshFloor=createIndirectFloorLookup(f.field,visibility),expected=f.render(freshVolume,freshFloor,visibility)
      assert.deepEqual(actual,expected,`${edit}: every half-float, including coverage, matches a fresh rebuild`)
      assert.equal(volume.statistics().reuseAccepted,true);assert.equal(floor.statistics().reuseAccepted,true)
      assert.equal(volume.statistics().candidateChecks,0,'probe membership and kernel weights are retained')
      assert.ok(volume.statistics().visibilityTests<freshVolume.statistics().visibilityTests*.4,'unrelated regions retain their exact visibility')
      assert.ok(volume.statistics().invalidatedStates>0)
      assert.deepEqual(volume.reuseData().pendingChanges,[])
      if(edit==='move')assert.notDeepEqual(actual,before,'the edit actually changes illumination')
    }
  }finally{visibility.dispose();f.dispose()}
})

test('an interrupted local update carries its unvalidated bounds into the next edit',()=>{
  const f=fixture();let visibility=createIndirectVisibility(f.scene)
  try{
    let volume=createIndirectVolumeLookup(f.field,visibility),floor=createIndirectFloorLookup(f.field,visibility)
    f.render(volume,floor,visibility)
    const first=[f.bounds()];f.box.position.z=3.3;first.push(f.bounds())
    const old=volume.reuseData(),oldFloor=floor.reuseData();visibility.dispose();visibility=createIndirectVisibility(f.scene)
    volume=createIndirectVolumeLookup(f.field,visibility,undefined,{previous:old,changes:first})
    floor=createIndirectFloorLookup(f.field,visibility,{previous:oldFloor,changes:first})
    // Simulate an edit arriving while the previous worker is only one row in.
    writeIndirectVolumeRow(f.field,0,new Float64Array(f.field.coefficientCount*3),visibility,volume,true)
    assert.ok(volume.reuseData().pendingChanges.length)
    const second=[f.bounds()];f.box.position.x=7;second.push(f.bounds())
    const interrupted=volume.reuseData(),interruptedFloor=floor.reuseData();visibility.dispose();visibility=createIndirectVisibility(f.scene)
    volume=createIndirectVolumeLookup(f.field,visibility,undefined,{previous:interrupted,changes:second})
    floor=createIndirectFloorLookup(f.field,visibility,{previous:interruptedFloor,changes:second})
    const actual=f.render(volume,floor,visibility)
    assert.deepEqual(actual,f.render(createIndirectVolumeLookup(f.field,visibility),createIndirectFloorLookup(f.field,visibility),visibility))
  }finally{visibility.dispose();f.dispose()}
})

test('changed probe positions, masks, dimensions and unknown edit bounds reject visibility reuse',()=>{
  for(const changed of ['probe','mask','dimension','invalid','unknown'] as const){
    const f=fixture(),visibility=createIndirectVisibility(f.scene)
    try{
      const volume=createIndirectVolumeLookup(f.field,visibility),floor=createIndirectFloorLookup(f.field,visibility)
      f.render(volume,floor,visibility);const old=volume.reuseData()
      if(changed==='probe')f.field.positionData[f.field.probes[0].index*4]+=.2
      if(changed==='mask')(f.field.mask.image.data as Uint8Array)[0]^=1
      if(changed==='dimension')f.field.spacing+=.2
      const changes=changed==='unknown'?[]:[f.bounds()]
      if(changed==='invalid')changes[0].min[0]=NaN
      assert.equal(createIndirectVolumeLookup(f.field,visibility,undefined,{previous:old,changes}).statistics().reuseAccepted,false,changed)
    }finally{visibility.dispose();f.dispose()}
  }
})
