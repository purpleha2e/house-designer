import { projectDownloadFixtureSource } from './projectDownloadFixture.mjs'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

// Exercise real App callbacks and persistence, in an isolated browser profile.
const output='tmp/project-light-limit'
mkdirSync(output,{recursive:true})
const report={steps:[]}
const browser=await lightingBrowser({onEvent:event=>{
  if(event.method==='Runtime.consoleAPICalled'&&event.params.type==='error'){
    report.console??=[];report.console.push(event.params);console.log('Browser error',JSON.stringify(event.params.stackTrace))
  }
}})
try {
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.fixture={activeFloorId:'floor-0',wallKind:'external',threeDView:{floorViewId:'all'},
      sunPosition:{azimuth:1,elevation:.7,strength:1},
      floors:[0,1].map(i=>({id:'floor-'+i,name:'Floor '+i,elevation:i*2.7,roomHeight:2.4,slabThickness:.3,rooms:[],roofs:[],
        walls:[[0,0,6,0],[6,0,6,5],[6,5,0,5],[0,5,0,0]].map(([x,y,xx,yy],j)=>({
          id:i+'-wall-'+j,start:{x,y},end:{x:xx,y:yy},height:2.4,thickness:.2,kind:'external',openings:[]})),
        models:Array.from({length:13},(_,j)=>({id:'lamp-'+i+'-'+j,modelId:j%3===0?'spotlight':'point-light',
          position:{x:1+(j%4)*1.25,y:1+Math.floor(j/4)},rotation:0,scale:1,height:2.2,lightPower:80,lightEnabled:j!==12}))}))};
    const nativeFetch=window.fetch;
    window.fetch=(input,options)=>String(input).includes('/colin_house_v2.json')
      ?Promise.resolve(new Response(JSON.stringify(fixture),{headers:{'Content-Type':'application/json'}})):nativeFetch(input,options);
    window.confirm=()=>true;
    ${projectDownloadFixtureSource}window.projectDownloadFixture=async()=>({name:'many-lights.json',createWritable:async()=>({
      write:async data=>{window.savedProject=JSON.parse(typeof data==='string'?data:await data.text())},close:async()=>{}})});
    ${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{name:'many-lights.json',getFile:async()=>new File([JSON.stringify(savedProject)],'many-lights.json')}];
  `})
  await browser.call('Page.navigate',{url:process.argv[2]??'http://127.0.0.1:5187/'})
  await browser.wait(`!!document.querySelector('[aria-label="2D editing floor"]')`)
  await browser.evaluate(`(()=>{
    window.propsFor=name=>{const root=document.getElementById('root');
      const fiber=root[Object.keys(root).find(k=>k.startsWith('__reactContainer$'))].stateNode.current;
      let found;const walk=f=>{if(!f)return;if((f.type?.name??f.type?.type?.name)===name)found=f.memoizedProps;walk(f.child);walk(f.sibling)};walk(fiber);if(!found)walk(window.lightFiber?.());return found};
    window.lightState=()=>propsFor('FloorplanCanvas').floors.flatMap(f=>f.models).map(m=>({id:m.id,enabled:m.lightEnabled!==false}));
  })()`)
  const state=()=>browser.evaluate('lightState()')
  const check=async(label,enabled,total)=>{
    await browser.wait(`lightState().length===${total} && lightState().filter(m=>m.enabled).length===${enabled}`)
    const s=await state();report.steps.push({label,enabled,total});console.log(label,{enabled,total});return s
  }
  await check('Bootstrap preserves switches across both floors',24,26)
  await browser.evaluate(`import('/tests/browser/rendererTestModules.ts').then(m=>{window.lightScene=m.getEditorState;window.lightFiber=m.getEditorFiber})`)
  await browser.wait(`lightScene()?.scene.userData.progressiveStartup?.phase==='full' && !lightScene().scene.userData.shaderWarmupPending`,300000)
  console.log('Initial many-light scene ready')
  await browser.evaluate(`propsFor('FloorplanCanvas').onUpdateModel('lamp-0-0',{lightEnabled:false})`)
  await check('Only the requested light switches off',23,26)
  await browser.evaluate(`propsFor('FloorplanCanvas').onUpdateModel('lamp-1-12',{lightEnabled:true})`)
  await check('A previously disabled light can turn on above eleven',24,26)
  assert.equal((await state()).find(m=>m.id==='lamp-0-0').enabled,false)
  assert.equal((await state()).find(m=>m.id==='lamp-0-12').enabled,false)

  await browser.evaluate(`propsFor('LeftToolRail').onOpenModelSelector('objects')`)
  await browser.wait(`!!propsFor('ModelSelector')`)
  await browser.evaluate(`propsFor('ModelSelector').onSelectModel('point-light')`)
  // Ordinary objects are placed immediately; only wall openings enter the
  // click-to-place preview used by doors and windows.
  await check('Placing a new light preserves all other switches',25,27)
  await browser.evaluate(`propsFor('EditToolbar').onCopy()`)
  await browser.wait(`propsFor('EditToolbar').canPaste`)
  await browser.evaluate(`propsFor('EditToolbar').onPaste()`)
  const pasted=await check('Pasting a light preserves all other switches',26,28)
  await browser.evaluate(`propsFor('EditToolbar').onUndo()`)
  await check('Undo restores more than eleven enabled lights',25,27)
  await browser.evaluate(`propsFor('EditToolbar').onRedo()`)
  assert.deepEqual(await check('Redo restores every switch',26,28),pasted)

  const menu=async(label)=>{
    await browser.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
    await browser.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`)
  }
  await menu('Save to device');await browser.wait('!!window.savedProject')
  assert.deepEqual(await browser.evaluate(`savedProject.floors.flatMap(f=>f.models).map(m=>({id:m.id,enabled:m.lightEnabled!==false}))`),pasted)
  await browser.evaluate(`propsFor('FloorplanCanvas').onUpdateModel('lamp-0-1',{lightEnabled:false})`)
  await check('A later edit changes only one switch',25,28)
  await menu('Load')
  assert.deepEqual(await check('File loading preserves saved switches exactly',26,28),pasted)
  await browser.wait(`propsFor('IndirectLighting')?.localLights?.length===28 && propsFor('IndirectLighting').localLights.filter(l=>l.power>0).length===26`)
  const pool=await browser.evaluate(`({limit:propsFor('FixedLocalLightPool').maxLights,selected:propsFor('FixedLocalLightPool').localLightIds.size})`)
  assert.equal(pool.selected,28,'All-light mode retains every installed lamp, including dormant slots')
  assert.ok(pool.selected<=pool.limit)
  report.pool=pool
  console.log('All 26 enabled lamps reach GI and direct rendering',pool)
  await browser.wait(`lightScene()?.scene.userData.indirectLighting?.state==='ready' && !lightScene().scene.userData.shaderWarmupPending`,300000)
  report.gi=await browser.evaluate(`(()=>{const s=lightScene();return {state:s.scene.userData.indirectLighting.state,source:s.scene.userData.indirectLighting.source,occlusion:s.scene.userData.roomLightOcclusion,glError:s.gl.getContext().getError()}})()`)
  assert.equal(report.gi.glError,0)
  assert.deepEqual(browser.errors,[])
  console.log('PASS project switches, placement, paste, history, save/load and GI',report.gi)
}catch(error){report.failure=String(error);report.errors=browser.errors;report.state=await browser.evaluate('window.lightState?.()').catch(()=>null);throw error}
finally{writeFileSync(output+'/report.json',JSON.stringify(report,null,2));browser.close()}
