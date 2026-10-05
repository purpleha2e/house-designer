// With Vite on port 5180: node tests/browser/asymmetricRoofJunctionRegression.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1800,1000',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bay-roof-'))}`, 'about:blank',
], { windowsHide: true })
let ws
const anchored = process.argv.includes('--anchored')
const finishing = process.argv.includes('--finishing') || anchored
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout=setTimeout(()=>reject(new Error('Chrome startup timed out')),30000)
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
    const timeout=setTimeout(()=>reject(new Error(`${method} timed out`)),30000)
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
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/roofWallRegression.html'})
  for(let i=0;i<60;i++){await pause(250);if(await evaluate('!!window.roofWallScene?.()'))break}
  await evaluate(`(async()=>{
    const p=await(await fetch('/tests/fixtures/${finishing ? 'roofFinishingRegression' : 'asymmetricRoofJunctionRegression'}.json')).json();
    if(${anchored}) delete p.floors[1].roofs.find(r=>r.asymmetricSides).mountSide;
    const {normalizeFloor}=await import('/src/modelPlacement.ts');
    const {modelsById}=await import('/src/models/modelLibrary.ts');
    window.updateRegressionFloors(p.floors.map(f=>normalizeFloor(f,modelsById)));
    window.updateRegressionAssignments([]);window.updateRegressionActiveFloor(p.floors[1].id);
  })()`)
  const inspect=()=>evaluate(`(async()=>{
    const {Raycaster,Vector3}=await import('/node_modules/three/build/three.module.js');
    const s=window.roofWallScene();s.scene.updateMatrixWorld(true);
    const sourceId='8e321618-2fa0-4ea5-99ec-8210302fe639',targetId='b46c5b90-ecdc-4d0f-a6a5-976b793c7270';
    const sourceTiles=[],targetTiles=[],sourceEnd=[],targetGable=[],walls=[];
    s.scene.traverse(o=>{
      const d=o.userData;
      if(d.houseDesignerRole==='roof-top'&&d.roofId===sourceId)sourceTiles.push(o);
      if(d.houseDesignerRole==='roof-top'&&d.roofId===targetId)targetTiles.push(o);
      if(d.houseDesignerRole==='roof-infill'&&d.roofId===sourceId&&d.wallId==='3b9a14db-f2c3-4944-ab7c-006906d8175e')sourceEnd.push(o);
      if(d.houseDesignerRole==='roof-infill'&&d.roofId===targetId)targetGable.push(o);
      if(d.houseDesignerRole==='wall-engine-render'&&d.floorId===window.regressionFloors[1].id)walls.push(o);
    });
    if(!sourceTiles.length||!targetTiles.length||!targetGable.length||!walls.length)return null;
    const hits=(objects,origin,direction)=>new Raycaster(new Vector3(...origin),new Vector3(...direction)).intersectObjects(objects);
    return {
      patch:hits(sourceTiles,[7.4,10,12.7],[0,-1,0]).length,
      original:hits(sourceTiles,[7.4,10,11.3],[0,-1,0]).length,
      branchAtSide:hits(sourceTiles,[5,10,12],[0,-1,0]).length,
      receiverAtSide:hits(targetTiles,[5,10,12],[0,-1,0]).length,
      branchNearGable:hits(sourceTiles,[6.3,10,12.5],[0,-1,0]).length,
      receiverNearGable:hits(targetTiles,[6.3,10,12.5],[0,-1,0]).length,
      returnTop:hits(sourceEnd,[6.6,10,11.5],[0,-1,0])[0]?.point.y,
      returnRoofTop:hits(sourceTiles,[6.6,10,11.5],[0,-1,0])[0]?.point.y,
      flushCorner:[5.2,5.6,6].map(y=>hits([...sourceEnd,...targetGable],[6.65,y,11.65],[-1,0,0])[0]?.point.x),
      raisedSide:hits(targetGable,[0.8,5.2,9],[0,0,1])[0]?.point.z,
      coveredWallCap:hits(sourceTiles,[6.6,10,11.5],[0,-1,0]).length,
      joinedEave:hits(targetTiles,[1.4,10,9.4],[0,-1,0]).length,
      oldLowStrip:hits(sourceTiles,[1.4,10,9.95],[0,-1,0]).length,
      mountedHeight:hits(targetTiles,[0,10,10.010690667],[0,-1,0])[0]?.point.y,
      retainedEave:hits(sourceTiles,[1.4,10,9.5],[0,-1,0]).length,
      anchoredProfile:await(async()=>{
        const {resolveBuildingRoofs}=await import('/src/roofBuildingGeometry.ts');
        const {getGableRidgeHeight,getPitchedRoofHeightAtX}=await import('/src/roofProfile.ts');
        const candidates=resolveBuildingRoofs(window.regressionFloors);
        const a=candidates.find(r=>r.roof.id===targetId),b=candidates.find(r=>r.roof.id===sourceId);
        return {mount:a.floorTopElevation+getPitchedRoofHeightAtX(a.roof,a.resolved.support,a.resolved.support.minX),
          targetMount:b.floorTopElevation,
          peak:a.floorTopElevation+getGableRidgeHeight(a.roof,a.resolved.support),
          targetPeak:b.floorTopElevation+getGableRidgeHeight(b.roof,b.resolved.support),
          extensions:a.resolved.joinedEaveFaces?.length??0};
      })(),
      outsideCap:hits(sourceEnd,[7,10,11.5],[0,-1,0]).length,
      upperBrick:hits(targetGable,[10,5.6,12.7],[-1,0,0])[0]?.point.x,
      lowerBrick:hits(walls,[10,4.9,12.7],[-1,0,0])[0]?.point.x,
      fittedWallTop:hits(walls,[4,10,16.35],[0,-1,0])[0]?.point.y,
      lowRoofTop:hits(targetTiles,[4,10,16.35],[0,-1,0])[0]?.point.y,
      ceilingAboveLowRoof:(()=>{const ceilings=[];s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='room-ceiling-finish')ceilings.push(o)});
        return hits(ceilings,[4,10,16.2],[0,-1,0]).filter(h=>h.point.y>4.9).length})(),
    };
  })()`)
  let result
  for(let i=0;i<80;i++){
    await pause(250);result=await inspect();
    if(result&&result.patch===0&&Math.abs(result.returnRoofTop-result.returnTop-0.04)<1e-5&&result.flushCorner.every(x=>Math.abs(x-6.520947)<1e-5)&&result.original>0&&result.lowerBrick>6.5&&result.lowerBrick<6.55&&
      (!finishing||Math.abs(result.lowRoofTop-result.fittedWallTop-0.035)<1e-5))break
  }
  assert.ok(result,'the saved roof junction has finished rendering')
  assert.equal(result.patch,0,'no unsupported tile patch beside the receiving gable')
  assert.ok(result.original>0,'authored roof coverage remains')
  assert.ok(Math.abs(result.returnRoofTop-result.returnTop-0.04)<1e-5,'brick closes beneath the surviving tiles without rising past their underside')
  assert.ok(result.flushCorner.every(x=>Math.abs(x-6.520947)<1e-5),`the exposed corner closes flush with the receiving gable: ${result.flushCorner}`)
  if(anchored){
    assert.ok(Math.abs(result.mountedHeight-5.1)<1e-5,'rendered tiles meet the mount at 5.10 m')
    assert.ok(result.retainedEave>0,'the long incoming eave is no longer prematurely snipped')
    assert.ok(Math.abs(result.anchoredProfile.mount-result.anchoredProfile.targetMount)<1e-8,'mount heights agree')
    assert.ok(Math.abs(result.anchoredProfile.peak-result.anchoredProfile.targetPeak)<1e-8,'ridge heights agree')
    assert.equal(result.anchoredProfile.extensions,0,'the anchored roof needs no added eave extension')
  }else{
  assert.ok(result.branchAtSide>0,'the higher branch remains at the side junction')
  assert.equal(result.receiverAtSide,0,'the joined branch clips the receiving slope at the side')
  assert.equal(result.branchNearGable,0,'the branch still yields beneath the receiving slope near its gable')
  assert.ok(result.receiverNearGable>0,'the receiving slope remains towards its gable')
  assert.ok(result.outsideCap>0,'the exposed source gable remains outside the junction')
  assert.ok(Math.abs(result.upperBrick-6.520947)<1e-5,'the upper brick gable closes the trimmed area')
  assert.ok(Math.abs(result.lowerBrick-6.520947)<1e-5,'the lower brick facade continues to the same boundary')
  }
  if(finishing&&!anchored){
    assert.ok(result.coveredWallCap>0,'the original roof covers the wall cap outside the receiving gable')
    assert.ok(result.joinedEave>0,'the raised slope extends to the lower roof')
    assert.equal(result.oldLowStrip,0,'no tile strip remains beneath the joined fascia')
    assert.ok(Math.abs(result.raisedSide-10.010690667)<1e-5,'brick closes the raised eave gap in the supporting wall plane')
    assert.ok(Math.abs(result.lowRoofTop-result.fittedWallTop-0.035)<1e-5,'the shared wall cap closes beneath the lowered roof')
    assert.equal(result.ceilingAboveLowRoof,0,'the fitted room ceiling cannot protrude through the roof')
  }
  await evaluate(`(()=>{const s=window.roofWallScene();s.setFrameloop('never');s.camera.position.set(14.594573,8.134615,13.349255);
    s.camera.quaternion.set(0.115456899,-0.637439609,-0.097408569,-0.755547497);s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera)})()`)
  writeFileSync(anchored?'.tmp-roof-mounted-regression.png':finishing?'.tmp-roof-finishing-regression.png':'.tmp-asymmetric-junction-regression.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('Asymmetric roof junction: mutual slope trimming, bounded tiles, hidden cap and continuous brick facade passed',result)
}finally{ws?.close();child.kill()}
