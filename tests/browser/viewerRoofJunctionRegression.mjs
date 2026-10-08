// Stage colin_house_v2.json with build:viewer, then run with Vite on port 5180.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1800,1000',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'viewer-roof-'))}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout=setTimeout(()=>reject(new Error('Chrome startup timed out')),60000)
    child.stderr.on('data', data => {
      const match=String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if(match){clearTimeout(timeout);resolve(match[1])}
    })
    child.on('error',reject)
    child.on('exit',code=>reject(new Error(`Chrome exited ${code}`)))
  })
  ws=new WebSocket(endpoint)
  await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}))
  let id=0
  const pending=new Map()
  ws.addEventListener('message',event=>{
    const result=JSON.parse(event.data),request=pending.get(result.id)
    if(request){pending.delete(result.id);result.error?request.reject(result.error):request.resolve(result.result)}
  })
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error(`${method} timed out`)),60000)
    pending.set(++id,{resolve:value=>{clearTimeout(timeout);resolve(value)},reject:error=>{clearTimeout(timeout);reject(error)}})
    ws.send(JSON.stringify({id,method,params,sessionId}))
  })
  const {targetId}=await send('Target.createTarget',{url:'about:blank'})
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
  const call=(method,params)=>send(method,params,sessionId)
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))

  await call('Page.enable')
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/readOnlyViewerRegression.html?published'})
  for(let i=0;i<160;i++){await pause(250);if(await evaluate('!!window.viewerState?.() && !document.querySelector(".viewport-preparing-overlay")'))break}
  await evaluate(`document.querySelectorAll('button')[1].click()`)
  for(let i=0;i<160;i++){
    await pause(250)
    if(await evaluate(`(()=>{const ids=new Set();window.viewerState()?.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render'&&o.geometry.attributes.position.count)ids.add(o.userData.floorId)});return ids.has('a5e1058b-f220-4fef-9e1f-5cb871e2e0c5')&&ids.has('db559ff8-8f78-4b2c-8093-d57d78580c07')})()`))break
  }
  await pause(2000)
  const result = await evaluate(`(async()=>{
    const {Raycaster,Vector3,Vector2}=await import('/node_modules/three/build/three.module.js');
    const s=window.viewerState();s.setFrameloop('never');s.scene.updateMatrixWorld(true);
    const objects=[];s.scene.traverse(o=>{if(o.isMesh&&o.userData.houseDesignerRole&&!o.userData.houseDesignerRole.includes('pick')&&!o.userData.houseDesignerRole.includes('shadow'))objects.push(o)});
    const hit=(origin,direction,filter=()=>true)=>new Raycaster(new Vector3(...origin),new Vector3(...direction)).intersectObjects(objects.filter(filter));
    s.camera.position.set(4.5,4.8,17.4);s.camera.lookAt(3.25,5.15,16.15);s.camera.updateMatrixWorld();
    const ray=new Raycaster();ray.setFromCamera(new Vector2(996/1783*2-1,1-505/905*2),s.camera);
    const valley=ray.intersectObjects(objects)[0];
    const wall=hit([4,4.75,16.5],[-1,0,0],o=>o.userData.houseDesignerRole==='wall-engine-render')[0];
    const low=hit([3.5,2.35,16.57],[-1,0,0],o=>o.userData.houseDesignerRole==='wall-engine-render');
    const inside=[3.125,3.15,3.25].flatMap(x=>[15.8,16,16.15].map(z=>{
      const h=hit([x,4.5,z],[0,1,0],o=>o.userData.houseDesignerRole.startsWith('roof-'))[0];
      return h?{...h.object.userData,y:h.point.y}:null;
    }));
    const texture=h=>{if(!h)return null;const m=Array.isArray(h.object.material)?h.object.material[h.face.materialIndex]:h.object.material;return m.map?.source?.uuid??null};
    const lowFinish=[2.32,2.35].flatMap(y=>[16.57,16.8,17.05,17.3].map(z=>texture(hit([3.5,y,z],[-1,0,0],o=>o.userData.houseDesignerRole==='wall-engine-render')[0])));
    const facadeFinish=texture(wall);
    const hall=[16.8,17,17.2].map(z=>{
      const wall=hit([3.5,2.28,z],[-1,0,0],o=>o.userData.houseDesignerRole==='wall-engine-render')[0];
      const ceiling=hit([3.2,1.8,z],[0,1,0])[0];
      return {wallX:wall?.point.x,ceilingY:ceiling?.point.y,role:ceiling?.object.userData.houseDesignerRole};
    });
    return {valley:valley?.object.userData,wall:wall?.point.toArray(),low:low.map(h=>({floor:h.object.userData.floorId,p:h.point.toArray()})),lowFinish,facadeFinish,inside,hall};
  })()`)
  for(const [name,pos,target] of [['hall',[4.9,1.8,16.6],[3.6,2.3,17.6]],['lowleft',[4.2,3.8,18],[3.12,2.55,17.1]],['insideclose',[3.23,4.5,15.2],[3.15,4.95,16]],['inside',[3.7,4.5,14.8],[3.2,4.9,16]],['valley',[4.5,4.8,17.4],[3.25,5.15,16.15]],['above',[6,8,20],[2.8,5.5,15.5]]]){
    await evaluate(`(()=>{const s=window.viewerState();s.camera.position.set(...${JSON.stringify(pos)});s.camera.lookAt(...${JSON.stringify(target)});s.camera.updateMatrixWorld();s.gl.clear();s.gl.render(s.scene,s.camera)})()`)
    writeFileSync(`.tmp-viewer-${name}-verified.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  }
  console.log('Viewer roof junction checks',JSON.stringify(result))
  assert.equal(result.valley?.houseDesignerRole,'roof-top','no ceiling protrudes through the exterior valley')
  assert.ok(result.wall?.[0]>3.14,'the supporting facade remains at its exterior face instead of exposing a low wall cap')
  assert.ok(result.low.length&&result.low.every(h=>h.floor==='a5e1058b-f220-4fef-9e1f-5cb871e2e0c5'),'upper-storey reveals cannot overlap the lower facade')
  assert.ok(result.facadeFinish&&result.lowFinish.every(texture=>texture===result.facadeFinish),'the exposed strip retains the surrounding facade brick')
  assert.ok(result.inside.every(h=>h?.houseDesignerRole==='roof-underside'&&h.roofId==='b46c5b90-ecdc-4d0f-a6a5-976b793c7270'),'the receiving roof finish closes the room corner without foreign tiles or fascia')
  assert.ok(result.hall.every(h=>h.ceilingY>2.3&&h.ceilingY<2.4&&h.role==='room-sloping-ceiling-finish'&&Math.abs(h.wallX-3.144761923)<1e-5),'the hall has a finished sloping ceiling meeting its wall, without exposed tiles or a boxed eave')
  console.log('Viewer roof junctions passed')
}finally{ws?.close();child.kill()}
