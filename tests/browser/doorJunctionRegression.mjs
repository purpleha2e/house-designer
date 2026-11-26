import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'

const browser = await lightingBrowser()
const definition = { id: 'junction-test-door', name: 'Test door', category: 'Doors', shape: 'box',
  wallMount: 'interior-door', color: '#e2e8f0', width: .9, openingWidth: .9, height: 2.1, depth: .15 }
const walls = [
  { id: 'host', start: { x: 1, y: 4 }, end: { x: 10, y: 4 }, kind: 'internal', thickness: .15, height: 2.4 },
  { id: 'return', start: { x: 5.02, y: 4.075 }, end: { x: 5.02, y: 7 }, kind: 'internal', thickness: .2, height: 2.4 },
]
const door = { id: 'door', modelId: definition.id, scale: 1, rotation: 0, position: { x: 3.5, y: 4 },
  wallAttachment: { wallId: 'host', offset: 2.5, side: 1 } }
const floor = { id: 'ground', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: .2,
  rooms: [], roofs: [], models: [door], walls }
const fixture = { activeFloorId: floor.id, wallKind: 'internal', floors: [floor], modelDefinitions: [definition] }
const model = `planProps().activeFloor.models.find(model=>model.id==='door')`
const stop = 5.02 - .1 - .45
const position = (x, y) => browser.evaluate(`(()=>{const s=recoveryKonva.stages[0],r=s.container().getBoundingClientRect();return {
  x:r.x+s.x()+${x}*60*s.scaleX(),y:r.y+s.y()+${y}*60*s.scaleY()}})()`)
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} should equal ${expected}`)

async function loadFixture() {
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5188}/tests/browser/editorRegression.html` })
  await browser.wait(`!!window.recoveryKonva?.stages[0] && !!document.querySelector('[aria-label="Project menu"]')`, 30000)
  await browser.evaluate(`window.planProps=()=>{
    const root=document.getElementById('root'),key=Object.keys(root).find(k=>k.startsWith('__reactContainer$'));
    function find(fiber){if(!fiber)return; if(fiber.type?.name==='FloorplanCanvas')return fiber.memoizedProps;return find(fiber.child)??find(fiber.sibling)}
    return find(root[key].stateNode.current)
  };document.querySelector('[aria-label="Project menu"]').click()`)
  await browser.wait(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Load')`, 10000)
  await browser.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Load').click()`)
  await browser.wait(`(()=>{[...document.querySelectorAll('dialog button')].find(button=>/discard changes and open/i.test(button.textContent))?.click();
    return ${model}?.wallAttachment?.wallId==='host'})()`, 30000)
}

try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false })
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `${projectFileInputFixtureSource}
    window.projectFileFixture=async()=>[{getFile:async()=>new File([${JSON.stringify(JSON.stringify(fixture))}],'door-junction.house.json')}];` })
  await loadFixture()

  // Drag past the T-junction in one pointer gesture, with the leaf swinging away from the return.
  const from = await position(3.5, 4)
  await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
  await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 })
  for (const x of [3.7, 4.2, 5, 7]) {
    await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...await position(x, 4), button: 'left', buttons: 1 })
  }
  await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...await position(7, 4), button: 'left', buttons: 0, clickCount: 1 })
  await browser.wait(`${model}.position.x!==3.5`, 10000)
  const moved = await browser.evaluate(model)
  closeTo(moved.position.x, stop)
  closeTo(moved.wallAttachment.offset, stop - 1)
  assert.equal(moved.wallAttachment.wallId, 'host')
  closeTo(await browser.evaluate(`planProps().activeFloor.walls[0].openings[0].center+.45`), 3.92)

  await browser.evaluate(`document.querySelector('[aria-label="Undo"]').click()`)
  await browser.wait(`${model}.position.x===3.5`, 10000)
  await loadFixture()
  await browser.evaluate(`planProps().onSelectModel('door')`)
  await browser.evaluate(`window.doorControl=()=>{let control;perfScene()?.scene.traverse(o=>{
    if(o.isTransformControls&&o.object?.name==='model-transform-door')control=o
  });return control}`)
  await browser.wait(`Math.abs((doorControl()?.object.position.x ?? 0)-3.5)<1e-6`, 20000)
  const previewX = await browser.evaluate(`(()=>{const control=doorControl();
    control.dispatchEvent({type:'mouseDown',mode:'translate'});
    control.object.position.x=7;
    control.dispatchEvent({type:'objectChange'});
    const x=control.object.position.x;
    control.dispatchEvent({type:'mouseUp',mode:'translate'});
    return x
  })()`)
  closeTo(previewX, stop)
  await browser.wait(`Math.abs(${model}.position.x-${stop})<1e-6`, 10000)
  assert.deepEqual(browser.errors, [])
  console.log('Passed door junction stops in the plan and 3D, including opening clearance and undo')
} finally {
  browser.close()
}
