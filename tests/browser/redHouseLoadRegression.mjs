import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lightingBrowser } from './lightingHarness.mjs'

const output='tmp/red-house-switch';mkdirSync(output,{recursive:true})
const failedRequests=[],report={}
const browser=await lightingBrowser({onEvent:event=>{
  if(event.method==='Network.responseReceived'&&event.params.response.status>=400)
    failedRequests.push({url:event.params.response.url,status:event.params.response.status})
}})
try {
  await browser.call('Network.enable')
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.alerts=[];window.alert=m=>alerts.push(m);window.confirmations=[];window.confirm=m=>{confirmations.push(m);return true};
    window.showOpenFilePicker=()=>new Promise(()=>{});
  `})
  await browser.call('Page.setInterceptFileChooserDialog',{enabled:true})
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5187}/`})
  await browser.wait(`!!document.querySelector('[aria-label="Project menu"]')`)
  console.log('Default Colin editor loaded')
  await browser.evaluate(`(async()=>{
    const contents=await(await fetch('/red_house_5.json')).text();window.redHouse=JSON.parse(contents);
    window.editorState=(await import('/tests/browser/rendererTestModules.ts')).getEditorState;
    window.snapshot=()=>{const s=editorState();return {plan:document.querySelector('[aria-label="2D editing floor"]')?.value,
      project:s?.scene.userData.projectGeneration,startup:s?.scene.userData.progressiveStartup,preparation:s?.scene.userData.viewportPreparation,
      warmup:s?.scene.userData.shaderWarmupPending,failure:s?.scene.userData.shaderWarmupFailure,gi:s?.scene.userData.indirectLighting,
      cover:document.querySelector('.viewport-preparing-overlay')?.textContent,alerts,confirmations}};
  })()`)
  report.before=await browser.evaluate('snapshot()')
  await browser.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await browser.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent==='Load').click()`)
  const {root}=await browser.call('DOM.getDocument')
  const {nodeId}=await browser.call('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'})
  await browser.call('DOM.setFileInputFiles',{nodeId,files:[resolve('red_house_5.json')]})
  await browser.wait(`alerts.length || document.querySelector('[aria-label="2D editing floor"]').value===redHouse.activeFloorId`)
  assert.deepEqual(await browser.evaluate('alerts'),[])
  console.log('Load replaced the 2D model',JSON.stringify(await browser.evaluate('snapshot()')))
  await browser.wait(`editorState()?.scene.userData.progressiveStartup?.phase==='full' && !editorState().scene.userData.shaderWarmupPending && !document.querySelector('.viewport-preparing-overlay')`,180000)
  report.afterLoad=await browser.evaluate('snapshot()')
  console.log('Load completed',JSON.stringify(report.afterLoad))
  await browser.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await browser.wait(`!![...document.querySelectorAll('.project-menu-recent button')].find(b=>b.textContent==='red_house_5.json')`)
  await browser.evaluate(`[...document.querySelectorAll('.project-menu-recent button')].find(b=>b.textContent==='red_house_5.json').click()`)
  await browser.wait(`editorState()?.scene.userData.projectGeneration!==${JSON.stringify(report.afterLoad.project)} && editorState()?.scene.userData.progressiveStartup?.phase==='full' && !editorState().scene.userData.shaderWarmupPending && !document.querySelector('.viewport-preparing-overlay')`,180000)
  report.afterRecent=await browser.evaluate('snapshot()')
  assert.deepEqual(await browser.evaluate('alerts'),[])
  assert.deepEqual(browser.errors,[])
  assert.deepEqual(failedRequests,[])
  writeFileSync(`${output}/loaded.png`,Buffer.from((await browser.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('PASS Red House loads through Load and Recent',JSON.stringify(report.afterRecent))
} catch(error) {
  report.error=String(error);report.diagnostic=await browser.evaluate('window.snapshot?.()').catch(()=>null)
  throw error
} finally {
  Object.assign(report,{errors:browser.errors,failedRequests});writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));browser.close()
}
