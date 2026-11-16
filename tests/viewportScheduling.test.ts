import assert from 'node:assert/strict'
import test from 'node:test'
import { CameraInputTiming, isViewportNavigating, markViewportNavigation, isViewportPreparationPending, publishViewportUpdate, runViewportPreparation, subscribeViewportPreparation, installViewportInputPriority, isViewportInteracting, markViewportInteraction } from '../src/viewportScheduling.ts'

test('2D gestures, selection and menu input defer background publication without passive-hover starvation', async () => {
  const target = new EventTarget(), remove = installViewportInputPriority(target)
  markViewportNavigation(-Infinity); markViewportInteraction(-Infinity)
  try {
    target.dispatchEvent(new Event('pointermove'))
    assert.equal(isViewportInteracting(), false)
    for (const type of ['pointerdown', 'wheel', 'keydown', 'input', 'pointermove']) {
      const event = new Event(type); Object.defineProperty(event, 'buttons', { value: 1 })
      target.dispatchEvent(event)
      let published = false
      const task = publishViewportUpdate(() => { published = true }, () => false)
      await new Promise(resolve => setTimeout(resolve, 10))
      assert.equal(published, false, `${type} has priority over background publication`)
      markViewportInteraction(-Infinity)
      await task
      assert.equal(published, true)
    }
  } finally { remove(); markViewportInteraction(-Infinity) }
  target.dispatchEvent(new Event('pointerdown'))
  assert.equal(isViewportInteracting(), false, 'cleanup releases global input listeners')
})

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

test('slow GPU frames keep keyboard and look input responsive without catch-up movement', () => {
  for (const fps of [3,5,9,10,15]) {
    const timing = new CameraInputTiming(0), delta=1/fps
    let movement=0
    for (let frame=1;frame<=10;frame++) {
      const now=frame*delta*1000
      assert.equal(timing.accepts(now-20,now-1),true,`${fps} FPS accepts fresh input between draws`)
      movement+=timing.frame(delta,now)
      assert.equal(timing.didStall,false,`${fps} FPS must not reset mouse look on every frame`)
    }
    assert.ok(Math.abs(movement-.5)<1e-8, 'movement advances in bounded 50ms steps')
    assert.equal(timing.frame(.8,4000),0)
    assert.equal(timing.didStall,true,'an actual stall still resets queued mouse motion')
    assert.equal(timing.accepts(3800,4001),false)
  }
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
