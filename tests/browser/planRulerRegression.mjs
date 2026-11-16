import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'

const points = [{x:1,y:1},{x:5,y:1},{x:5,y:5},{x:1,y:5}]
const floor = {id:'ruler-floor',name:'Ruler test',elevation:0,roomHeight:2.4,slabThickness:.2,models:[],rooms:[],roofs:[],
  walls:points.map((start,i)=>({id:'wall-'+i,start,end:points[(i+1)%4],kind:'external',thickness:.2,height:2.4,openings:[]}))}
const project = {activeFloorId:floor.id,floors:[floor],wallKind:'external',twoDView:{viewportsByFloorId:{[floor.id]:{x:30,y:80,scale:1}}}}
const b = await lightingBrowser()
try {
  await b.call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false})
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`${projectFileInputFixtureSource}
    window.confirm=()=>true;
    window.projectFileFixture=async()=>[{getFile:async()=>new File([${JSON.stringify(JSON.stringify(project))}],'ruler.house.json')}];
    window.rulerStage=()=>window.Konva?.stages[0];
    window.rulerPoints=()=>rulerStage()?.findOne('.ruler-measurement')?.points();
  `})
  await b.call('Page.navigate',{url:`http://localhost:${process.argv[2]??4173}/`})
  await b.wait(`!!document.querySelector('[aria-label="Project menu"]')`,30000)
  await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await b.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()==='Load').click()`)
  await b.wait(`document.body.innerText.includes('Ruler test')&&!!rulerStage()`,30000)
  await b.evaluate(`document.querySelector('[aria-label="Ruler"]').click()`)
  await b.wait(`!!rulerStage().findOne('.ruler-input')`)
  const position=async(x,y)=>b.evaluate(`(()=>{const s=rulerStage(),r=s.container().getBoundingClientRect();return{x:r.left+s.x()+${x}*60*s.scaleX(),y:r.top+s.y()+${y}*60*s.scaleY()}})()`)
  const move=async(x,y,modifiers=0)=>b.call('Input.dispatchMouseEvent',{type:'mouseMoved',...await position(x,y),modifiers})
  const click=async(x,y,modifiers=0)=>{
    const p=await position(x,y)
    await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p,modifiers})
    await b.call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1,modifiers})
    await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1,modifiers})
  }
  await click(1.12,3);await move(4.88,3)
  await b.wait(`rulerStage().findOne('.ruler-reading')?.text()==='3.800 m'`,10000)
  await click(4.88,3);await move(3,4)
  assert.equal(await b.evaluate(`rulerStage().findOne('.ruler-reading').text()`),'3.800 m','second click holds measurement')
  await click(.88,3);await move(5.12,3)
  await b.wait(`rulerStage().findOne('.ruler-reading')?.text()==='4.200 m'`,10000)
  await click(5.12,3)
  await click(2,2);await move(3.31,2.64)
  let result=await b.evaluate('rulerPoints()')
  assert.ok(Math.abs((result[3]-result[1])/(result[2]-result[0])-.64/1.31)<.02,'free direction')
  await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:2})
  await b.wait(`Math.abs((rulerPoints()[3]-rulerPoints()[1])-(rulerPoints()[2]-rulerPoints()[0]))<.001`,10000)
  await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:0})
  await b.wait(`Math.abs((rulerPoints()[3]-rulerPoints()[1])/(rulerPoints()[2]-rulerPoints()[0])-.64/1.31)<.02`,10000)
  await move(4.88,2.1,2)
  await b.wait(`Math.abs(rulerPoints()[2]/60-4.9)<.001&&Math.abs(rulerPoints()[3]/60-2)<.001`,10000)
  await click(4.88,2.1,2)
  const shot=await b.call('Page.captureScreenshot',{format:'png'})
  writeFileSync('tmp/ruler-preview.png',Buffer.from(shot.data,'base64'))
  // Zoom retains metre readings and keeps screen-space annotation sizes constant.
  await b.evaluate(`document.querySelector('[aria-label="Zoom in"]').click()`)
  await b.wait(`rulerStage().scaleX()>1`)
  assert.equal(await b.evaluate(`rulerStage().findOne('.ruler-reading').text()`),'2.900 m')
  await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await b.wait(`!rulerStage().findOne('.ruler-input')`,10000)
  assert.equal(await b.evaluate(`document.querySelector('[aria-label="Ruler"]').getAttribute('aria-pressed')`),'false')
  assert.deepEqual(b.errors,[])
  console.log('PASS inner/outer wall snaps, free direction, live Ctrl angle lock, constrained wall snap, held reading, zoom and Escape')
} finally { b.close() }
