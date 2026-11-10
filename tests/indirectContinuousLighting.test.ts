import assert from 'node:assert/strict'
import test from 'node:test'
import { createIndirectLightingUpdates, indirectLightingStructureKey, indirectSkyIndependentRevision, prioritizeIndirectLighting } from '../src/indirectContinuousLighting.ts'

test('restoring cached lighting preserves sun edits arriving during decode and upload', () => {
  const updates = createIndirectLightingUpdates()
  const loading = updates.request()
  updates.request(); updates.request()
  assert.equal(updates.restore(loading), false)
  assert.equal(updates.pending, true)
  updates.begin()
  assert.equal(updates.finish(), true)
  assert.equal(updates.pending, false)
  const unchanged = updates.request()
  assert.equal(updates.restore(unchanged), true)
  assert.equal(updates.pending, false)
})

test('failed work settles queued requests until the input changes', () => {
  const updates = createIndirectLightingUpdates()
  updates.request(); updates.begin(); updates.request()
  updates.fail()
  assert.equal(updates.pending, false)
  assert.equal(updates.changedDuringSweep, false)
  updates.request()
  assert.equal(updates.pending, true)
  updates.begin(); assert.equal(updates.finish(), true)
})

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

test('six-pass Jacobi sweeps contain each probe once per pass and reflections last',()=>{
  const first=Array.from({length:40},(_,probe)=>({probe,pass:1,region:{id:probe<20?1:2},reflection:false}))
  const second=first.map(sample=>({...sample,pass:2})),reflections=[{probe:undefined,pass:2,region:{id:1},reflection:true}]
  const queue=prioritizeIndirectLighting(first,second,reflections,true,6)
  assert.equal(queue.length,241)
  for(let pass=1;pass<=6;pass++){
    const samples=queue.filter(sample=>sample.pass===pass&&!sample.reflection)
    assert.equal(samples.length,40);assert.equal(new Set(samples.map(sample=>sample.probe)).size,40)
    if(pass>1)assert.ok(queue.findIndex(sample=>sample.pass===pass)>queue.findLastIndex(sample=>sample.pass===pass-1))
  }
  assert.equal(queue.at(-1)?.reflection,true);assert.equal(queue.at(-1)?.pass,6)
})


test('sky-only cancellation identity retains every other authored input',()=>{
 const state={floors:[{id:'floor',models:[{id:'lamp',lightPower:100}]}],surfaceAssignments:[{id:'paint',materialId:'timeless'}],lightDirection:{azimuth:1,strength:1},lightingSettings:{skyMode:'overcast',skyStrength:1,daylight:true,ambientTerm:.18}}
 const key=(value:unknown)=>indirectSkyIndependentRevision(JSON.stringify(value))
 for(const skyStrength of [0,.5,1,1.5,2,3])assert.equal(key({...state,lightingSettings:{...state.lightingSettings,skyStrength}}),key(state))
 for(const changed of [{...state,lightDirection:{...state.lightDirection,strength:0}},{...state,floors:[]},{...state,surfaceAssignments:[]},{...state,lightingSettings:{...state.lightingSettings,skyMode:'clear'}},{...state,lightingSettings:{...state.lightingSettings,daylight:false}}])assert.notEqual(key(changed),key(state))
 assert.equal(indirectSkyIndependentRevision('opaque-revision'),'opaque-revision')
})
