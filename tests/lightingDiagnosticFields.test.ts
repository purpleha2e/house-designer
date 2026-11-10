import test from 'node:test'
import assert from 'node:assert/strict'
import {DataUtils} from 'three'
import {createIndirectField} from '../src/indirectLighting.ts'
import {createIndirectBounceField} from '../src/indirectLivePreview.ts'
import {createPackedDiagnosticField} from '../src/lightingDiagnosticFields.ts'

for(const order of [1,2] as const) test(`L${order} diagnostic packing preserves every signed band, coverage and the authoritative cache`,async()=>{
  const final=createIndirectField([{id:'room',elevation:0,height:2.4,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}]}],1,order),sky=createIndirectBounceField(final)
  try{
    for(const [a,b]of [[final.volume.data,sky.volume.data],[final.floorLayer.data,sky.floorLayer.data]])for(let i=0;i<a.length;i++){a[i]=DataUtils.toHalfFloat(i%4===3?.5:2);b[i]=DataUtils.toHalfFloat(i%4===3?.5:.75)}
    final.floorLayer.ready=true
    const result=await createPackedDiagnosticField(final,sky,()=>false);assert.ok(result)
    try{for(const [a,b,to,n,h]of [[final.volume.data,sky.volume.data,result.field.volume.data,final.volume.n,final.volume.height],[final.floorLayer.data,sky.floorLayer.data,result.field.floorLayer.data,final.floorLayer.n,final.floorLayer.height]]as const){const slab=n*h*4;for(let z=0;z<n;z++)for(let c=0;c<final.coefficientCount;c++){const from=(z*final.coefficientCount+c)*slab,target=from*2;assert.deepEqual(to.subarray(target,target+slab),a.subarray(from,from+slab));assert.deepEqual(to.subarray(target+slab,target+2*slab),b.subarray(from,from+slab))}}
      assert.equal(result.field.floorLayer.ready,true);assert.equal(DataUtils.fromHalfFloat(final.volume.data[0]),2);assert.equal(DataUtils.fromHalfFloat(sky.volume.data[0]),.75)
    }finally{result.dispose()}
    assert.equal(await createPackedDiagnosticField(final,sky,()=>true),undefined)
  }finally{sky.dispose();final.dispose()}
})
