import assert from 'node:assert/strict'
import test from 'node:test'
import { CameraInputTiming, isViewportNavigating, markViewportNavigation, isViewportPreparationPending, publishViewportUpdate, runViewportPreparation, subscribeViewportPreparation } from '../src/viewportScheduling.ts'

test('camera integrates current frame time and discards time lost to a stall', () => {
  const timing = new CameraInputTiming(0)
  assert.equal(timing.frame(1 / 60, 17), 1 / 60)
  assert.equal(timing.frame(.08, 97), .05)
  assert.equal(timing.frame(18, 18097), 0, 'an 18 second freeze must never teleport the camera')
  assert.equal(timing.frame(1 / 60, 18114), 1 / 60, 'a held key resumes at normal speed')
  assert.equal(timing.frame(Infinity, 18130), 0)
})
test('queued press and look input is discarded before and after a blocked frame', () => {
  const timing = new CameraInputTiming(1000)
  assert.equal(timing.accepts(1005, 1010), true)
  assert.equal(timing.accepts(1015, 6000), false)
  assert.equal(timing.accepts(5999, 6000), false, 'coalesced motion cannot bypass the frame gap')
  timing.frame(5, 6000)
  assert.equal(timing.accepts(5901, 6001), false, 'recent-looking events from before recovery are also stale')
  assert.equal(timing.accepts(6002, 6003), true)
})
test('background work yields during navigation and resumes after its idle grace period', () => {
  markViewportNavigation(1000)
  assert.equal(isViewportNavigating(1000), true)
  assert.equal(isViewportNavigating(1199), true)
  assert.equal(isViewportNavigating(1200), false)
})

test('cooperative geometry keeps the display gate pending through cancellation and failure', async () => {
  const changes: boolean[] = [], unsubscribe=subscribeViewportPreparation(()=>changes.push(isViewportPreparationPending()))
  try {
    const cancelled=runViewportPreparation((function*(){yield;return 'obsolete'})(),()=>true)
    assert.equal(isViewportPreparationPending(),true)
    assert.equal(await cancelled,undefined)
    assert.equal(isViewportPreparationPending(),false)
    await assert.rejects(runViewportPreparation((function*(){yield;throw Error('failed')})(),()=>false),/failed/)
    assert.equal(isViewportPreparationPending(),false)
    assert.deepEqual(changes,[true,false,true,false])
  } finally { unsubscribe() }
})

test('completed worker results wait for navigation to stop and obsolete results never publish', async () => {
  let applied=0
  markViewportNavigation()
  const update=publishViewportUpdate(()=>applied++,()=>false)
  await new Promise(resolve=>setTimeout(resolve,20))
  assert.equal(applied,0)
  assert.equal(isViewportPreparationPending(),true)
  markViewportNavigation(-Infinity)
  assert.equal(await update,true)
  assert.equal(applied,1)
  assert.equal(await publishViewportUpdate(()=>applied++,()=>true),undefined)
  assert.equal(applied,1)
  assert.equal(isViewportPreparationPending(),false)
})
