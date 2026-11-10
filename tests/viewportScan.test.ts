import assert from 'node:assert/strict'
import test from 'node:test'
import { Scene } from 'three'
import { createViewportScanScheduler } from '../src/viewportScan.ts'
import { requestShaderWarmup, subscribeShaderWarmup } from '../src/shaderWarmupState.ts'

test('a wall update wakes a scene scan immediately instead of waiting for its 500 ms poll', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const scene = new Scene()
  let scans = 0
  const scheduler = createViewportScanScheduler(async () => { scans++ })
  const unsubscribe = subscribeShaderWarmup(scene, scheduler.request)
  try {
    scheduler.request(); t.mock.timers.tick(0); await Promise.resolve()
    assert.equal(scans, 1)
    t.mock.timers.tick(100)
    requestShaderWarmup(scene)
    t.mock.timers.tick(0); await Promise.resolve()
    assert.equal(scans, 2, 'an edit at 100 ms cannot wait until the poll at 500 ms')
    t.mock.timers.tick(500); await Promise.resolve()
    assert.equal(scans, 3, 'unannounced changes retain a fallback scan')
    unsubscribe(); scheduler.dispose()
    requestShaderWarmup(scene); t.mock.timers.tick(1000); await Promise.resolve()
    assert.equal(scans, 3, 'unmounted consumers cannot restart scanning')
  } finally { unsubscribe(); scheduler.dispose() }
})

test('edits arriving during a scan coalesce into one fresh pass without overlapping mutations', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release!: () => void, scans = 0, active = 0, maximum = 0
  const scheduler = createViewportScanScheduler(async () => {
    scans++; active++; maximum = Math.max(maximum, active)
    if (scans === 1) await new Promise<void>(resolve => { release = resolve })
    active--
  })
  try {
    scheduler.request(); t.mock.timers.tick(0)
    scheduler.request(); scheduler.request(); scheduler.request()
    assert.equal(scans, 1)
    release()
    for (let i = 0; i < 4; i++) await Promise.resolve()
    assert.equal(scans, 2)
    assert.equal(maximum, 1)
    scheduler.dispose(); t.mock.timers.tick(1000)
    assert.equal(scans, 2)
  } finally { scheduler.dispose() }
})

test('disposing an in-flight scan prevents both a queued edit and future polling', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release!: () => void, scans = 0
  const scheduler = createViewportScanScheduler(async () => {
    scans++
    await new Promise<void>(resolve => { release = resolve })
  })
  scheduler.request(); t.mock.timers.tick(0)
  scheduler.request(); scheduler.dispose(); release()
  for (let i = 0; i < 4; i++) await Promise.resolve()
  t.mock.timers.tick(1000)
  assert.equal(scans, 1)
})
