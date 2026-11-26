import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'

const browser = await lightingBrowser()
const mouse = (type, point, options) => browser.call('Input.dispatchMouseEvent', { type, ...point, ...options })
const press = point => mouse('mousePressed', point, { button: 'left', buttons: 1, clickCount: 1 })
const release = point => mouse('mouseReleased', point, { button: 'left', buttons: 0, clickCount: 1 })
const model = () => browser.evaluate('handleFloor.models[0]')
const viewport = () => browser.evaluate('handleStage().position()')

try {
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/objectHandlesRegression.html` })
  await browser.wait('!!window.handleStage?.()?.findOne("Rect") && !!window.handleFloor')
  await browser.evaluate('window.handleSelectModel(null)')
  await browser.wait('window.handleSelection === null && handleStage().find("Rect").every(node => node.width() !== 14)')
  const initialModel = await model()
  const initialViewport = await viewport()
  const center = await browser.evaluate(`(() => {
    const stage = handleStage()
    const { x, y } = handleFloor.models[0].position
    const point = stage.getAbsoluteTransform().point({ x: x * 60, y: y * 60 })
    const rect = stage.container().getBoundingClientRect()
    return { x: rect.left + point.x, y: rect.top + point.y }
  })()`)
  const firstRelease = { x: center.x + 14, y: center.y + 8 }
  await press(center)
  await mouse('mouseMoved', firstRelease, { buttons: 1 })
  assert.equal(await browser.evaluate('handleSelection'), null)
  assert.equal(await browser.evaluate('handlePreview()'), null)
  assert.deepEqual(await model(), initialModel)

  await release(firstRelease)
  await browser.wait('handleSelection === "handle-box" && handleStage().find("Rect").some(node => node.width() === 14)')
  assert.equal(await browser.evaluate('window.handleCommits ?? 0'), 0)
  assert.deepEqual(await model(), initialModel)
  assert.deepEqual(await viewport(), initialViewport)

  const secondRelease = { x: center.x + 35, y: center.y + 25 }
  await press(center)
  await mouse('mouseMoved', secondRelease, { buttons: 1 })
  await browser.wait('handlePreview()?.updates.position.x > 3')
  await release(secondRelease)
  await browser.wait('window.handleCommits === 1')
  assert.ok((await model()).position.x > initialModel.position.x)
  assert.equal(await browser.evaluate('handleSelection'), 'handle-box')
  assert.deepEqual(await viewport(), initialViewport)
  assert.deepEqual(browser.errors, [])
  console.log('Passed 2D object selection on first release and movement on the next drag')
} finally {
  browser.close()
}
