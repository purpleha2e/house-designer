import assert from 'node:assert/strict'
import test from 'node:test'
import { getLocalLightLimits, localLightPoolCapacities, prioritizeEmittingLights, prioritizeVisibleLights, selectLocalLightIds } from '../src/localLightBudget.ts'

test('shadow priority follows the occupied room without starving emitting lights or churning near ties', () => {
  const lamps = [
    { id: 'downstairs', power: 100, priority: 2, distanceSquared: 4 },
    { id: 'bedroom', power: 40, priority: 0, distanceSquared: 9 },
    { id: 'hall', power: 20, priority: 1, distanceSquared: 12 },
    { id: 'off', power: 0, priority: 0, distanceSquared: 1 },
  ]
  assert.deepEqual(prioritizeVisibleLights(lamps, ['downstairs', 'hall'], 2).map(l=>l.id), ['bedroom', 'hall', 'downstairs', 'off'])
  const neighbours = [{ id: 'a', power: 1, priority: 0, distanceSquared: 10 }, { id: 'b', power: 1, priority: 0, distanceSquared: 9 }]
  assert.equal(prioritizeVisibleLights(neighbours, ['a'], 1)[0].id, 'a', 'small movements retain the current map')
  assert.equal(prioritizeVisibleLights([{...neighbours[0],distanceSquared:20},neighbours[1]], ['a'], 1)[0].id, 'b', 'a substantially nearer lamp takes over')
})

test('all-light mode retains every emitting lamp when the camera changes rooms', () => {
  const lights=Array.from({length:26},(_,i)=>({id:String(i),power:i===2?0:80,priority:i<13?0:2,distanceSquared:i+1}))
  const initial=selectLocalLightIds(lights,false,[],128,2)
  const moved=lights.map(l=>({...l,priority:2-l.priority,distanceSquared:30-l.distanceSquared}))
  assert.equal(initial.size,26)
  assert.equal([...initial].at(-1),'2','disabled lamps remain dormant, behind emitters')
  assert.deepEqual(selectLocalLightIds(moved,false,[...initial],128,2),initial)
  const limited=selectLocalLightIds(lights,true,[],11,2)
  assert.equal(limited.size,11)
  assert.notDeepEqual(selectLocalLightIds(moved,true,[...limited],11,2),limited,'comparison mode still selects by camera')
  const pools=localLightPoolCapacities(20,6,128,2)
  assert.equal(pools.point,20);assert.equal(pools.spot,8);assert.equal(pools.shadowPoint+pools.shadowSpot,2)
})

test('emitting lamps receive the limited shadow slots before dormant installed lamps', () => {
  const lamps = [
    { id: 'off-bedroom', power: 0, kind: 'point' },
    { id: 'off-spot', power: 0, kind: 'spot' },
    { id: 'stairwell', power: 1, kind: 'point' },
    { id: 'hallway', power: 3, kind: 'point' },
    { id: 'lit-spot', power: 2, kind: 'spot' },
    { id: 'off-hall', power: 0, kind: 'point' },
  ]
  const pool = prioritizeEmittingLights(lamps)
  assert.deepEqual(pool.filter(l => l.kind === 'point').slice(0, 2).map(l => l.id), ['stairwell', 'hallway'])
  assert.equal(pool.find(l => l.kind === 'spot')?.id, 'lit-spot')
  assert.equal(pool.length, lamps.length, 'dormant slots remain available without changing shader light counts')
  assert.equal(lamps[0].id, 'off-bedroom', 'ordering must not mutate the authored input')
  const switched = prioritizeEmittingLights(lamps.map(l => l.id === 'stairwell' ? { ...l, power: 0 } : l))
  assert.equal(switched.find(l => l.kind === 'point')?.id, 'hallway')
})

test('a sixteen-texture GPU can illuminate the four bedrooms while retaining two shadow maps', () => {
  const limits = getLocalLightLimits(1024, 16)
  assert.ok(limits.lights >= 4)
  assert.equal(limits.shadows, 2)
})

test('direct lights respect uniform capacity independently of shadow textures', () => {
  assert.deepEqual(getLocalLightLimits(256, 16), { lights: 4, shadows: 2 })
  assert.deepEqual(getLocalLightLimits(512, 32), { lights: 8, shadows: 8 })
  assert.deepEqual(getLocalLightLimits(1024, 32), { lights: 11, shadows: 11 })
})


test('spare light slots retain programs when the fifth point light is placed', () => {
  assert.deepEqual(localLightPoolCapacities(4,0,11,2),localLightPoolCapacities(5,0,11,2))
  assert.equal(localLightPoolCapacities(0,0,11,2).point,8)
  assert.deepEqual(localLightPoolCapacities(1,1,11,2),{point:8,spot:4,shadowPoint:1,shadowSpot:1})
  assert.deepEqual(localLightPoolCapacities(0,3,11,2),{point:8,spot:4,shadowPoint:0,shadowSpot:2})
  for(const limit of [4,8,11])for(let point=0;point<=11;point++)for(let spot=0;spot<=11;spot++){
    const pool=localLightPoolCapacities(point,spot,limit,2)
    assert.ok(pool.point<=limit&&pool.spot<=limit&&pool.shadowPoint+pool.shadowSpot<=2)
  }
})

test('first point and spot lamps reuse the startup pools with atlas shadows', () => {
  for (const limit of [4, 8, 11, 128]) {
    const empty = localLightPoolCapacities(0, 0, limit, 0)
    for (const [point, spot] of [[1, 0], [0, 1], [1, 1], [0, 4], [4, 4], [0, 0]]) {
      assert.deepEqual(localLightPoolCapacities(point, spot, limit, 0), empty,
        `placing/removing ${point} point and ${spot} spot lamps preserves shader counts`)
    }
  }
})
