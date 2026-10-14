// With Vite on port 5180: node tests/browser/interiorRoofTrimRegression.mjs
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,850',
  `--user-data-dir=${createBrowserTestProfile('interior-roof-trim-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome debugger did not start')), 30000)
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
    child.on('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    const request = pending.get(result.id)
    if (!request) return
    pending.delete(result.id)
    if (result.error) request.reject(result.error)
    else request.resolve(result.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 30000)
    pending.set(++id, {
      resolve: result => { clearTimeout(timeout); resolve(result) },
      reject: error => { clearTimeout(timeout); reject(error) },
    })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await call('Page.enable')
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/roofWallRegression.html?colin' })
  let ready = false
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 500))
    ready = await evaluate(`(()=>{let roofs=0,walls=0;window.roofWallScene?.()?.scene.traverse(o=>{
      if(o.userData.houseDesignerRole==='roof-eaves')roofs++;
      if(o.userData.houseDesignerRole==='wall-engine-render'&&o.geometry.attributes.position.count)walls++});return roofs===8&&walls>=2&&!document.body.innerText.includes('Preparing 3D scene')})()`)
    if (ready) break
  }
  assert.ok(ready, 'Colin House scene must finish loading')
  writeFileSync('.tmp-interior-roof-trim-room.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  const result = await evaluate(`(async()=>{
    const {Vector3,Raycaster}=await import('/node_modules/three/build/three.module.js');
    const {resolveBuildingRoofs}=await import('/src/roofBuildingGeometry.ts');
    const {buildBuildingRoomVolumes}=await import('/src/buildingRoomVolumes.ts');
    const {roofFaceHeight}=await import('/src/roofJunctions.ts');
    const {footprintPlanes}=await import('/src/wallEngine/wallRoofClip.ts');
    const state=window.roofWallScene(),floors=window.regressionFloors;
    const {exteriorTrimCuts}=buildBuildingRoomVolumes(floors,resolveBuildingRoofs(floors));
    state.scene.updateMatrixWorld(true);
    let fittings=0, intrusions=0;const decoration=[],undersides=[];
    state.scene.traverse(o=>{
      if(o.userData.houseDesignerRole==='roof-underside')undersides.push(o);
      if(!['roof-eaves','roof-soffit','roof-shell'].includes(o.userData.houseDesignerRole))return;
      decoration.push(o);const p=o.geometry.attributes.position;
      fittings+=p.count/3;
      for(let i=0;i<p.count;i+=3){
        const center=new Vector3();for(let j=0;j<3;j++)center.add(new Vector3().fromBufferAttribute(p,i+j));
        o.localToWorld(center.divideScalar(3));const point=center.toArray();
        if(exteriorTrimCuts.some(c=>center.y>c.bottomY+1e-5&&center.y<roofFaceHeight(c.face)?.({x:center.x,y:center.z})-1e-5&&
          footprintPlanes(c.face.map(([x,,y])=>({x,y}))).every(plane=>plane(point)>1e-5)))intrusions++;
      }
    });
    const slopingCeiling=new Raycaster(new Vector3(3.25,4.5,16),new Vector3(0,1,0)).intersectObjects(undersides,false)[0]?.point.y;
    state.setFrameloop('never');state.camera.position.set(3.85,4.35,15.1);
    state.camera.lookAt(3.14,4.96,16.1);state.camera.updateMatrixWorld();state.gl.render(state.scene,state.camera);
    return {fittings,intrusions,slopingCeiling};
  })()`)
  assert.equal(result.intrusions, 0, 'rendered exterior fittings must stay outside every room')
  assert.ok(result.fittings > 0, 'exterior fittings remain')
  assert.ok(result.slopingCeiling > 4.5 && result.slopingCeiling < 5.1, 'the real roof underside remains')
  writeFileSync('.tmp-interior-roof-trim-after.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log('Interior roof trim browser regression passed', result)
} finally {
  ws?.close()
  child.kill()
}
