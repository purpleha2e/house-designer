import assert from 'node:assert/strict'
import test from 'node:test'
import { getLocalLightLimits, localLightPoolCapacities, prioritizeEmittingLights, prioritizeVisibleLights } from '../src/localLightBudget.ts'

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
  assert.deepEqual(localLightPoolCapacities(0,3,11,2),{point:0,spot:4,shadowPoint:0,shadowSpot:2})
  for(const limit of [4,8,11])for(let point=0;point<=11;point++)for(let spot=0;spot<=11;spot++){
    const pool=localLightPoolCapacities(point,spot,limit,2)
    assert.ok(pool.point<=limit&&pool.spot<=limit&&pool.shadowPoint+pool.shadowSpot<=2)
  }
})
