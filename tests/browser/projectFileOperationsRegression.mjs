import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lightingBrowser } from './lightingHarness.mjs'

const downloadPath=resolve('tmp/file-operations-downloads');mkdirSync(downloadPath,{recursive:true})
const downloadEvents=[]
const browser=await lightingBrowser({onEvent:event=>{
  if(event.method==='Browser.downloadProgress')downloadEvents.push(event.params)
}})
try {
  await browser.browserCall('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath,eventsEnabled:true})
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.alerts=[];window.alert=m=>alerts.push(m);window.confirm=()=>false;
    window.saveTest={files:[],pickers:0,mode:'normal'};
    // Headless Chrome cannot operate an OS Save As window. Supply a chosen
    // handle, then exercise real FileSystemWritableFileStreams and disk bytes.
    window.testPicker=async options=>{
      saveTest.pickers++;saveTest.options=options;
      if(saveTest.mode==='cancel')throw new DOMException('Cancelled','AbortError');
      if(saveTest.mode==='stall')return new Promise(resolve=>{saveTest.late=resolve});
      const handle=await(await navigator.storage.getDirectory()).getFileHandle('chosen-'+saveTest.pickers+'.house.json',{create:true});
      saveTest.files.push(handle);return handle;
    };
    window.showSaveFilePicker=testPicker;
    window.readChosen=async()=>JSON.parse(await(await saveTest.files.at(-1).getFile()).text());
  `})
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??4173}/`})
  await browser.wait(`!!document.querySelector('[aria-label="Project menu"]')`)
  const initialFloorId=await browser.evaluate(`document.querySelector('[aria-label="2D editing floor"]').value`)
  const action=async label=>{
    await browser.evaluate(`(()=>{const b=document.querySelector('[aria-label="Project menu"]');if(b.getAttribute('aria-expanded')!=='true')b.click()})()`)
    await browser.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`)
  }
  const setCeiling=async mode=>{
    await browser.evaluate(`(()=>{let l=[...document.querySelectorAll('.flyout-select')].find(l=>l.textContent.includes('Ceiling under roof'));if(!l)document.querySelector('[aria-label="Floor tools"]').click()})()`)
    await browser.evaluate(`(()=>{const s=[...document.querySelectorAll('.flyout-select')].find(l=>l.textContent.includes('Ceiling under roof')).querySelector('select');s.value=${JSON.stringify(mode)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  }
  await setCeiling('open')
  await action('Save to device')
  await browser.wait(`document.querySelector('.project-load-feedback')?.textContent.includes('Saved chosen-1.house.json')`,15000)
  assert.equal((await browser.evaluate('readChosen()')).floors[0].ceilingMode,'open')
  assert.equal(downloadEvents.length,0,'Save As never downloads a replacement copy')
  await setCeiling('horizontal');await action('Save')
  await browser.wait(`document.querySelector('.project-load-feedback')?.textContent.includes('Saved chosen-1.house.json')`,15000)
  assert.equal((await browser.evaluate('readChosen()')).floors[0].ceilingMode,'horizontal')
  assert.equal(await browser.evaluate('saveTest.pickers'),1,'Save overwrites the selected file without a new picker')
  await action('Save to device')
  await browser.wait(`document.querySelector('.project-load-feedback')?.textContent.includes('Saved chosen-2.house.json')`,15000)
  assert.equal(await browser.evaluate('saveTest.options.suggestedName'),'chosen-1.house.json')

  // Cancelling Save As keeps the previous destination. Late picker resolution
  // after cancelling a stalled dialog must never start a file write.
  await browser.evaluate(`saveTest.mode='cancel'`);await action('Save to device')
  await browser.wait(`!document.querySelector('.project-load-feedback')`,10000)
  assert.deepEqual(await browser.evaluate('alerts'),[])
  await browser.evaluate(`saveTest.mode='stall'`);await action('Save to device')
  await browser.wait(`!![...document.querySelectorAll('.project-load-feedback button')].find(b=>b.textContent==='Cancel save')`,10000)
  await browser.evaluate(`[...document.querySelectorAll('.project-load-feedback button')].find(b=>b.textContent==='Cancel save').click()`)
  await browser.wait(`!document.querySelector('.project-load-feedback')`,10000)
  await browser.evaluate(`saveTest.late({name:'late.json',createWritable:async()=>{saveTest.lateWrite=true;throw Error('Late write')}});saveTest.mode='normal'`)
  await action('Save')
  await browser.wait(`document.querySelector('.project-load-feedback')?.textContent.includes('Saved chosen-2.house.json')`,15000)
  assert.equal(await browser.evaluate('!!saveTest.lateWrite'),false)

  // Download copy writes a real browser download without changing Save.
  await action('Download copy')
  const deadline=Date.now()+15000
  while(!downloadEvents.some(e=>e.state==='completed')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50))
  const completed=downloadEvents.find(e=>e.state==='completed');assert.ok(completed)
  const savedPath=resolve(downloadPath,completed.guid)
  assert.equal(JSON.parse(readFileSync(savedPath,'utf8')).floors[0].id,initialFloorId)
  await action('Save');await browser.wait(`document.querySelector('.project-load-feedback')?.textContent.includes('Saved chosen-2.house.json')`,15000)
  assert.equal(await browser.evaluate('saveTest.pickers'),4)
  await browser.evaluate('window.showSaveFilePicker=undefined');await action('Save to device')
  await browser.wait(`document.querySelector('.project-load-feedback[role=alert]')?.textContent.includes('Save As dialog is not available')`,10000)
  await browser.evaluate('window.showSaveFilePicker=testPicker;alerts=[]')

  // New > Save continues only after the native write has closed.
  await setCeiling('open');await browser.evaluate('window.confirm=()=>true');await action('New')
  await browser.wait(`document.querySelector('[aria-label="2D editing floor"]').value!==${JSON.stringify(initialFloorId)}`,15000)
  assert.equal((await browser.evaluate('readChosen()')).floors[0].ceilingMode,'open')

  // Reopen bytes actually written by Chrome using the ordinary Load control.
  await browser.call('Page.setInterceptFileChooserDialog',{enabled:true});await action('Load')
  const {root}=await browser.call('DOM.getDocument')
  const {nodeId}=await browser.call('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'})
  await browser.call('DOM.setFileInputFiles',{nodeId,files:[savedPath]})
  await browser.wait(`document.querySelector('[aria-label="2D editing floor"]').value===${JSON.stringify(initialFloorId)}`,15000)
  // Imported files have read access only: first Save asks for a location.
  await action('Save');await browser.wait('saveTest.pickers===5',10000)
  await browser.wait(`document.querySelector('.project-load-feedback')?.textContent.includes('Saved chosen-5.house.json')`,15000)
  assert.equal((await browser.evaluate('readChosen()')).floors[0].ceilingMode,'horizontal')
  assert.deepEqual(browser.errors,[])
  console.log('PASS chosen-file writes, overwrite, Save As, cancel, stalled-picker recovery, Download copy, New > Save and reopening downloaded JSON')
} finally {browser.close()}
