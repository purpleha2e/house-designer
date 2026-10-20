// Starts disposable API/Vite servers and a separate Chrome profile.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'vite'
import { createWorkspaceService } from '../../server/workspace-service.ts'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const parent = resolve(tmpdir()), directory = await mkdtemp(join(parent, 'workspace-browser-test-'))
const output = resolve('node_modules/.cache/workspace-browser-test')
await mkdir(output, { recursive: true })
const origins = [], service = await createWorkspaceService({ directory, allowedOrigins: origins })
let vite, child, ws, apiClosed = false
try {
  await new Promise(resolveListen => service.server.listen(0, '127.0.0.1', resolveListen))
  const apiPort = service.server.address().port
  process.env.VITE_HTTPS = '0'
  vite = await createServer({ configFile: resolve('vite.config.ts'), logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, open: false,
      proxy: { '/api/workspace': `http://127.0.0.1:${apiPort}` } } })
  await vite.listen()
  const url = `http://127.0.0.1:${vite.httpServer.address().port}`
  origins.push(url)
  child = spawnBrowserTest(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--no-sandbox', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,1000', `--user-data-dir=${createBrowserTestProfile('workspace-browser-')}`, 'about:blank',
  ], { windowsHide: true })
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 30000)
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timer); resolveEndpoint(match[1]) } })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Chrome exited: ${code}`)) })
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolveOpen => ws.addEventListener('open', resolveOpen, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id)
    if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result) }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolveCall, reject) => {
    const timer = setTimeout(() => { pending.delete(callId); reject(Error(`${method} timed out`)) }, 30000)
    const callId = ++id
    pending.set(callId, { resolve: value => { clearTimeout(timer); resolveCall(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    ws.send(JSON.stringify({ id: callId, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds))
  const wait = async (expression, description) => {
    for (let attempt = 0; attempt < 150; attempt++) { if (await evaluate(expression)) return; await pause(100) }
    await writeFile(join(output, 'failure.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    throw Error(`Timed out: ${description}. ${JSON.stringify(errors)}. ${await evaluate('document.body.innerText')}`)
  }
  const click = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing enabled button: '+${JSON.stringify(text)});b.click()})()`)
  const input = (name, value) => evaluate(`(()=>{const i=document.querySelector('input[name="${name}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const openAccount = async () => { await evaluate(`document.querySelector('button[aria-label="Project menu"]').click()`); await click('Account & workspace') }
  await call('Page.enable'); await call('Runtime.enable')
  await call('Page.navigate', { url: `${url}/tests/browser/workspaceRegression.html` })
  await wait(`!!document.querySelector('button[aria-label="Project menu"]')`, 'editor project menu')
  await openAccount()
  await wait(`!!document.querySelector('input[name="email"]')`, 'sign-in form')
  await click('Create account')
  await input('name', 'Workspace Tester'); await input('email', 'workspace@example.test'); await input('password', 'a sufficiently long password')
  await click('Create private workspace')
  await wait(`document.querySelector('.account-summary')?.textContent.includes('workspace@example.test')`, 'registered private workspace')
  assert.ok(await evaluate(`document.querySelector('.account-development').textContent.includes('this computer')`))
  assert.equal(await evaluate(`document.cookie.includes('hd_workspace_session')`), false, 'session cookie is inaccessible to page JavaScript')
  assert.equal(await evaluate(`!!document.querySelector('.account-dialog input[type="file"]')`), false, 'account settings do not offer generic artefact uploads')
  assert.equal(await evaluate(`document.querySelector('.account-storage progress').value`), 0)
  await writeFile(join(output, 'desktop.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await click('Sign out'); await wait(`!!document.querySelector('input[name="email"]')`, 'signed out')
  await input('email', 'workspace@example.test'); await input('password', 'a sufficiently long password')
  await evaluate(`document.querySelector('.account-form button').click()`)
  await wait(`document.querySelector('.account-summary')?.textContent.includes('workspace@example.test')`, 'account remains available after sign-in')
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await pause(100)
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=390&&document.querySelector('.account-dialog').getBoundingClientRect().right<=390`), 'account dialog fits a phone screen')
  await writeFile(join(output, 'mobile.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await click('Sign out'); await wait(`!!document.querySelector('input[name="email"]')`, 'signed out')
  await click('Close')
  service.server.closeIdleConnections()
  await new Promise(resolveClose => service.server.close(resolveClose)); service.store.close(); apiClosed = true
  await openAccount()
  await wait(`document.querySelector('.account-dialog')?.textContent.includes('keep working locally')`, 'service unavailable is recoverable')
  await click('Close')
  assert.equal(await evaluate(`!!document.querySelector('dialog[open]')`), false)
  assert.deepEqual(errors, [])
  console.log('PASS: Account menu, registration, storage summary, sign-in, phone layout and unavailable-service recovery; no generic upload controls.')
} finally {
  ws?.close(); child?.kill()
  await vite?.close()
  if (!apiClosed) { service.server.closeIdleConnections(); await new Promise(resolveClose => service.server.close(resolveClose)); service.store.close() }
  assert.equal(dirname(resolve(directory)), parent)
  assert.ok(directory.startsWith(join(parent, 'workspace-browser-test-')))
  await rm(directory, { recursive: true, force: true })
}
