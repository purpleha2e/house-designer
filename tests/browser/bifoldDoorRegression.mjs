// With Vite on port 5180: node tests/browser/bifoldDoorRegression.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const windowMode = process.argv.includes('--window')

const child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run',
  '--no-default-browser-check','--window-size=1530,700',`--user-data-dir=${mkdtempSync(join(tmpdir(),'bifold-preview-'))}`,'about:blank',
],{windowsHide:true})
let ws
try {
  const endpoint=await new Promise((resolve,reject)=>{
    child.stderr.on('data',data=>{const match=String(data).match(/DevTools listening on (ws:\/\/\S+)/);if(match)resolve(match[1])})
    child.on('error',reject);child.on('exit',code=>reject(new Error(`Chrome exited ${code}`)))
  })
  ws=new WebSocket(endpoint)
  await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}))
  let id=0;const pending=new Map()
  ws.addEventListener('message',event=>{const result=JSON.parse(event.data);const task=pending.get(result.id);if(!task)return;
    pending.delete(result.id);result.error?task.reject(result.error):task.resolve(result.result)})
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}))
  })
  const {targetId}=await send('Target.createTarget',{url:'about:blank'})
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
  const call=(method,params)=>send(method,params,sessionId)
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await call('Page.enable')
  await call('Page.navigate',{url:`http://127.0.0.1:5180/tests/browser/${windowMode ? 'largeWindowPreview' : 'bifoldDoorPreview'}.html`})
  for(let index=0;index<80;index++) {
    if(await evaluate('!!window.bifoldPreviewReady'))break
    await new Promise(resolve=>setTimeout(resolve,250))
  }
  assert.equal(await evaluate('!!window.bifoldPreviewReady'),true)
  const info=await evaluate('window.bifoldAssetInfo')
  if (windowMode) {
    assert.equal(info.window.panes.length, 1)
    assert.ok(Math.abs(info.window.dimensions[0] - 1.8) < 1e-6)
    assert.ok(Math.abs(info.window.dimensions[1] - 2) < 1e-6)
    assert.ok(Math.abs(info.window.dimensions[2] - 0.08) < 1e-6)
    assert.equal(info.window.definition.wallMount, 'window')
    assert.equal(info.window.definition.openingWidth, 1.8)
    const data = await evaluate("document.getElementById('window').toDataURL('image/png')")
    writeFileSync('src/models/assets/window_large_single_pane.png', Buffer.from(data.split(',')[1], 'base64'))
    console.log('Single glass pane, 1.8 x 2 m dimensions and window library classification passed', info)
  } else {
  for(const state of ['closed','open']) {
    assert.equal(info[state].panes.length,3)
    assert.ok(Math.abs(info[state].dimensions[0]-2.4)<1e-6)
    assert.ok(Math.abs(info[state].dimensions[1]-2.08)<1e-6)
    assert.equal(info[state].definition.wallMount,'patio-door')
    assert.equal(info[state].definition.openingWidth,2.4)
    const data=await evaluate(`document.getElementById('${state}').toDataURL('image/png')`)
    writeFileSync(`src/models/assets/patio_doors_bifold_three_pane_${state}.png`,Buffer.from(data.split(',')[1],'base64'))
  }
  assert.ok(info.open.dimensions[2]>0.7)
  assert.ok(info.closed.dimensions[2]<0.1)
  writeFileSync('.tmp-bifold-door-comparison.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('Three glass panes, matching opening sizes, open/closed bounds and library classification passed',info)
  }
} finally {ws?.close();child.kill()}
