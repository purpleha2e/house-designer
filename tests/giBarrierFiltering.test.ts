import assert from 'node:assert/strict'
import test from 'node:test'
import {DataUtils} from 'three'
import {barrierFixture,rebuildBarrierFixture} from './giBarrierFixtures.ts'
import {buildBarrierMetadata,sampleBarrierField,independentBarrierRay} from './giBarrierGeometry.ts'

test('permanent 6 mm filter regression rejects the legacy blend and recovers measured dark-side irradiance',async()=>{
 const f=barrierFixture(),visibility=rebuildBarrierFixture(f)
 try{const metadata=await buildBarrierMetadata(f.field,visibility.snapshot()),legacy=sampleBarrierField(f.field,metadata,f.receiver,f.normal,0,true,'legacy');assert.ok(legacy.rgb[0]>.45)
  for(const mode of ['A','B'] as const){const sample=sampleBarrierField(f.field,metadata,f.receiver,f.normal,0,true,mode);assert.ok(Math.abs(sample.rgb[0]-.1)<.001);for(const p of sample.taps)if(p.valid&&p.support&&p.weight)assert.ok(independentBarrierRay(visibility.snapshot(),f.receiver.toArray(),p.position))}
 }finally{visibility.dispose();f.dispose()}
})
test('geometry decisions preserve black measurements, confidence and ordinary open-space gradients',async()=>{
 const f=barrierFixture('doorway'),visibility=rebuildBarrierFixture(f)
 try{f.field.floorLayer.data.forEach((_,i,a)=>{if(i%4!==3)a[i]=DataUtils.toHalfFloat(DataUtils.fromHalfFloat(a[i])<.5?0:DataUtils.fromHalfFloat(a[i])*.5)})
  const metadata=await buildBarrierMetadata(f.field,visibility.snapshot()),legacy=sampleBarrierField(f.field,metadata,f.receiver,f.normal,0,true,'legacy')
  for(const mode of ['A','B'] as const){const sample=sampleBarrierField(f.field,metadata,f.receiver,f.normal,0,true,mode);assert.deepEqual(sample.rgb,legacy.rgb);assert.equal(sample.coverage,legacy.coverage)}
 }finally{visibility.dispose();f.dispose()}
})
test('changed occupancy mask invalidates cached barrier layout',async()=>{
 const f=barrierFixture(),visibility=rebuildBarrierFixture(f)
 try{const before=await buildBarrierMetadata(f.field,visibility.snapshot());(f.field.mask.image.data as Uint8Array)[0]^=255
  const after=await buildBarrierMetadata(f.field,visibility.snapshot(),{previous:before,changes:[{min:[100,100,100],max:[101,101,101]}]}),fresh=await buildBarrierMetadata(f.field,visibility.snapshot())
  assert.notEqual(after.layout.key,before.layout.key);assert.equal(after.statistics.reused,0);assert.deepEqual(after.a.data,fresh.a.data);assert.deepEqual(after.b.data,fresh.b.data)
 }finally{visibility.dispose();f.dispose()}
})
