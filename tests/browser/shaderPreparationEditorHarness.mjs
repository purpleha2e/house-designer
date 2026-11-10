// Real startup and file-menu controls. One owned browser; no direct state writes.
import { lightingBrowser } from './lightingHarness.mjs'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const [mode='startup',label='after',port='5212']=process.argv.slice(2),out=`tmp/shader-preparation/bootstrap-${label}-${mode}`
mkdirSync(out,{recursive:true})
let finishTrace;const trace=new Promise(resolve=>{finishTrace=resolve})
const b=await lightingBrowser({onEvent:event=>{if(event.method==='Tracing.tracingComplete')finishTrace(event.params)}}),report={mode,label,steps:[]},pause=ms=>new Promise(r=>setTimeout(r,ms))
const expected=Object.fromEntries(['colin_house_v2.json','springfield_14.json'].map(name=>{const p=JSON.parse(readFileSync(name,'utf8'));return[name,p.floors.map(f=>f.id)]}))
const current=`(()=>{const p=bootProps('ThreeDView'),plan=bootProps('FloorplanCanvas'),s=window.perfScene?.();return{at:performance.now(),ids:p?.floors.map(f=>f.id),project:p?.lightingResetRevision,sceneProject:s?.scene.userData.projectGeneration,phase:s?.scene.userData.progressiveStartup,covered:!!document.querySelector('.viewport-preparing-overlay'),planWalls:plan?.activeFloor.walls.length,caption:document.querySelector('.floorplan-toolbar')?.textContent,canvas:!!s?.gl.domElement.isConnected}})()`
async function click(selector,text){const p=await b.evaluate(`(()=>{const a=[...document.querySelectorAll(${JSON.stringify(selector)})],e=${text?`a.find(e=>e.textContent.trim()===${JSON.stringify(text)})`:'a[0]'};if(!e)throw Error('Missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await b.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...p});await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...p})}
async function shot(name){const s=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(s.data,'base64'))}
async function waitUI(){await b.wait(`!!document.querySelector('[aria-label="Project menu"]')`,30000)}
async function navigate(label){
 await b.wait('!!document.querySelector(".three-host canvas")&&!!perfScene()?.camera',15000)
 await b.evaluate(`shaderProgramAudit.setAction(${JSON.stringify(label)});document.querySelector('.three-host canvas').focus()`)
 const before=await b.evaluate(`({at:performance.now(),camera:perfScene()?.camera.position.toArray(),generation:perfScene()?.scene.userData.projectGeneration,pending:perfScene()?.scene.userData.shaderWarmupPending})`)
 const at=Date.now();await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87,timestamp:at/1000});await pause(650);await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87,timestamp:Date.now()/1000})
 const after=await b.evaluate(`({at:performance.now(),camera:perfScene()?.camera.position.toArray(),generation:perfScene()?.scene.userData.projectGeneration,pending:perfScene()?.scene.userData.shaderWarmupPending})`)
 report.steps.push({action:'navigate '+label,at,before,after});await shot('navigate-'+label.replaceAll(/[^a-zA-Z]/g,'-'))
}
async function navigateBurst(label='Colin'){
 await b.evaluate(`document.querySelector('.three-host canvas').focus();shaderProgramAudit.setAction(${JSON.stringify(label+' ongoing shader preparation')})`)
 const at=Date.now();for(let i=0;i<24;i++){
  const key=i%2?'s':'w',code=i%2?'KeyS':'KeyW',v=i%2?83:87
  await b.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:v,timestamp:Date.now()/1000});await pause(120)
  await b.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:v,timestamp:Date.now()/1000});await pause(380)
 }
 report.steps.push({action:'12-second cached-target camera/input burst during '+label+' preparation',at,finishedAt:Date.now(),state:await b.evaluate(current)})
}
async function verifyHouse(name,revision){await b.wait(`JSON.stringify(bootProps('ThreeDView')?.floors.map(f=>f.id))===${JSON.stringify(JSON.stringify(expected[name]))}&&bootProps('ThreeDView').lightingResetRevision>=${revision}`,15000)}
async function load(name){const before=await b.evaluate(`bootProps('ThreeDView').lightingResetRevision`);await click('[aria-label="Project menu"]');await click('button','Load');await b.wait('!!window.bootFile',3000);const object=await b.call('Runtime.evaluate',{expression:'bootFile',returnByValue:false});await b.evaluate('window.bootFile=undefined');const at=await b.evaluate('performance.now()');await b.call('DOM.setFileInputFiles',{objectId:object.result.objectId,files:[`${process.cwd()}/${name}`]});await verifyHouse(name,before+1);await navigate(name);const step={action:'load '+name,at,state:await b.evaluate(current),samples:[]};report.steps.push(step);const until=Date.now()+45000;while(Date.now()<until){const s=await b.evaluate(current);step.samples.push(s);if(!s.covered&&s.sceneProject===before+1){step.visible=s;break}await pause(300)}assert.ok(step.visible,'Current loaded house must clear the 3D cover');await shot(name.replace('.json',''))}
try{
  await b.call('Tracing.start',{traceConfig:{recordMode:'recordContinuously',traceBufferSizeInKb:8192,includedCategories:['devtools.timeline','blink.user_timing','toplevel']},transferMode:'ReturnAsStream'})
  await b.call('Profiler.enable');await b.call('Profiler.setSamplingInterval',{interval:1000});await b.call('Profiler.start')
  await b.call('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false});await b.call('Page.setInterceptFileChooserDialog',{enabled:true})
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.bootLongTasks=[];window.bootMoments={};window.bootInputs=[];window.bootFrames=[];const frame=()=>{if(bootFrames.length<5000){bootFrames.push(performance.now());requestAnimationFrame(frame)}};requestAnimationFrame(frame);document.addEventListener('keydown',e=>{const row={at:performance.now(),age:performance.now()-e.timeStamp};bootInputs.push(row);requestAnimationFrame(()=>row.nextRaf=performance.now())},true);new PerformanceObserver(list=>bootLongTasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask'});
    const probe=()=>{const busy=[...document.querySelectorAll('[role="status"]')].some(e=>e.textContent.includes('default design')),ui=document.querySelector('[aria-label="Project menu"]');if(busy&&!bootMoments.loadingUI)bootMoments.loadingUI=performance.now();if(ui&&!bootMoments.editorUI)bootMoments.editorUI=performance.now();if(!ui)requestAnimationFrame(probe)};requestAnimationFrame(probe);
    window.bootProps=name=>{const host=document.getElementById('root'),key=host&&Object.keys(host).find(k=>k.startsWith('__reactContainer$'));if(!key)return;let found;const visit=f=>{if(!f)return;if((f.type?.name??f.type?.type?.name)===name)found=f.memoizedProps;visit(f.child);visit(f.sibling)};visit(host[key].stateNode.current);return found};
    window.confirm=m=>!m.startsWith('Save changes');window.showOpenFilePicker=undefined;const click=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file')window.bootFile=this;return click.call(this)};
    window.bootstrapRequests=0;const nativeFetch=fetch;window.fetch=async(input,init)=>{const url=String(typeof input==='string'||input instanceof URL?input:input.url);if(!url.includes('colin_house_v2'))return nativeFetch(input,init);bootstrapRequests++;
      ${mode==='failure' ? `if(bootstrapRequests===1)return new Response('Injected unavailable default',{status:503});` : ''}
      ${mode==='cancel' ? `const response=await nativeFetch(input);await new Promise(resolve=>window.releaseBootstrap=resolve);return response;` : 'return nativeFetch(input,init);'}
    };
  `})
  await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/shaderPreparationEditor.html?editorTrace=1`})
  if(mode==='failure'){
    await b.wait(`!!document.querySelector('[role="alert"]')`,15000);report.errorUI=await b.evaluate('document.body.innerText');await shot('failure-ui')
    assert.match(report.errorUI,/503/);assert.equal(await b.evaluate(`!!document.querySelector('[aria-label="Project menu"]')`),false)
    await click('button','Retry default project');await waitUI();await verifyHouse('colin_house_v2.json',0);report.retry=await b.evaluate(current);assert.equal(await b.evaluate('bootstrapRequests'),2)
  }else if(mode==='cancel'){
    await b.wait(`!![...document.querySelectorAll('button')].find(e=>e.textContent==='Start a new project')`,15000);await click('button','Start a new project');await waitUI();report.newBeforeRelease=await b.evaluate(current)
    await b.wait('typeof releaseBootstrap===\'function\'',15000);await b.evaluate('releaseBootstrap()');await pause(800);report.newAfterRelease=await b.evaluate(current)
    assert.equal(report.newBeforeRelease.planWalls,1);assert.deepEqual(report.newAfterRelease.ids,report.newBeforeRelease.ids);assert.match(report.newAfterRelease.caption,/house-design/);await shot('explicit-new-survives-late-default')
  }else{
    await waitUI();await verifyHouse('colin_house_v2.json',0);report.initialState=await b.evaluate(current);await navigate('cold Colin')
    await b.wait(`!!perfScene?.()?.scene.userData.progressiveStartup&&!document.querySelector('.viewport-preparing-overlay')`,30000);report.initialVisible=await b.evaluate(current);await shot('initial-colin')
    if(mode==='controls'){await navigate('Colin enhanced preparation');await navigateBurst();await load('springfield_14.json');await navigateBurst('Springfield')}
  }
  report.raw=await b.evaluate(`({moments:bootMoments,tasks:bootLongTasks,stages:window.editorPreparationEvents,requests:bootstrapRequests,resources:performance.getEntriesByType('resource').map(e=>({name:e.name.slice(0,240),type:e.initiatorType,start:e.startTime,duration:e.duration,encoded:e.encodedBodySize,decoded:e.decodedBodySize,transfer:e.transferSize})),final:(${current})})`)
  report.errors=b.errors
  const unexpected=b.errors.filter(e=>!e.includes('/bb35ad04a6c60479b06147e9ddd58e7e/processed/model.glb'))
  assert.deepEqual(unexpected,[]);console.log('PASS SHADER EDITOR',JSON.stringify({mode,moments:report.raw.moments,initial:report.initialVisible,steps:report.steps.map(({samples,...s})=>s),requests:report.raw.requests}))
}catch(error){report.failure=String(error);report.raw=await b.evaluate(`({moments:bootMoments,tasks:bootLongTasks,stages:window.editorPreparationEvents,final:(${current})})`).catch(()=>({}));console.error(error);process.exitCode=1;await shot('failure').catch(()=>{})}
finally{
 report.inputAcknowledgements=await b.evaluate('bootInputs').catch(()=>[]);report.mainFrames=await b.evaluate('bootFrames').catch(()=>[]);report.programAudit=await b.evaluate('shaderProgramAudit.snapshot()').catch(error=>({error:String(error)}))
 const profile=await b.call('Profiler.stop').catch(()=>({}));if(profile.profile)writeFileSync(`${out}/cpu.cpuprofile`,JSON.stringify(profile.profile))
 await b.call('Tracing.end').catch(()=>{});const result=await Promise.race([trace,pause(10000)])
 if(result?.stream){let data='';for(;;){const c=await b.call('IO.read',{handle:result.stream});data+=c.data;if(c.eof)break}writeFileSync(`${out}/trace.json`,data);await b.call('IO.close',{handle:result.stream})}
 writeFileSync(`${out}/report.json`,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2));b.close()
}
