// Run against Vite: node tests/browser/windowBuilderRegression.mjs [port]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run',
  '--no-default-browser-check','--window-size=1440,1000',`--user-data-dir=${mkdtempSync(join(tmpdir(),'window-builder-'))}`,'about:blank'
],{windowsHide:true})
let ws
try {
  const endpoint=await new Promise((resolve,reject)=>{
    child.stderr.on('data',data=>{const m=String(data).match(/DevTools listening on (ws:\/\/\S+)/);if(m)resolve(m[1])})
    child.on('error',reject);child.on('exit',code=>reject(new Error(`Chrome exited ${code}`)))
  })
  ws=new WebSocket(endpoint);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}))
  let id=0;const pending=new Map()
  ws.addEventListener('message',e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(r.error):p.resolve(r.result)}})
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}))})
  const {targetId}=await send('Target.createTarget',{url:'about:blank'})
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
  const call=(method,params)=>send(method,params,sessionId)
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value}
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  const waitFor=async expression=>{for(let i=0;i<160;i++){if(await evaluate(expression))return;await pause(200)}throw new Error(`Timed out: ${expression}`)}
  await call('Page.enable')
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/roofCreatePreviewRegression.html`})
  await waitFor(`!!window.roofCreateScene?.() && !!document.querySelector('[aria-label="Project menu"]')`)
  const click=async text=>{await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)} || b.querySelector('strong')?.textContent===${JSON.stringify(text)}).click()`);await pause(100)}
  const aria=async label=>{await evaluate(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`);await pause(100)}
  const field=async(label,value)=>{await evaluate(`(()=>{const el=[...document.querySelectorAll('.window-builder label')].find(el=>el.textContent.trim().startsWith(${JSON.stringify(label)})).querySelector('input,select');Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);await pause(100)}
  const menu=async name=>{await aria('Project menu');await click(name);await pause(250)}
  const save=async()=>{await evaluate('window.savedWindowProject=null');await menu('Save');await waitFor('!!window.savedWindowProject');return evaluate('window.savedWindowProject')}
  const fixture={activeFloorId:'ground',wallKind:'external',floors:[{id:'ground',name:'Ground',elevation:0,roomHeight:3,slabThickness:.2,rooms:[],walls:[],models:[],roofs:[]}]}
  await evaluate(`window.fixture=${JSON.stringify(fixture)};window.alert=msg=>{window.lastAlert=msg};window.showOpenFilePicker=async()=>[{getFile:async()=>new File([JSON.stringify(window.fixture)],'windows.house.json')}];window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async value=>{window.savedWindowProject=JSON.parse(value)},close:async()=>{}})})`)
  await menu('Load')
  await aria('Add windows or doors');await click('Build a window')
  await waitFor(`!!document.querySelector('.window-builder')`)
  await field('Variety name','Two pane top lights')
  await click('2 panes');await click('Add 300 mm top openings')
  assert.equal(await evaluate(`document.querySelectorAll('.window-builder-pane').length`),4)
  await field('Width (mm)',1600)
  await field('Height (mm)',1400)
  // Exercise native pointer capture and dragging on a horizontal divider.
  const drag=await evaluate(`(()=>{const d=document.querySelector('.window-builder-divider.y').getBoundingClientRect();return{x:d.x+d.width/2,y:d.y+d.height/2}})()`)
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...drag})
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:drag.x,y:drag.y+12})
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:drag.x,y:drag.y+12})
  await pause(150)
  await field('Top section height (mm)',300)
  await field('Separator width (mm)',35)
  const centreDivider=await evaluate(`(()=>{const d=document.querySelector('.window-builder-divider.x').getBoundingClientRect();return{x:d.x+d.width/2,y:d.y+d.height/2}})()`)
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...centreDivider})
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...centreDivider})
  await pause(100)
  await field('Separator width (mm)',90)
  await click('Use default width')
  assert.equal(await evaluate(`document.querySelector('.window-builder-selection input').value`),'50')
  await field('Separator width (mm)',80)
  await field('Default divider width (mm)',60)
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.window-builder-divider')].map(d=>Number(d.getAttribute(d.classList.contains('x')?'width':'height')))`),[.08,.035,.06])
  await click('3D preview');await waitFor(`!!document.querySelector('.window-builder canvas')`)
  await pause(500)
  writeFileSync('.tmp-window-builder-3d.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await click('2D layout')
  writeFileSync('.tmp-window-builder-2d.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await click('Save to My windows')
  await waitFor(`!document.querySelector('.window-builder') && !!document.querySelector('[aria-label="Edit variety Two pane top lights"]')`)
  let project=await save()
  const first=project.modelDefinitions.find(d=>d.name==='Two pane top lights')
  assert.ok(first?.windowDesign)
  assert.equal(first.windowDesign.layout.dividerWidth,.08)
  assert.equal(first.windowDesign.layout.children[0].dividerWidth,.035)
  await aria('Edit variety Two pane top lights')
  await field('Variety name','Single picture window');await click('1 pane');await click('Save as new variety')
  await waitFor(`!document.querySelector('.window-builder') && !!document.querySelector('[aria-label="Edit variety Single picture window copy"]')`)
  await aria('Edit variety Single picture window copy');await field('Variety name','Four panes');await click('4 panes');await click('Save as new variety')
  await waitFor(`!document.querySelector('.window-builder') && !!document.querySelector('[aria-label="Edit variety Four panes copy"]')`)
  project=await save()
  const defs=project.modelDefinitions.filter(d=>d.windowDesign)
  assert.equal(defs.length,3)
  const other=defs.find(d=>d.name==='Single picture window copy'),third=defs.find(d=>d.name==='Four panes copy')
  // Twenty instances of three varieties across two floors.
  const floors=[0,1].map(f=>({id:f?'upper':'ground',name:f?'Upper':'Ground',elevation:f*3.2,roomHeight:3,slabThickness:.2,rooms:[],roofs:[],
    walls:[{id:`wall-${f}`,kind:'external',start:{x:0,y:0},end:{x:50,y:0},height:3,thickness:.2}],
    models:Array.from({length:10},(_,i)=>({id:`window-${f}-${i}`,modelId:i<6?first.id:i<8?other.id:third.id,
      position:{x:2+i*4.5,y:0},rotation:0,scale:1,wallOpeningBottom:.8,wallAttachment:{wallId:`wall-${f}`,offset:2+i*4.5,side:1}}))}))
  await aria('Close model selector')
  await evaluate(`window.fixture=${JSON.stringify({...project,floors,activeFloorId:'ground'})}`);await menu('Load')
  await waitFor(`!!window.roofCreateScene().getObjectByName('model-transform-window-0-0')`)
  await aria('Add windows or doors');await aria('Edit variety Two pane top lights')
  assert.ok(await evaluate(`document.querySelector('.window-builder header').textContent.includes('12 placed windows')`))
  await field('Width (mm)',1800);await field('Height (mm)',1500);await field('Frame colour','#374151')
  await click('Save variety');await waitFor(`!document.querySelector('.window-builder')`)
  project=await save()
  for(const floor of project.floors) {
    assert.equal(floor.walls[0].openings.length,10)
    floor.walls[0].openings.forEach((o,i)=>{assert.ok(Math.abs(o.width-(i<6?1.8:1.6))<1e-6);assert.ok(Math.abs(o.height-(i<6?1.5:1.4))<1e-6)})
  }
  await waitFor(`window.roofCreateScene().getObjectByName('model-transform-window-0-0')?.getObjectByName('parametric-window')?.userData.windowDesign.width===1.8`)
  const rendered=await evaluate(`(()=>{const g=window.roofCreateScene().getObjectByName('model-transform-window-0-0').getObjectByName('parametric-window');return{glass:g.children.filter(o=>o.name.startsWith('glass')).length,frame:g.getObjectByName('frame-top').geometry.parameters.height,color:g.userData.windowDesign.color,vertical:g.getObjectByName('divider-r').geometry.parameters.width,horizontal:g.getObjectByName('divider-r.0').geometry.parameters.height}})()`)
  assert.equal(rendered.glass,4);assert.equal(rendered.frame,.06);assert.equal(rendered.color,'#374151')
  assert.equal(rendered.vertical,.08);assert.equal(rendered.horizontal,.035)
  await aria('Close model selector');await aria('Undo');project=await save()
  assert.equal(project.modelDefinitions.find(d=>d.id===first.id).width,1.6)
  await aria('Redo');project=await save()
  assert.equal(project.modelDefinitions.find(d=>d.id===first.id).width,1.8)
  // Check the actual local GLB, not just the library metadata.
  const stored=await evaluate(`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('house-designer-windows',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const records=await new Promise(resolve=>{const r=db.transaction('windows').objectStore('windows').getAll();r.onsuccess=()=>resolve(r.result)});db.close();return Promise.all(records.map(async r=>({id:r.id,width:r.design.width,magic:new DataView(await r.glb.arrayBuffer()).getUint32(0,true),bytes:r.glb.size})))})()`)
  assert.equal(stored.length,3);stored.forEach(r=>{assert.equal(r.magic,0x46546c67);assert.ok(r.bytes>1000)})
  // Round trip through the real project loader retains layouts and all linked instances.
  await evaluate(`window.fixture=${JSON.stringify(project)}`);await menu('Load')
  const roundTrip=await save()
  assert.deepEqual(roundTrip.modelDefinitions,project.modelDefinitions)
  assert.equal(roundTrip.floors.flatMap(f=>f.models).length,20)
  // Refresh verifies My windows survives without a project file or a transient blob URL.
  await evaluate('window.windowReloadMarker=true')
  await call('Page.reload',{})
  await waitFor('window.windowReloadMarker!==true')
  await waitFor(`!!document.querySelector('[aria-label="Add windows or doors"]')`)
  await aria('Add windows or doors')
  await waitFor(`!!document.querySelector('[aria-label="Edit variety Two pane top lights"]')`)
  await aria('Edit variety Two pane top lights')
  await waitFor(`!!document.querySelector('.window-builder')`)
  assert.equal(await evaluate(`document.querySelector('.window-builder-fields input').value`),'1800')
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.window-builder-divider')].map(d=>Number(d.getAttribute(d.classList.contains('x')?'width':'height')))`),[.08,.035,.06])
  console.log('Window builder: pane editing, divider drag, 3D rendering, 20 linked instances, three varieties, undo/redo, local GLB and project/reload persistence passed')
} finally {ws?.close();child.kill()}
