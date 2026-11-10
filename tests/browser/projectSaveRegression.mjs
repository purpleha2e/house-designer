// With Vite running: node tests/browser/doorPlanRegression.mjs [port]
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1100,950',
  `--user-data-dir=${createBrowserTestProfile('door-plan-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) resolve(match[1])
    })
    child.on('error', reject)
    child.on('exit', code => reject(Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data), request = pending.get(result.id)
    if (request) {
      pending.delete(result.id)
      result.error ? request.reject(result.error) : request.resolve(result.result)
    }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  await call('Runtime.enable')
  await call('Page.enable')
  await call('Network.enable')
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);
    if(message.method==='Network.loadingFailed')console.log('Network failure',message.params.errorText);
    if(message.method==='Network.responseReceived'&&message.params.response.status>=400)console.log('HTTP failure',message.params.response.status,message.params.response.url);
    if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')console.log('Console error',message.params.args.map(arg=>arg.value??arg.description));
  })
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.saveTest={pickers:0,writes:0,loadedWrites:0,uploads:0,updates:[],alerts:[],signedIn:false};
    window.alert=message=>saveTest.alerts.push(message);window.confirm=()=>true;window.prompt=()=> 'cloud.house.json';
    window.showSaveFilePicker=async()=>{
      saveTest.pickers++;if(saveTest.cancelPicker)throw new DOMException('Cancelled','AbortError');
      return{name:'device.house.json',getFile:async()=>new File([saveTest.contents??''],'device.house.json'),
        createWritable:async()=>({write:async data=>{saveTest.writes++;saveTest.contents=data},close:async()=>{}})};
    };
    window.showOpenFilePicker=async()=>[{name:'loaded.house.json',getFile:async()=>new File([saveTest.contents],'loaded.house.json'),
      createWritable:async()=>({write:async()=>{saveTest.loadedWrites++},close:async()=>{}})}];
    const original=fetch;window.fetch=async(url,options={})=>{
      const path=String(url);if(!path.startsWith('/api/workspace/'))return original(url,options);
      if(path.includes('/auth/'))saveTest.signedIn=true;
      let value={user:saveTest.signedIn?{id:'save-user',name:'Test User',email:'save@example.test'}:null,
        workspace:{id:'save-workspace',usedBytes:0,quotaBytes:100000000},mode:'local-development',maxUploadBytes:100000000};
      if(path.includes('/assets')){
        if(options.method==='POST')saveTest.uploads++;
        if(options.method==='PUT')saveTest.updates.push(path.split('?')[0]);
        value={asset:{id:'cloud-design-1',name:'cloud.house.json',kind:'project'},workspace:value.workspace};
      }
      return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
    };
  `})
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5186}/`})
  const waitFor=async expression=>{
    for(let i=0;i<600;i++){if(await evaluate(expression))return;if(errors.length)throw Error(JSON.stringify(errors).slice(0,3000));await pause(100)}
    throw Error('Timed out: '+expression+' '+await evaluate('document.body.innerText.slice(0,2000)'))
  }
  await waitFor(`!!document.querySelector('[aria-label="Project menu"]')`)
  const menu=async()=>{
    if(!await evaluate(`!!document.querySelector('.project-menu-dropdown')`))
      await evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  }
  const click=async label=>{
    await menu()
    await evaluate(`(()=>{const button=[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)throw Error('Unavailable action: '+${JSON.stringify(label)});button.click()})()`)
  }
  await menu()
  assert.equal(await evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()==='Save').disabled`),true)
  await click('Save to device')
  await waitFor('saveTest.writes===1')
  await click('Save')
  await waitFor('saveTest.writes===2')
  assert.equal(await evaluate('saveTest.pickers'),1,'Save reuses the chosen device handle')
  await click('Save to cloud')
  await waitFor(`!!document.querySelector('dialog.account-dialog[open] input[name="email"]')`)
  for(const [name,text] of [['email','save@example.test'],['password','correct horse battery staple']]){
    await evaluate(`document.querySelector('dialog input[name="${name}"]').focus()`)
    await call('Input.insertText',{text})
  }
  await evaluate(`document.querySelector('dialog form button').click()`)
  await waitFor('saveTest.uploads===1')
  await click('Save')
  await waitFor('saveTest.updates.length===1')
  assert.deepEqual(await evaluate('saveTest.updates'),['/api/workspace/assets/cloud-design-1'])
  await evaluate('saveTest.cancelPicker=true')
  await click('Save to device')
  await pause(200)
  await click('Save')
  await waitFor('saveTest.updates.length===2')
  assert.equal(await evaluate('saveTest.uploads'),1,'Save overwrites without making another cloud copy')
  await click('New')
  await pause(200)
  await menu()
  assert.equal(await evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()==='Save').disabled`),true,'New clears the previous save destination')
  await click('Load')
  await waitFor(`document.querySelector('.viewport-caption')?.textContent.includes('loaded')`)
  await click('Save')
  await waitFor('saveTest.loadedWrites===1')
  assert.deepEqual(await evaluate('saveTest.alerts'),[])
  assert.deepEqual(errors,[])
  console.log('PASS: Save disabled initially; device overwrite; cloud sign-in/create/overwrite; cancellation keeps destination; New resets; Load preserves its handle')
}finally{ws?.close();child.kill()}
