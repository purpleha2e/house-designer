import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'

const browser = await lightingBrowser()
const wait = (expression, timeout = 18000) => browser.wait(expression, timeout)
const first = 'properties-first', second = 'properties-second'
const modelDefinitions = [{ id: 'properties-box', name: 'Properties test box', category: 'Furniture',
  shape: 'box', color: '#a16207', width: 1.1, depth: 1, height: 1 }]
const corners = [{ x: 1, y: 1 }, { x: 7, y: 1 }, { x: 7, y: 6 }, { x: 1, y: 6 }]
const models = [first, second].map((id, index) => ({ id, modelId: 'properties-box', scale: 1,
  position: { x: 3 + index * 2, y: 3 }, rotation: 0 }))
const floor = { id: 'ground', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: .2, rooms: [], roofs: [], models,
  walls: corners.map((start, i) => ({ id: `wall-${i}`, kind: 'external', start, end: corners[(i + 1) % 4], thickness: .25, height: 2.4 })) }
const panel = 'document.querySelector(".context-panel")'
const menu = 'document.querySelector(".canvas-context-menu")'
const properties = `Array.from(${menu}?.querySelectorAll('button') ?? []).find(button => button.textContent==='Properties')`
const mouse = (type, point, button = 'left', buttons = 0) => browser.call('Input.dispatchMouseEvent',
  { type, ...point, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 })
async function click(point, button = 'left') {
  await mouse('mouseMoved', point, 'none')
  await mouse('mousePressed', point, button, button === 'right' ? 2 : 1)
  await mouse('mouseReleased', point, button)
}
const control = expression => browser.evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
const plan = (x, y) => browser.evaluate(`(()=>{const s=recoveryKonva.stages[0],r=s.container().getBoundingClientRect();return {
  x:r.x+s.x()+${x}*60*s.scaleX(),y:r.y+s.y()+${y}*60*s.scaleY()}})()`)
const view = id => browser.evaluate(`(async()=>{const {Box3,Vector3}=await import('/tests/browser/rendererTestModules.ts');
  const s=perfScene(),g=s.scene.getObjectByName('model-transform-'+${JSON.stringify(id)});
  g.updateWorldMatrix(true,true);s.camera.updateMatrixWorld(true)
  const p=new Box3().setFromObject(g).getCenter(new Vector3()).project(s.camera),r=s.gl.domElement.getBoundingClientRect();
  return {x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2}})()`)

