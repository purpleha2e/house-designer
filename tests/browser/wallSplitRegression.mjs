import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'

const browser = await lightingBrowser()
const corners = [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 6 }, { x: 1, y: 6 }]
const walls = corners.map((start, index) => ({ id: `wall-${index}`, start, end: corners[(index + 1) % 4],
  kind: 'external', thickness: .3, height: 2.6, allowRoofClipHeight: true }))
walls[0].openings = [{ id: 'threshold', modelId: 'manual-opening', center: 5, width: 1, bottom: 0, height: 2 }]
const windowId = 'placed-window'
const windowDefinition = { id: 'split-test-window', name: 'Test window', category: 'Windows', shape: 'box', color: '#cbd5e1',
  width: 1, height: 1, depth: .12, wallMount: 'window' }
const models = [{ id: windowId, modelId: windowDefinition.id, position: { x: 7.5, y: 1 }, scale: 1, rotation: 0,
  wallAttachment: { wallId: 'wall-0', offset: 6.5, side: 1 } }]
const floor = { id: 'ground', name: 'Ground', elevation: 0, roomHeight: 2.6, slabThickness: .2, rooms: [], roofs: [], walls, models }
const surfaceAssignments = [
  { id: 'wall-finish', materialId: 'default-internal-wall', target: { type: 'wall-face', wallId: 'wall-0', side: 1 } },
  { id: 'panel-finish', materialId: 'default-internal-wall', customColor: '#224488', target: {
    type: 'wall-surface-fragment', wallId: 'wall-0', side: 1, fragmentId: 'perimeter-wall:wall-0:1:side:2:5:0:2.6',
  } },
  { id: 'portal-finish', materialId: 'herringbone', target: { type: 'portal-floor', floorId: floor.id, wallId: 'wall-0', openingId: 'threshold' } },
]
const fixture = { activeFloorId: floor.id, wallKind: 'external', floors: [floor], surfaceAssignments, modelDefinitions: [windowDefinition] }
const wait = expression => browser.wait(expression, 20000)
const button = label => `[...document.querySelectorAll('button')].find(button => button.textContent.trim()===${JSON.stringify(label)})`
const guide = `recoveryKonva.stages[0].findOne('.wall-split-guide')`
const clickButton = expression => browser.evaluate(`(${expression}).click()`)
const position = (x, y) => browser.evaluate(`(()=>{const s=recoveryKonva.stages[0],r=s.container().getBoundingClientRect();return {
  x:r.x+s.x()+${x}*60*s.scaleX(),y:r.y+s.y()+${y}*60*s.scaleY()}})()`)
const move = async (x, y) => browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...await position(x, y) })
async function clickPlan(x, y) {
  const point = await position(x, y)
  await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...point })
  await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...point })
}
async function startSplit() {
  await clickButton('document.querySelector(\'[aria-label="Wall tools"]\')')
  await wait(`!!(${button('Split wall')})`)
  await clickButton(button('Split wall'))
  await wait('editorProps("FloorplanCanvas").isSplittingWall')
}

