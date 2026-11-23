import assert from 'node:assert/strict'
import test from 'node:test'
import { ModellingViewportPerformance } from '../src/modellingViewportPerformance.ts'

test('sustained sub-10 FPS cuts pixel work and brief pauses keep the same resolution', () => {
  const controller = new ModellingViewportPerformance()
  for (let time = 100; time <= 700; time += 120) {
    assert.equal(controller.update(time, true, true).resolution, time < 700 ? 1 : .5)
    controller.presented(time)
  }
  assert.deepEqual(controller.update(1100, false, true), { moving: false, measure: false, resolution: .5 })
  assert.equal(controller.update(1150, true, true).resolution, .5)
  assert.equal(controller.update(2351, false, true).resolution, 1, 'a deliberate stop restores the full pixel count')
})

test('a stall between otherwise normal kitchen frames cannot make quality flicker', () => {
  const controller = new ModellingViewportPerformance()
  let time = 100
  for (const interval of [29, 29, 29, 1400, 29, 29, 29, 190, 29, 29, 29, 29]) {
    assert.equal(controller.update(time, true, true).resolution, 1)
    controller.presented(time)
    time += interval
  }
  assert.equal(controller.update(time, true, true).resolution, 1)
})

test('quality only goes back up during motion with sustained frame time headroom', () => {
  const controller = new ModellingViewportPerformance()
  const draw = (time: number) => {
    const display = controller.update(time, true, true)
    controller.presented(time)
    return display.resolution
  }
  for (let time = 100; time <= 700; time += 120) draw(time)
  for (let time = 730; time < 5200; time += 24) assert.equal(draw(time), .5)
  const scales = new Set<number>()
  for (let time = 5200; time < 14900; time += 16) scales.add(draw(time))
  assert.deepEqual([...scales], [.5, .65, .8, 1])
})
