import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, Vector3 } from 'three'
import { createModellingLightingSchedule, modellingLightingVolume, modellingLightingStatus } from '../src/modellingLighting.ts'

test('modelling capture coalesces edits without cancelling in-flight transport', () => {
  const schedule = createModellingLightingSchedule()
  schedule.observe('wall-1', 0)
  assert.equal(schedule.take(79, false), undefined)
  assert.equal(schedule.take(80, false), 'wall-1')
  schedule.observe('wall-2', 90); schedule.observe('wall-3', 100)
  assert.equal(schedule.take(1000, false), undefined, 'finish the first immutable snapshot')
  schedule.finish()
  assert.equal(schedule.take(1000, true), undefined, 'geometry preparation remains a hard barrier')
  assert.equal(schedule.take(1000, false), 'wall-3', 'only the newest queued edit is captured')
  schedule.finish()
  assert.equal(schedule.take(2000, false), undefined, 'a completed static view performs no further captures')
})

test('continuous light input cannot starve modelling transport', () => {
  const schedule = createModellingLightingSchedule()
  for (let i = 0; i < 7; i++) {
    schedule.observe(`light-${i}`, i * 50)
    assert.equal(schedule.take(i * 50, false), undefined)
  }
  schedule.observe('light-7', 350)
  assert.equal(schedule.take(350, false), 'light-7')
  schedule.finish(); schedule.reset()
  schedule.observe('light-7', 500)
  assert.equal(schedule.take(580, false), 'light-7', 'context restoration permits the same scene to prepare again')
})

test('navigation does not move a modelling room volume', () => {
  const floors = [{ id: 'floor', elevation: 0, height: 3, rooms: [
    { signature: 'room', polygon: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }, { x: 0, y: 6 }] },
  ] }]
  const first = modellingLightingVolume(floors, new Vector3(1, 1, 1))!
  const second = modellingLightingVolume(floors, new Vector3(6, 2, 4))!
  assert.deepEqual(first.bounds, second.bounds)
  assert.deepEqual(first.anchor, second.anchor)
  assert.equal(first.key, second.key)
  const cellHeight = (first.bounds.max.y - first.bounds.min.y) / 32
  assert.ok(first.bounds.min.y > -cellHeight && first.bounds.max.y < 3 + cellHeight,
    'the storey field cannot hold a full layer of samples beyond its floor or ceiling')
})

test('unfinished walls get a finite bounded volume before a room closes', () => {
  const floors = [{ id: 'floor', elevation: 4, height: 3, rooms: [], indoorPartitions: [
    [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: .2 }, { x: 0, y: .2 }],
  ] }]
  const volume = modellingLightingVolume(floors, new Vector3(10, 5, 3))!
  const size = volume.bounds.getSize(new Vector3())
  assert.ok(size.x <= 20 && size.z >= 2 && size.y > 3)
  assert.ok(volume.bounds.containsPoint(volume.anchor))
  assert.match(volume.key, /^open:floor:/)
  assert.equal(modellingLightingVolume([], new Vector3()), null)
  const geometry = new Box3(new Vector3(1, 0, 2), new Vector3(4, 3, 2.2))
  assert.ok(modellingLightingVolume([], new Vector3(), geometry))
  assert.deepEqual(geometry.max, new Vector3(4, 3, 2.2), 'fallback does not mutate caller bounds')
})

test('the same storey field covers both rooms, their threshold and the outside approach', () => {
  const floors = [{ id: 'floor', elevation: 0, height: 3, rooms: [
    { signature: 'left', polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
    { signature: 'right', polygon: [{ x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 4, y: 4 }] },
  ] }]
  const first = modellingLightingVolume(floors, new Vector3(2, 1, 2))!
  assert.match(first.key, /^storey:floor:/)
  for (const position of [new Vector3(4, 1, 2), new Vector3(7, 1, 2), new Vector3(2, 12, -10)]) {
    assert.deepEqual(modellingLightingVolume(floors, position), first)
  }
  assert.ok(first.bounds.min.x < 0 && first.bounds.max.x > 8)
  assert.ok(first.anchor.x < 3.8, 'the main capture starts in a room')
  assert.equal(first.additionalAnchors?.length, 1)
  assert.ok(first.additionalAnchors![0].x > 4, 'the other room has its own capture origin')
})

test('modelling status discloses fallback and pending replacement', () => {
  assert.match(modellingLightingStatus('unavailable', false, false), /using cached\/direct lighting/)
  assert.match(modellingLightingStatus('ready', true, true), /Updating/)
  assert.match(modellingLightingStatus('ready', false, true), /3 diffuse bounces/)
})
