import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// Exercise the new empty project and personal IndexedDB libraries.
// This test is about editor state; omit the 3D renderer to avoid baking another
// full house while a user is working in their own editor.
const browser = await lightingBrowser({onEvent: async event => {
  if (event.method === 'Fetch.requestPaused') await browser.call('Fetch.fulfillRequest', {
    requestId: event.params.requestId, responseCode: 200,
    responseHeaders: [{name:'Content-Type',value:'text/javascript'}],
    body: Buffer.from('export function ThreeDView(){return null};export function StairContent(){return null};export function clearThreeDModelAssetCaches(){}').toString('base64'),
  }).catch(error=>{if(!/navigated or closed|Invalid InterceptionId/.test(error.message))throw error})
}})
try {
  await browser.call('Fetch.enable',{patterns:[{urlPattern:'*/src/components/ThreeDView.tsx*',requestStage:'Request'}]})
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirmations=[];window.confirm=message=>{confirmations.push(message);return false};window.alerts=[];window.alert=message=>alerts.push(message);`})
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5187}/`})
  await browser.wait(`!!document.querySelector('[aria-label="Project menu"]')`)
  await browser.evaluate(`(async()=>{
    const stairs=await import('/src/stairLibrary.ts'),design=await import('/src/stairDesign.ts');
    await stairs.saveStairToLibrary(stairs.stairDefinition('unused-personal-stair','Personal stairs',design.createStairDesign()));
    stairs.registerStairModels(await stairs.loadStairLibrary());
    const recent=await import('/src/recentProjects.ts');
    await recent.rememberRecentProject({fileName:'Recent.json',contents:JSON.stringify({activeFloorId:'replacement',wallKind:'external',floors:[{id:'replacement',name:'Replacement',elevation:0,roomHeight:2.4,slabThickness:.2,walls:[],models:[],rooms:[],roofs:[]}]})});
  })()`)
  await browser.wait(`(async()=>{const m=await import('/src/models/modelLibrary.ts');return m.modelsById.has('unused-personal-stair')})()`)
  assert.deepEqual(await browser.evaluate(`[...document.querySelector('[aria-label="2D editing floor"]').options].map(o=>o.textContent)`), ['Floor 0'])
  // 2D zoom is navigation and must not dirty the new project either.
  await browser.evaluate(`document.querySelector('[aria-label="Zoom in"]').click()`)
  await browser.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await browser.wait(`!!document.querySelector('.project-menu-recent button')`)
  await browser.evaluate(`document.querySelector('.project-menu-recent button').click()`)
  await browser.wait(`confirmations.length>0 || document.querySelector('.viewport-caption')?.textContent.includes('Replacement')`)
  assert.deepEqual(await browser.evaluate('confirmations'), [], 'a new project plus an asynchronously loaded unused stair library must remain clean')
  assert.deepEqual(await browser.evaluate('alerts'), [])
  assert.ok(await browser.evaluate(`document.querySelector('.viewport-caption').textContent.includes('Replacement')`))
  console.log('New project and library hydration remain clean')

  // Use the browser's actual <input type=file> selection event. A fake picker
  // promise alone does not exercise the handoff from the platform file chooser.
  await browser.call('Page.setInterceptFileChooserDialog',{enabled:true})
  await browser.evaluate(`window.showOpenFilePicker=()=>new Promise(()=>{})`)
  const openFile = async (fileName = 'red_house_5.json') => {
    await browser.evaluate(`(()=>{const b=document.querySelector('[aria-label="Project menu"]');if(b.getAttribute('aria-expanded')!=='true')b.click()})()`)
    await browser.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent==='Load').click()`)
    const {root}=await browser.call('DOM.getDocument')
    const {nodeId}=await browser.call('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'})
    assert.ok(nodeId,'the input remains attached after its menu closes')
    if (fileName) await browser.call('DOM.setFileInputFiles',{nodeId,files:[resolve(fileName)]})
  }
  await browser.evaluate(`document.querySelector('[aria-label="Floor tools"]').click()`)
  await browser.evaluate(`(()=>{const s=[...document.querySelectorAll('.flyout-select')].find(l=>l.textContent.includes('Ceiling under roof')).querySelector('select');s.value='open';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await openFile()
  await browser.wait(`!!document.querySelector('.project-load-dialog[open]')`)
  assert.deepEqual(await browser.evaluate('confirmations'),[], 'suppressed browser confirms cannot cancel loading')
  await browser.evaluate(`[...document.querySelectorAll('.project-load-dialog button')].find(b=>b.textContent==='Cancel').click()`)
  assert.ok(await browser.evaluate(`document.querySelector('.viewport-caption').textContent.includes('Replacement')`),'cancel retains the current house')
  await openFile()
  await browser.wait(`!!document.querySelector('.project-load-dialog[open]')`)
  await browser.evaluate(`[...document.querySelectorAll('.project-load-dialog button')].find(b=>b.textContent==='Discard changes and open').click()`)
  await browser.wait(`document.querySelector('[aria-label="2D editing floor"]').value==='1304e673-54cf-488a-8188-7f9d2b444dd8'`)
  assert.equal(await browser.evaluate(`!!document.querySelector('input[type=file]')`),false,'completed file inputs are released')
  await openFile()
  await browser.wait(`!document.querySelector('input[type=file]') && !document.querySelector('.project-load-feedback[role=status]')`)
  assert.equal(await browser.evaluate(`!!document.querySelector('.project-load-dialog')`),false,'Red House migration must finish before the clean snapshot')
  console.log('PASS native file-input handoff, visible discard/cancel, and clean Red House reload')

  await openFile(null)
  await browser.evaluate(`document.querySelector('input[type=file]').dispatchEvent(new Event('cancel'))`)
  await browser.wait(`!document.querySelector('input[type=file]') && !document.querySelector('.project-load-feedback')`)
  assert.equal(await browser.evaluate(`document.querySelector('[aria-label="2D editing floor"]').value`),'1304e673-54cf-488a-8188-7f9d2b444dd8','chooser cancellation retains Red House')
  const springfield = JSON.parse(readFileSync('springfield_14.json','utf8'))
  await openFile('springfield_14.json')
  await browser.wait(`document.querySelector('[aria-label="2D editing floor"]').value===${JSON.stringify(springfield.activeFloorId)}`)
  assert.equal(await browser.evaluate(`!!document.querySelector('.project-load-dialog')`),false)
  console.log('PASS chooser cancellation and actual Springfield file selection')

  await browser.evaluate(`File.prototype.text=async()=>{throw new DOMException('Read interrupted','AbortError')}`)
  await openFile()
  await browser.wait(`!!document.querySelector('.project-load-feedback[role=alert]')`)
  assert.match(await browser.evaluate(`document.querySelector('.project-load-feedback').textContent`),/Read interrupted/)
  assert.equal(await browser.evaluate('alerts.length'),1,'a file-read abort is reported instead of treated as picker cancellation')
  assert.deepEqual(browser.errors, [])
  console.log('PASS new project stays clean after personal library loading and 2D navigation; Recent opens without a save prompt')
} finally { browser.close() }
