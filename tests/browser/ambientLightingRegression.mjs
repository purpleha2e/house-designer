// Vite running: node tests/browser/ambientLightingRegression.mjs [port]
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const project = { activeFloorId: 'ground', floors: [{ id: 'ground', name: 'Ground', elevation: 0,
  roomHeight: 2.4, slabThickness: .2, walls: [], models: [], rooms: [], roofs: [] }],
  modelDefinitions: [], materialDefinitions: [], surfaceAssignments: [],
  sunPosition: { azimuth: 1, elevation: .78 }, wallKind: 'external' }
const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,850',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  `--user-data-dir=${createBrowserTestProfile('ambient-preferences-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 30000)
    browser.stderr.on('data', data => { const m = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]) } })
    browser.once('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data), request = pending.get(m.id)
    if (request) { pending.delete(m.id); clearTimeout(request.timer); m.error ? request.reject(m.error) : request.resolve(m.result) }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails)
    if (m.method === 'Fetch.requestPaused') void send('Fetch.fulfillRequest', { requestId: m.params.requestId,
      responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }],
      body: Buffer.from(`export default ${JSON.stringify(project)};`).toString('base64'),
    }, m.sessionId)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(`${method} timed out`)) }, 30000)
    pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const wait = async expression => {
    for (let i = 0; i < 600; i++) {
      if (await evaluate(expression)) return
      assert.deepEqual(errors, []); await pause(50)
    }
    throw Error(`Timed out: ${expression}\n${JSON.stringify(await evaluate(`({ambient:document.querySelector('[aria-label="Ambient term"]')?.value,daylight:[...document.querySelectorAll('#three-settings-menu label')].find(l=>l.textContent.trim()==='Daylight')?.querySelector('input').checked,body:document.body.innerText.slice(-2000)})`))}`)
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Fetch.enable', { patterns: [{ urlPattern: '*/colin_house_v2.json*' }] })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.ambientTest={writes:0,alerts:[]};window.alert=m=>ambientTest.alerts.push(m);
    window.confirm=m=>!m.startsWith('Save changes before');
    window.showSaveFilePicker=async()=>({name:'ambient.json',createWritable:async()=>({write:async data=>{ambientTest.contents=data;ambientTest.writes++},close:async()=>{}})});
    window.showOpenFilePicker=async()=>[{name:'ambient.json',getFile:async()=>new File([ambientTest.contents],'ambient.json')}];
    const original=fetch;window.fetch=async(url,options)=>{
      const path=String(url);if(path.startsWith('/api/workspace/'))return new Response(JSON.stringify({user:null,workspace:null,mode:'local-development',maxUploadBytes:100000000}),{headers:{'content-type':'application/json'}});
      if(path.startsWith('/api/portal/'))return new Response(JSON.stringify({manufacturers:[]}),{headers:{'content-type':'application/json'}});
      return original(url,options);
    };
  ` })
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/editorRegression.html` })
  const settings = async () => {
    await wait(`!!document.querySelector('button[aria-controls="three-settings-menu"]')`)
    if (!await evaluate(`!!document.querySelector('[aria-label="Ambient term"]')`)) await evaluate(`document.querySelector('button[aria-controls="three-settings-menu"]').click()`)
    await wait(`!!document.querySelector('[aria-label="Ambient term"]')`)
  }
  const toggle = async () => {
    await evaluate(`[...document.querySelectorAll('#three-settings-menu label')].find(l=>l.textContent.trim()==='Daylight').querySelector('input').click()`)
  }
  const ambient = value => wait(`Number(document.querySelector('[aria-label="Ambient term"]')?.value)===${value}`)
  const setAmbient = async value => {
    await evaluate(`(()=>{const input=document.querySelector('[aria-label="Ambient term"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${value}');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await ambient(value)
  }
  const action = async label => {
    if (!await evaluate(`!!document.querySelector('.project-menu-dropdown')`)) await evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
    await evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`)
  }
  await settings(); await ambient(.30)
  await setAmbient(.47); await toggle(); await ambient(.03)
  await setAmbient(.07); await toggle(); await ambient(.47)
  await toggle(); await ambient(.07)
  assert.equal(await evaluate(`[...document.querySelectorAll('#three-settings-menu label')].some(l=>l.textContent.trim()==='Night fill')`), false)
  await action('Save to device'); await wait('ambientTest.writes===1')
  assert.deepEqual(await evaluate('JSON.parse(ambientTest.contents).threeDView.ambientLighting'), {
    daylight: false, ambientTerm: .47, nightAmbientTerm: .07,
  })
  await action('New'); await settings(); await ambient(.30)
  assert.equal(await evaluate(`[...document.querySelectorAll('#three-settings-menu label')].find(l=>l.textContent.trim()==='Daylight').querySelector('input').checked`), true)
  await toggle(); await ambient(.03)
  await action('Load'); await settings(); await ambient(.07)
  await toggle(); await ambient(.47)
  await action('New'); await settings(); await ambient(.30)
  await setAmbient(.55)
  await action('New'); await settings(); await ambient(.30)
  assert.deepEqual(await evaluate('ambientTest.alerts'), [])
  assert.deepEqual(errors, [])
  console.log('PASS new-model defaults, independent day/night controls, save/load before GI, and repeated New resets')
} finally { ws?.close(); browser.kill() }