try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false })
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `${projectFileInputFixtureSource}
    window.alert=message=>{throw Error(message)};
    window.projectFileFixture=async()=>[{getFile:async()=>new File([${JSON.stringify(JSON.stringify(fixture))}],'wall-split.house.json')}];` })
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5188}/tests/browser/editorRegression.html` })
  await wait(`!!window.recoveryKonva?.stages[0] && !!document.querySelector('[aria-label="Project menu"]')`)
  await browser.evaluate(`window.editorProps=name=>{
    const root=document.getElementById('root'),key=Object.keys(root).find(k=>k.startsWith('__reactContainer$'));
    function find(fiber){if(!fiber)return; if(fiber.type?.name===name)return fiber.memoizedProps;return find(fiber.child)??find(fiber.sibling)}
    return find(root[key].stateNode.current)
  }`)
  await clickButton(`document.querySelector('[aria-label="Project menu"]')`)
  await wait(`!!(${button('Load')})`)
  await clickButton(button('Load'))
  await wait(`(()=>{[...document.querySelectorAll('dialog button')].find(button=>/discard changes and open/i.test(button.textContent))?.click();
    const f=editorProps('FloorplanCanvas')?.activeFloor;return f?.id==='ground' && f.rooms.length===1 && f.walls[0].openings?.length===2})()`)
  const before = await browser.evaluate(`editorProps('FloorplanCanvas').activeFloor`)

  await startSplit()
  await move(8.5, 1)
  await wait(`${guide}?.findOne('Text')?.text()==='0.50 m'`)
  await move(6, 1)
  await wait(`document.querySelector('.floorplan-wall-hint [role="status"]').textContent.includes('opening')`)
  await clickPlan(6, 1)
  assert.equal(await browser.evaluate(`editorProps('FloorplanCanvas').activeFloor.walls.length`), 4)
  await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await wait(`!editorProps('FloorplanCanvas').isSplittingWall && !${guide}`)

  await startSplit()
  await move(4, 1)
  await wait(`${guide}?.findOne('Text')?.text()==='3.00 m'`)
  await clickPlan(4, 1)
  await wait(`editorProps('FloorplanCanvas').activeFloor.walls.length===5`)
  const after = await browser.evaluate(`editorProps('FloorplanCanvas').activeFloor`)
  const [first, second] = after.walls
  assert.equal(first.id, 'wall-0')
  assert.ok(Math.abs(first.end.x - 4) < .01)
  assert.deepEqual(first.end, second.start)
  assert.deepEqual(second.end, before.walls[0].end)
  assert.equal(second.height, 2.6)
  assert.equal(second.thickness, .3)
  assert.equal(second.allowRoofClipHeight, true)
  assert.deepEqual(after.rooms, before.rooms)
  assert.deepEqual(after.models[0].position, before.models[0].position)
  assert.equal(after.models[0].wallAttachment.wallId, second.id)
  assert.equal(after.models[0].wallAttachment.side, 1)
  assert.ok(Math.abs(after.models[0].wallAttachment.offset - 3.5) < .01)
  assert.deepEqual(second.openings.map(opening => opening.id), ['threshold', windowId])
  assert.ok(Math.abs(second.openings[0].center - 2) < .01)
  assert.ok(Math.abs(second.openings[1].center - 3.5) < .01)
  assert.equal(await browser.evaluate(`editorProps('FloorplanCanvas').selectedWallId`), second.id)
  const assignments = await browser.evaluate(`editorProps('ThreeDView').surfaceAssignments`)
  assert.equal(assignments.filter(assignment => assignment.target.type === 'wall-face').length, 2)
  assert.ok(assignments.some(assignment => assignment.target.wallId === second.id && assignment.target.fragmentId === `perimeter-wall:${second.id}:1:side:2:5:0:2.6`))
  assert.equal(assignments.find(assignment => assignment.id === 'portal-finish').target.wallId, second.id)

  await clickButton(`document.querySelector('[aria-label="Undo"]')`)
  await wait(`editorProps('FloorplanCanvas').activeFloor.walls.length===4 && !editorProps('FloorplanCanvas').isSplittingWall`)
  assert.deepEqual(await browser.evaluate(`editorProps('FloorplanCanvas').activeFloor`), before)
  assert.deepEqual(await browser.evaluate(`editorProps('ThreeDView').surfaceAssignments`), surfaceAssignments)
  await clickButton(`document.querySelector('[aria-label="Redo"]')`)
  await wait(`editorProps('FloorplanCanvas').activeFloor.walls[1]?.id===${JSON.stringify(second.id)}`)
  assert.deepEqual(await browser.evaluate(`editorProps('FloorplanCanvas').activeFloor`), after)
  assert.deepEqual(browser.errors, [])
  console.log('Passed Split wall tool, nearest-end ruler, opening guard, attachments, finishes and undo/redo')
} finally {
  browser.close()
}
