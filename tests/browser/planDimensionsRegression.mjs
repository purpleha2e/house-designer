import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'

const origin = `http://127.0.0.1:${process.argv[2] ?? '5188'}`
const browser = await lightingBrowser()
const evaluate = (fn, ...args) => browser.evaluate(`(${fn})(...${JSON.stringify(args)})`)
const wall = (id, x1, y1, x2, y2, kind = 'external', thickness = .3) => ({
  id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, kind, thickness, height: 2.4,
})
const perimeter = [
  wall('left', 1, 1, 1, 7),
  wall('bottom', 1, 7, 7.7, 7),
  wall('right', 7.7, 7, 7.7, 1),
  wall('top', 1, 1, 4.1, 1),
]
const replaceWalls = walls => evaluate(walls => handleSetFloor(floor => ({
  ...floor, walls, models: [],
})), walls)
const read = () => evaluate(() => {
  const group = handleStage().findOne('.dimension-rulers')
  return {
    lines: group.find('Line').filter(line => line.dash()?.length).map(line => line.points()),
    labels: group.find('Text').map(text => Number.parseFloat(text.text())).sort((a, b) => a - b),
  }
})
const setOption = (name, enabled) => evaluate((name, enabled) => {
  const label = [...document.querySelectorAll('#floorplan-settings-menu label')]
    .find(candidate => candidate.textContent.trim() === name)
  const input = label?.querySelector('input')
  if (!input) throw Error(`Missing 2D setting ${name}`)
  if (input.checked !== enabled) input.click()
}, name, enabled)
const expectCount = count => browser.wait(`handleStage().findOne('.dimension-rulers').find('Text').length===${count}`, 10000)
const offsetField = 'input[aria-label="Distance from nearest wall"]'
const distanceButton = "Array.from(document.querySelectorAll('.floorplan-wall-hint button')).find(button=>button.textContent.trim()==='Distance from nearest wall')"
const lengthField = '.draft-length-panel:not(.wall-start-offset-panel) input'
const point = (x, y) => evaluate((x, y) => {
  const stage = handleStage()
  const bounds = stage.container().getBoundingClientRect()
  return { x: bounds.left + stage.x() + x * 60 * stage.scaleX(), y: bounds.top + stage.y() + y * 60 * stage.scaleY() }
}, x, y)
const move = async (x, y) => browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...await point(x, y) })
async function click(x, y) {
  const position = await point(x, y)
  await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position })
  await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position })
}
async function key(key) {
  await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key })
  await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key })
}
async function fillOffset(value) {
  await evaluate(selector => document.querySelector(selector).select(), offsetField)
  await browser.call('Input.insertText', { text: value })
}
const isInside = ([x1, y1, x2, y2]) => {
  const x = (x1 + x2) / 120
  const y = (y1 + y2) / 120
  return x > 1 && x < 7.7 && y > 1 && y < 7
}

