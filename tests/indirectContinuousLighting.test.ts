import assert from 'node:assert/strict'
import test from 'node:test'
import { createIndirectLightingUpdates, indirectLightingStructureKey, prioritizeIndirectLighting } from '../src/indirectContinuousLighting.ts'

test('continuous requests coalesce while each sweep finishes and a quiet final sweep settles', () => {
  const updates = createIndirectLightingUpdates()
  updates.request(); assert.equal(updates.begin(), 1)
  for (let i = 0; i < 500; i++) updates.request()
  assert.equal(updates.changedDuringSweep, true)
  assert.equal(updates.finish(), false); assert.equal(updates.pending, true)
  assert.equal(updates.begin(), 501)
  assert.equal(updates.finish(), true); assert.equal(updates.pending, false)
  updates.request(); updates.reset(); assert.equal(updates.pending, false)
})

test('sun and lamp uniforms preserve prepared structure while materials, assets and geometry invalidate it', () => {
  const state = { lightDirection: {azimuth: 1}, floors: [{ id: 'floor', walls: [{height: 2.4}], models: [{id:'lamp', lightPower:100, lightEnabled:true, position:{x:1,y:2}}] }], surfaceAssignments: [], modelAssetVersion: 1 }
  const key = (value: unknown) => indirectLightingStructureKey(JSON.stringify(value))
  const updated = structuredClone(state); updated.lightDirection.azimuth = 2
  updated.floors[0].models[0].lightPower = 0; updated.floors[0].models[0].lightEnabled = false
  assert.equal(key(updated), key(state))
  updated.floors[0].models[0].position.x++; assert.notEqual(key(updated), key(state))
  const finish = {...state, surfaceAssignments:[{materialId:'new-finish'}]}; assert.notEqual(key(finish), key(state))
  assert.notEqual(key({...state,modelAssetVersion:2}), key(state))
  assert.notEqual(indirectLightingStructureKey('unknown-a'), indirectLightingStructureKey('unknown-b'))
})

test('nearby probes finish bounce two and reflections before distant first bounces, then receive a final coherent refinement', () => {
  const first = Array.from({length:40},(_,probe)=>({probe,pass:1,region:{id:probe<20?1:2},reflection:false}))
  const second = first.map(s=>({...s,pass:2}))
  const reflections = [{probe:undefined,pass:2,region:{id:1},reflection:true},{probe:undefined,pass:2,region:{id:2},reflection:true}]
  const queue = prioritizeIndirectLighting(first,second,reflections,true)
  const firstFar = queue.findIndex(s=>s.probe===39&&s.pass===1)
  assert.ok(queue.findIndex(s=>s.probe===0&&s.pass===2)<firstFar)
  assert.ok(queue.findIndex(s=>s.reflection&&s.region.id===1)<firstFar)
  for(const sample of queue.filter(s=>s.pass===2&&!s.reflection)) {
    assert.ok(queue.findIndex(s=>s.probe===sample.probe&&s.pass===1)<queue.indexOf(sample))
  }
  const final = queue.slice(firstFar+1)
  assert.equal(final.filter(s=>s.pass===2&&!s.reflection).length,40,'every probe is refined with all current first bounces')
  assert.equal(final.filter(s=>s.reflection).length,2)
  assert.equal(prioritizeIndirectLighting(first,second,reflections,false).length,82,'cold startup retains its supported global capture order')
})
