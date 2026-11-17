import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalLightControl } from '../src/localLightControl.ts'

test('latest switch survives deferred slot updates and a gap between subscriptions', () => {
  const control = createLocalLightControl()
  let displayed = true
  const mount = (authored: boolean) => {
    const update = () => { displayed = control.getEnabled('lamp') ?? authored }
    update()
    return control.subscribe('lamp', update)
  }
  let unmount = mount(true)
  control.setEnabled('lamp', false)
  assert.equal(displayed, false)
  unmount(); unmount = mount(true)
  assert.equal(displayed, false, 'old React props must not turn a disabled lamp back on')
  unmount(); control.setEnabled('lamp', true); unmount = mount(false)
  assert.equal(displayed, true, 'a switch during pool reassignment must not be lost')
  unmount()
})

test('history and project restoration replace live switches, including reused lamp ids', () => {
  const control = createLocalLightControl()
  control.setEnabled('lamp', false)
  control.setEnabled('removed', true)
  let notified = 0
  control.subscribe('lamp', () => notified++)
  control.restore([['lamp', true]])
  assert.equal(control.getEnabled('lamp'), true)
  assert.equal(control.getEnabled('removed'), undefined)
  assert.equal(notified, 1)
  control.restore([])
  assert.equal(control.getEnabled('lamp'), undefined)
})