try {
  await browser.call('Emulation.setDeviceMetricsOverride',{ width: 1500, height: 900, deviceScaleFactor: 1, mobile: false })
  await browser.call('Page.navigate', { url: origin + '/tests/browser/objectHandlesRegression.html' })
  await browser.wait("typeof handleSetFloor==='function' && !!handleStage()?.findOne('.dimension-rulers')", 30000)
  await replaceWalls(perimeter)
  await expectCount(8)
  assert.equal((await read()).lines.filter(isInside).length, 4)

  await browser.evaluate("document.querySelector('[aria-controls=\"floorplan-settings-menu\"]').click()")
  await setOption('External dimensions', false)
  await expectCount(4)
  const inside = await read()
  assert.deepEqual(inside.labels, [2.95, 5.7, 5.85, 6.4])
  assert.ok(inside.lines.every(isInside), 'Clear dimensions must be drawn inside the open plan')

  await setOption('Internal dimensions', false)
  await expectCount(0)
  await setOption('External dimensions', true)
  await expectCount(4)
  const outside = await read()
  assert.ok(outside.labels.includes(7), 'Overall perimeter width remains 7.00 m')
  assert.ok(outside.lines.every(line => !isInside(line)))

  const splitPerimeter = [
    wall('upper-left', 1, 1, 1, 3.69), wall('lower-left', 1, 7, 1, 3.69),
    ...perimeter.slice(1, 3), wall('top', 1, 1, 7.7, 1),
  ]
  const returnWall = wall('return', 1, 3.69, 7.7, 3.69)
  for (const walls of [splitPerimeter, [...splitPerimeter, returnWall], [
    splitPerimeter[0], wall('lower-left', 1, 7, 1.01, 3.71), ...splitPerimeter.slice(2), returnWall,
  ]]) {
    await replaceWalls(walls)
    await expectCount(walls.length)
    // The two wall segments run in opposite directions in the saved plan.
    const { lines, labels } = await read()
    const leftIntervals = lines.filter(([x1, , x2]) =>
      Math.abs(x1 / 60 - .57) < 1e-6 && Math.abs(x2 - x1) < 1e-6,
    ).map(([, y1, , y2]) => [Math.min(y1, y2), Math.max(y1, y2)].map(y => Number((y / 60).toFixed(3))))
      .sort(([a], [b]) => a - b)
    assert.deepEqual(leftIntervals, [[.85, 3.69], [3.69, 7.15]],
      'Exterior dimensions share the joint centre, including at an inside return and after snapping a saved endpoint')
    assert.ok(labels.includes(2.84) && labels.includes(3.46), 'Each wall keeps its own measured length')
  }

  // The left exterior changes heading slightly at the join. The upper room's
  // bottom face is shared by walls of different thicknesses on the same line.
  const upperRoomWalls = [
    wall('upper-left', 1, 1, 1.0216, 4.99), wall('lower-left', 1.0216, 8, 1.0216, 4.99),
    wall('top', 1, 1, 11, 1), wall('right', 11, 1, 11.02, 8), wall('bottom', 11.02, 8, 1.0216, 8),
    wall('split-left', 1.0216, 4.99, 7.5, 4.99), wall('partition', 7.5, 4.99, 7.5, 8),
    wall('split-right', 7.65, 4.915, 11.01, 4.915, 'internal', .15),
  ]
  await replaceWalls(upperRoomWalls)
  await expectCount(7)
  const bentRulers = (await read()).lines.filter(([x1, , x2]) => x1 / 60 < .6 && x2 / 60 < .6)
  const ticks = bentRulers.flatMap(([x1, y1, x2, y2]) => [[x1, y1], [x2, y2]])
    .filter(([, y]) => Math.abs(y / 60 - 4.99) < .01)
  assert.equal(ticks.length, 2)
  assert.ok(Math.hypot(ticks[0][0] - ticks[1][0], ticks[0][1] - ticks[1][1]) < 1e-6,
    'The two exterior rulers share one exact tick across a slight bend')

  await setOption('External dimensions', false)
  await setOption('Internal dimensions', true)
  await expectCount(12)
  const topRoomLengths = (await read()).lines.filter(([x1, y1, x2, y2]) =>
    Math.min(x1, x2) / 60 > 1 && Math.max(x1, x2) / 60 < 11 &&
    Math.min(y1, y2) / 60 > 1.1 && Math.max(y1, y2) / 60 < 4.9,
  ).map(([x1, y1, x2, y2]) => Number((Math.hypot(x2 - x1, y2 - y1) / 60).toFixed(2))).sort((a, b) => a - b)
  assert.deepEqual(topRoomLengths, [3.69, 3.69, 9.69, 9.7],
    'The room has clear depths along the sloped walls and one width across the adjoining faces')

  await replaceWalls([wall('left-open', 2, 2, 5, 2, 'internal', .15), wall('right-open', 8, 2, 5, 2, 'internal', .15)])
  await expectCount(2)
  assert.deepEqual((await read()).labels, [6, 6], 'Continuous faces also share one measurement in an open plan')

  await replaceWalls([
    ...perimeter.slice(0, 3),
    wall('top', 7.7, 1, 1, 1),
    wall('partition', 4.35, 1, 4.35, 7, 'internal', .2),
  ])
  await expectCount(8)
  const divided = await read()
  assert.deepEqual(divided.labels, [3.1, 3.1, 3.1, 3.1, 5.7, 5.7, 5.7, 5.7])
  assert.ok(divided.lines.every(isInside), 'Exterior wall direction does not move dimensions outside')

  // The short external return at the extension meets a wall on its left at
  // the start and turns right at its other end. Its exposed left face reaches
  // the far edge of that corner.
  const extension = [
    wall('old-bottom', 1, 6, 5, 6), wall('old-left', 1, 6, 1, 1),
    wall('old-top', 1, 1, 5, 1), wall('old-right', 5, 6, 5, 1),
    wall('extension-return', 5, 6, 5, 6.95), wall('extension-end', 5, 6.95, 8, 6.95),
    wall('extension-outer', 8, 6.95, 8, -.8),
  ]
  for (const reversed of [false, true]) {
    await replaceWalls(reversed ? extension.map(w => ({ ...w, start: w.end, end: w.start })) : extension)
    await browser.wait(`handleFloor.walls.find(w=>w.id==='extension-return')?.start.y===${reversed ? 6.95 : 6}`)
    const ruler = (await read()).lines.find(([x1, y1, x2, y2]) =>
      Math.abs(x1 / 60 - 4.57) < 1e-6 && Math.abs(x2 - x1) < 1e-6 && Math.min(y1, y2) / 60 > 6)
    assert.ok(ruler, 'The exposed side of the extension return has a dimension')
    assert.ok(Math.abs(Math.min(ruler[1], ruler[3]) / 60 - 6.15) < 1e-6)
    assert.ok(Math.abs(Math.max(ruler[1], ruler[3]) / 60 - 7.10) < 1e-6,
      'The ruler ends at the far edge of the external corner')
  }

  await browser.evaluate("document.querySelector('[aria-controls=\"floorplan-settings-menu\"]').click()")
  await replaceWalls(perimeter)
  await browser.evaluate('handleWallMode(true)')
  await browser.wait('handleFloor.walls.length===4')
  await browser.evaluate("document.querySelector('[aria-label=\"Reset zoom\"]').focus()")
  await move(3.85, 6.89)
  await browser.wait("!!handleStage().findOne('.wall-start-guide')", 10000)
  const hoverOffset = await browser.evaluate("parseFloat(handleStage().findOne('.wall-start-guide').findOne('Text').text())")
  assert.ok(Math.abs(hoverOffset - 2.625) < .03, 'The guide measures from the inside face to the new edge')

  await key('2')
  await browser.wait(`document.activeElement===document.querySelector(${JSON.stringify(offsetField)})`)
  await fillOffset('2.50')
  await key('Enter')
  await browser.wait(`!!(${distanceButton})`)
  assert.equal(await browser.evaluate('handleFloor.walls.length'), 4, 'Confirming the offset only starts the draft')
  await move(3.725, 4.9)
  await click(3.725, 4.9)
  await browser.wait('handleFloor.walls.length===5')
  let start = await browser.evaluate('handleFloor.walls.at(-1).start')
  assert.ok(Math.abs(start.x - 3.725) < 1e-6)
  assert.ok(Math.abs(start.y - 7) < 1e-6)

  await replaceWalls(perimeter)
  await browser.wait('handleFloor.walls.length===4')
  await move(6.1, 6.9)
  await click(6.1, 6.9)
  await browser.wait(`!!(${distanceButton})`)
  await move(6.1, 4.8)
  await key('2')
  await browser.wait(`document.querySelector(${JSON.stringify(lengthField)})?.value==='2'`)
  await browser.evaluate(`(${distanceButton}).click()`)
  await browser.wait(`document.activeElement===document.querySelector(${JSON.stringify(offsetField)})`)
  await fillOffset('20')
  await key('Enter')
  assert.equal(await evaluate(selector => document.querySelector(selector).getAttribute('aria-invalid'), offsetField), 'true')
  await fillOffset('1,80')
  await key('Enter')
  await browser.wait(`!!(${distanceButton}) && document.querySelector(${JSON.stringify(lengthField)})?.value==='2'`)
  assert.equal(await browser.evaluate('handleFloor.walls.length'), 4)
  await key('Enter')
  await browser.wait('handleFloor.walls.length===5')
  start = await browser.evaluate('handleFloor.walls.at(-1).start')
  assert.ok(Math.abs(start.x - 5.675) < 1e-6, 'Changing the offset measures from the nearer right-hand wall')
  assert.ok(Math.abs(start.y - 7) < 1e-6)

  await replaceWalls([...perimeter, wall('tee', 4.35, 7, 4.35, 5.2, 'internal', .2)])
  await browser.wait("handleFloor.walls.some(wall=>wall.id==='tee')")
  await move(3.85, 6.89)
  await browser.wait("!!handleStage().findOne('.wall-start-guide')", 10000)
  const teeOffset = await browser.evaluate("parseFloat(handleStage().findOne('.wall-start-guide').findOne('Text').text())")
  assert.ok(Math.abs(teeOffset - .325) < .03, 'A nearby T-junction is measured from its face')

  assert.deepEqual(browser.errors, [])
  console.log('Passed shared exterior ticks, inside dimensions, live wall-start guides and separate offset and length editing')
} finally {
  browser.close()
}
