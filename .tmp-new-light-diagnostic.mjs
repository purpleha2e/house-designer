import { writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './tests/browser/browserTestProcess.mjs'
const browser=spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--remote-debugging-port=0',
  '--disable-background-timer-throttling','--window-size=1100,950',
  `--user-data-dir=${createBrowserTestProfile('new-light-')}`,'about:blank'],{windowsHide:true})
let ws
try{
  const endpoint=await new Promise((resolve,reject)=>{browser.stderr.on('data',d=>{const m=String(d).match(/DevTools listening on (ws:\/\/\S+)/);if(m)resolve(m[1])});browser.on('error',reject)})
  ws=new WebSocket(endpoint);await new Promise(r=>ws.addEventListener('open',r,{once:true}))
  let id=0;const pending=new Map(),errors=[]
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)})
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}))})
  const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
  const call=(method,params)=>send(method,params,sessionId)
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
  const pause=ms=>new Promise(r=>setTimeout(r,ms))
  await call('Runtime.enable');await call('Page.enable')
  await call('Page.navigate',{url:'http://127.0.0.1:5186/tests/browser/roofWallRegression.html?new-test&materials'})
  for(let i=0;i<1800;i++){if(errors.length)throw Error(JSON.stringify(errors));if(await evaluate('window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase === "full"'))break;await pause(100)}
  console.log('State',JSON.stringify(await evaluate(`(()=>{const s=window.roofWallScene();return{startup:s.scene.userData.progressiveStartup,gi:s.scene.userData.indirectLighting,lights:s.scene.children.filter(o=>o.isLight).map(o=>({type:o.type,pos:o.position.toArray(),distance:o.distance,power:o.power,decay:o.decay,castShadow:o.castShadow,shadowIntensity:o.shadow?.intensity,near:o.shadow?.camera.near,far:o.shadow?.camera.far}))}})()`)))
  const shot=async name=>writeFileSync(`.tmp-new-light-${name}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(-.25,1.5,4.55);s.camera.lookAt(-3.24,1.35,4.5);s.camera.updateMatrixWorld(true);s.invalidate()})()`)
  await pause(1000);await shot('initial')
  if(process.argv.includes('--hold')){console.log('Holding isolated diagnostic browser for inspection.');await new Promise(resolve=>process.stdin.once('data',resolve))}
  await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  console.log('Options',await evaluate('[...document.querySelectorAll("label")].map(l=>({text:l.textContent.trim(),checked:l.querySelector("input")?.checked})).filter(l=>l.checked!==undefined)'))
  await evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Light shadows');if(label?.querySelector('input').checked)label.querySelector('input').click();document.querySelector('[aria-label="3D view menu"]').click()})()`)
  await pause(1000);await shot('no-shadows')
  await evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Indirect lighting (GI)');if(label?.querySelector('input').checked)label.querySelector('input').click();document.querySelector('[aria-label="3D view menu"]').click()})()`)
  await pause(2500);await shot('no-gi')
  await evaluate(`(async()=>{const {OrthographicCamera,WebGLRenderTarget}=await import('/node_modules/.vite/deps/three.js');
    const s=window.roofWallScene(),camera=new OrthographicCamera(-.65,.65,1.15,-1.15,.01,5);
    camera.position.set(-1.5,1.2,4.55);camera.lookAt(-3.24,1.2,4.55);camera.updateMatrixWorld(true);
    const target=new WebGLRenderTarget(256,256);window.wallProbe=()=>{s.scene.updateMatrixWorld(true);s.gl.setRenderTarget(target);s.gl.render(s.scene,camera);const values=[];
      for(const y of [.2,.4,.6,.8,1,1.2,1.4,1.6,1.8,2,2.2]){const p=s.camera.position.clone().set(-3.24,y,4.55).project(camera),pixel=new Uint8Array(4);s.gl.readRenderTargetPixels(target,Math.floor((p.x+1)*128),Math.floor((p.y+1)*128),1,1,pixel);values.push({y,rgb:[...pixel.slice(0,3)]})}s.gl.setRenderTarget(null);return values};
    window.wallProbeDispose=()=>target.dispose();
  })()`)
  console.log('Wall no GI/shadows',await evaluate('window.wallProbe()'))
  await evaluate('window.wallProbeDispose()')
  console.log('Errors',errors)
}finally{ws?.close();browser.kill()}