try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `${projectFileInputFixtureSource}
    window.alert=message=>{throw Error(message)};
    window.projectFileFixture=async()=>[{getFile:async()=>new File([${JSON.stringify(JSON.stringify({ activeFloorId: floor.id, wallKind: 'external', floors: [floor], modelDefinitions }))}],'properties.house.json')}];` })
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5188}/tests/browser/editorRegression.html` })
  await wait(`!!window.perfScene?.() && !!document.querySelector('[aria-label="Project menu"]')`)
  await browser.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Load')`)
  await browser.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Load').click()`)
  await wait(`(()=>{[...document.querySelectorAll('dialog button')].find(button=>/discard changes and open/i.test(button.textContent))?.click();
    const scene=perfScene()?.scene;return !!scene?.getObjectByName('model-transform-${second}')&&scene.userData.progressiveStartup?.phase==='full'})()`)
  await browser.evaluate(`window.selectedModel=()=>{
    const root=document.getElementById('root'),key=Object.keys(root).find(k=>k.startsWith('__reactContainer$'))
    function find(fiber){if(!fiber)return; if(fiber.type?.name==='FloorplanCanvas')return fiber.memoizedProps;return find(fiber.child)??find(fiber.sibling)}
    return find(root[key].stateNode.current)?.selectedModelId
  }`)
  await click(await plan(3, 3))
  await wait(`selectedModel()==='${first}'`)
  assert.equal(await browser.evaluate(`!!${panel}`), false, 'left-click selects without showing Properties')
  await click(await plan(3, 3), 'right')
  await wait(`!!(${properties})`)
  assert.equal(await browser.evaluate('selectedModel()'), first, 'right-click on a selected plan object keeps it selected')
  assert.equal(await browser.evaluate(`!!${panel}`), false)
  await click(await control(properties))
  await wait(`!!${panel}?.querySelector('[aria-label="Object transform"]')`)
  await click(await plan(3, 3))
  await wait(`${panel}?.textContent.includes('Select an item') && selectedModel()===null`)
  await click(await plan(5, 3), 'right')
  await wait(`selectedModel()==='${second}' && !!${menu}`)
  await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await wait(`!${menu} && !!${panel}?.querySelector('[aria-label="Object transform"]')`)
  await click(await control(`document.querySelector('[aria-label="Close properties"]')`))
  await wait(`!${panel}`)
  assert.equal(await browser.evaluate('selectedModel()'), second)

  await browser.evaluate(`(()=>{const s=perfScene();s.camera.position.set(6,8,10);s.camera.lookAt(4,0,3);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await click(await view(first))
  await wait(`selectedModel()==='${first}'`)
  await click(await view(first), 'right')
  await wait(`!!document.querySelector('.three-host .canvas-context-menu')`)
  assert.equal(await browser.evaluate('selectedModel()'), first, 'right-click on a selected 3D object keeps it selected')
  assert.equal(await browser.evaluate(`!!${panel} || !!document.pointerLockElement`), false)
  await click(await control(properties))
  await wait(`!!${panel}?.querySelector('[aria-label="Object transform"]')`)
  await browser.call('Runtime.evaluate', { expression: `document.querySelector('[aria-label="Enter fullscreen"]').click()`, userGesture: true })
  await wait(`!!document.fullscreenElement?.querySelector('.context-panel')`)
  await click(await control(`document.querySelector('[aria-label="Close properties"]')`))
  await wait(`(()=>{const s=perfScene(),r=s.gl.domElement.getBoundingClientRect();return !${panel}&&Math.abs(s.camera.aspect-r.width/r.height)<.01})()`)
  await browser.evaluate(`(()=>{const s=perfScene();s.camera.position.set(5,7,5);s.camera.lookAt(5,.5,3);s.camera.updateMatrixWorld();s.invalidate()})()`)
  const fullscreenTarget = await view(second)
  assert.equal(await browser.evaluate(`document.elementFromPoint(${fullscreenTarget.x},${fullscreenTarget.y})===perfScene().gl.domElement`), true)
  await click(fullscreenTarget, 'right')
  await wait(`selectedModel()==='${second}' && !!(${properties})`).catch(async error => {
    throw Error(`${error.message}\nFullscreen pick state ${JSON.stringify(await browser.evaluate(`({selected:selectedModel(),actions:${menu}?.textContent,locked:!!document.pointerLockElement})`))}`)
  })
  await click(await control(properties))
  await wait(`!!document.fullscreenElement?.querySelector('.context-panel')`)
  await click(await control(`document.querySelector('[aria-label="Close properties"]')`))
  const start = await view(second)
  await browser.evaluate('window.orientationBeforeDrag=perfScene().camera.quaternion.clone()')
  await mouse('mouseMoved', start, 'none')
  await mouse('mousePressed', start, 'right', 2)
  assert.equal(await browser.evaluate('!!document.pointerLockElement'), false)
  await mouse('mouseMoved', { x: start.x + 15, y: start.y }, 'right', 2)
  await wait('!!document.pointerLockElement', 10000)
  await mouse('mouseMoved', { x: start.x + 24, y: start.y }, 'right', 2)
  await mouse('mouseMoved', { x: start.x + 32, y: start.y }, 'right', 2)
  await wait('orientationBeforeDrag.angleTo(perfScene().camera.quaternion)>.005')
  await mouse('mouseReleased', start, 'right')
  await wait('!document.pointerLockElement')
  assert.equal(await browser.evaluate(`!!${menu} || !!${panel}`), false, 'camera drag leaves both overlays closed')
  await browser.evaluate('document.exitFullscreen()')
  await wait('!document.fullscreenElement')
  await click(await plan(4, 1), 'right')
  await wait(`!!(${properties})`)
  assert.match(await browser.evaluate(`${menu}.textContent`), /Delete wall/)
  await click(await control(properties))
  await wait(`!!${panel}?.querySelector('[aria-label="Wall height"]')`)
  assert.deepEqual(browser.errors, [])
  console.log('PASS request-only Properties, persistent selection inspector, fullscreen and 3D camera drag')
} finally { browser.close() }
