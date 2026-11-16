import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lightingBrowser } from './lightingHarness.mjs'

const browser = await lightingBrowser()
const url = `http://127.0.0.1:${process.argv[2] ?? 5186}/`
const output = 'tmp/recent-projects-regression'
mkdirSync(output, { recursive: true })
try {
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.makeProject = name => ({activeFloorId:name,wallKind:'external',floors:[{id:name,name,elevation:0,
      roomHeight:2.4,slabThickness:.2,walls:[],rooms:[],models:[],roofs:[]}]});
    const originalFetch=window.fetch;
    window.fetch=(input,options)=>String(input).includes('/colin_house_v2.json')
      ?Promise.resolve(new Response(JSON.stringify(makeProject('Initial')),{headers:{'Content-Type':'application/json'}}))
      :originalFetch(input,options);
    window.alerts=[];window.alert=message=>alerts.push(message);
    window.confirmations=[];window.allowDiscard=true;window.confirm=message=>{confirmations.push(message);return allowDiscard};
    window.showOpenFilePicker=()=>new Promise(()=>{});
    window.handleFor=async(name,contents)=>{const root=await navigator.storage.getDirectory();
      const handle=await root.getFileHandle(name,{create:true});const writer=await handle.createWritable();
      await writer.write(contents);await writer.close();return handle};
  ` })
  await browser.call('Page.setInterceptFileChooserDialog', { enabled: true })
  const selectFile = async (name, contents) => {
    const path = resolve(output, name)
    writeFileSync(path, contents)
    const {root} = await browser.call('DOM.getDocument')
    const {nodeId} = await browser.call('DOM.querySelector', {nodeId: root.nodeId, selector:'input[type=file]'})
    assert.ok(nodeId)
    await browser.call('DOM.setFileInputFiles', {nodeId, files:[path]})
  }
  const ready = () => browser.wait(`!!document.querySelector('[aria-label="Project menu"]')`)
  const openMenu = async () => {
    await browser.evaluate(`(()=>{const b=document.querySelector('[aria-label="Project menu"]');if(b.getAttribute('aria-expanded')!=='true')b.click()})()`)
    await browser.wait(`!!document.querySelector('.project-menu-recent')`)
  }
  const names = () => browser.evaluate(`[...document.querySelectorAll('.project-menu-recent button')].map(b=>b.textContent)`)
  const adjustStartupCamera = async () => {
    await browser.evaluate(`(async()=>{window.editorState=(await import('/tests/browser/rendererTestModules.ts')).getEditorState})()`)
    await browser.wait(`!!editorState()?.camera && editorState().clock.elapsedTime > .5`)
    // Startup controls can adjust the restored orientation before the house has
    // finished loading. Exercise the real camera reporter without editing it.
    await browser.evaluate(`(()=>{const state=editorState();state.camera.rotation.y+=.4;window.cameraAdjustedAt=state.clock.elapsedTime;state.invalidate()})()`)
    await browser.wait(`editorState().clock.elapsedTime > cameraAdjustedAt + .2`)
  }
  const load = async (name, contents = `JSON.stringify(makeProject(${JSON.stringify(name)}))`) => {
    const text = await browser.evaluate(contents)
    await openMenu()
    await browser.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent==='Load').click()`)
    await selectFile(name + '.json', text)
    await browser.wait(`!!document.querySelector('.viewport-caption')?.textContent.includes(${JSON.stringify(name)})`)
    await openMenu()
    await browser.wait(`document.querySelector('.project-menu-recent button')?.textContent===${JSON.stringify(name + '.json')}`)
  }
  await browser.call('Page.navigate', { url })
  await ready(); await openMenu(); console.log('initial menu')
  assert.deepEqual(await names(), [])
  await adjustStartupCamera()
  for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) await load(name)
  assert.deepEqual(await browser.evaluate('confirmations'), [], 'Unedited projects must not prompt to discard changes')
  assert.deepEqual(await names(), ['Delta.json', 'Gamma.json', 'Beta.json'])
  console.log('four loaded'); await load('Gamma')
  assert.deepEqual(await names(), ['Gamma.json', 'Delta.json', 'Beta.json'])

  console.log('deduplication passed');
  // Preserve compatibility with handles stored by earlier app versions.
  await browser.evaluate(`(async()=>{const recent=await import('/src/recentProjects.ts');
    for(const name of ['Beta','Delta','Gamma']) {const contents=JSON.stringify(makeProject(name));
      const handle=await handleFor(name+'.json',contents);
      await recent.rememberRecentProject({fileName:name+'.json',contents,handle});}
  })()`)
  // Stored file handles survive a refresh and read fresh disk contents.
  await browser.evaluate('window.beforeRecentReload=true')
  await browser.call('Page.reload')
  await browser.wait(`!window.beforeRecentReload && !!document.querySelector('[aria-label="Project menu"]')`)
  await openMenu()
  await browser.wait(`document.querySelectorAll('.project-menu-recent button').length===3`)
  assert.deepEqual(await names(), ['Gamma.json', 'Delta.json', 'Beta.json'])
  await browser.evaluate(`handleFor('Beta.json',JSON.stringify(makeProject('Beta updated')))`)
  await adjustStartupCamera()
  await browser.evaluate(`[...document.querySelectorAll('.project-menu-recent button')].find(b=>b.textContent==='Beta.json').click()`)
  await browser.wait(`!!document.querySelector('.viewport-caption')?.textContent.includes('Beta updated')`)
  await openMenu()
  await browser.wait(`document.querySelector('.project-menu-recent button')?.textContent==='Beta.json'`)
  assert.deepEqual(await names(), ['Beta.json', 'Gamma.json', 'Delta.json'])
  assert.deepEqual(await browser.evaluate('confirmations'), [], 'Opening a recent project after startup must not prompt')

  // A real edit still requires confirmation; cancelling retains it, and undoing
  // back to the loaded project makes opening a recent model clean again.
  await browser.evaluate(`document.querySelector('[aria-label="Project menu"]').click();document.querySelector('[aria-label="Floor tools"]').click()`)
  await browser.evaluate(`(()=>{const select=[...document.querySelectorAll('.flyout-select')].find(label=>label.textContent.includes('Ceiling under roof')).querySelector('select');select.value='open';select.dispatchEvent(new Event('change',{bubbles:true}));window.allowDiscard=false})()`)
  await openMenu()
  await browser.evaluate(`document.querySelector('.project-menu-recent button').click()`)
  await browser.wait(`!!document.querySelector('.project-load-dialog[open]')`)
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('.flyout-select')].find(label=>label.textContent.includes('Ceiling under roof')).querySelector('select').value`), 'open')
  await browser.evaluate(`[...document.querySelectorAll('.project-load-dialog button')].find(b=>b.textContent==='Cancel').click()`)
  await browser.evaluate(`document.querySelector('[aria-label="Undo"]').click()`)
  await openMenu()
  await browser.evaluate(`document.querySelector('.project-menu-recent button').click()`)
  await browser.wait(`!document.querySelector('.project-menu-recent')`)
  await openMenu()
  assert.equal(await browser.evaluate('confirmations.length'), 0, 'Load decisions must not use a suppressible native confirmation')
  assert.equal(await browser.evaluate(`!!document.querySelector('.project-load-dialog')`), false, 'Undoing the edit must restore a clean project')
  await browser.evaluate('window.allowDiscard=true')

  console.log('refresh and fresh contents passed');
  // Invalid loads neither replace the model nor pollute the recent list.
  await browser.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent==='Load').click()`)
  await selectFile('Invalid.json', '{}')
  await browser.wait('alerts.length===1'); await openMenu()
  assert.deepEqual(await names(), ['Beta.json', 'Gamma.json', 'Delta.json'])
  await browser.evaluate(`(async()=>{await (await navigator.storage.getDirectory()).removeEntry('Gamma.json')})()`)
  await browser.evaluate(`[...document.querySelectorAll('.project-menu-recent button')].find(b=>b.textContent==='Gamma.json').click()`)
  await browser.wait('alerts.length===2'); await openMenu()
  assert.match((await browser.evaluate('alerts'))[1], /unavailable/)
  assert.deepEqual(await names(), ['Beta.json', 'Gamma.json', 'Delta.json'])

  console.log('invalid and missing files passed');
  // Normal Load stores a copy that Recent can reopen without a file handle.
  await browser.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent==='Load').click()`)
  await selectFile('Portable.json', await browser.evaluate(`JSON.stringify(makeProject('Portable'))`))
  await browser.wait(`!!document.querySelector('.viewport-caption')?.textContent.includes('Portable')`)
  await openMenu()
  await browser.wait(`document.querySelector('.project-menu-recent button')?.textContent==='Portable.json'`)
  await browser.evaluate(`document.querySelector('.project-menu-recent button').click()`)
  await browser.wait(`!document.querySelector('.project-menu-recent')`)
  await openMenu()
  assert.deepEqual(await names(), ['Portable.json', 'Beta.json', 'Gamma.json'])
  const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${output}/menu.png`, Buffer.from(screenshot.data, 'base64'))
  assert.deepEqual(browser.errors, [])
  console.log('PASS Recent: startup camera changes, dirty-edit cancellation and undo, three entries, deduplication, reopening, persistence, fresh file contents, invalid/missing files and stored copies')
} finally { browser.close() }
