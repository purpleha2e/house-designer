// One owned, normally paced browser. No synthetic busy loop or GPU stress run.
// node tests/browser/rendererIsolation.mjs [main|worker] [label] [port] [--inspect]
import { lightingBrowser } from './lightingHarness.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import assert from 'node:assert/strict'
const [mode='worker',label='first',port='5210']=process.argv.slice(2)
const out=`tmp/shader-preparation/${label}-${mode}`;mkdirSync(out,{recursive:true})
const pause=ms=>new Promise(r=>setTimeout(r,ms)),report={mode,label,captures:[],inputPackets:[],inputMethod:'Targets cached before preparation; no DOM-query protocol round trip before injected input'}
const points=new Map();let dragPosition=0
let traceComplete;const trace=new Promise(r=>{traceComplete=r})
const b=await lightingBrowser({onEvent:m=>{if(m.method==='Tracing.tracingComplete')traceComplete(m.params)}})
async function click(selector){let p=points.get(selector);if(!p){p=await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);points.set(selector,p)}await pointer(p,'mousePressed');await pointer(p,'mouseReleased')}
async function pointer(p,type,buttons=type==='mouseReleased'?0:1){const at=Date.now();report.inputPackets.push({at,type,...p});await b.call('Input.dispatchMouseEvent',{type,button:'left',buttons,clickCount:1,timestamp:at/1000,...p})}
async function shot(name){
  const rect=await b.evaluate(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.x+1,y:r.y+1,width:840,height:480,scale:1}})()`),startedAt=Date.now()
  const result=await b.call('Page.captureScreenshot',{format:'png',clip:rect}),at=Date.now(),png=Buffer.from(result.data,'base64')
  const {data,info}=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});let sequence=0
  for(let bit=0;bit<12;bit++){const i=((info.height-4)*info.width+bit*8+4)*info.channels;if(data[i]>200&&data[i+1]>200&&data[i+2]>200)sequence|=1<<bit}
  report.captures.push({name,startedAt,at,sequence});writeFileSync(`${out}/${name}.png`,png);return sequence
}
try{
  await b.call('Emulation.setDeviceMetricsOverride',{width:1180,height:850,deviceScaleFactor:1,mobile:false})
  if(process.argv.includes('--unsupported'))await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`HTMLCanvasElement.prototype.transferControlToOffscreen=undefined`})
  await b.call('Tracing.start',{traceConfig:{recordMode:'recordContinuously',traceBufferSizeInKb:8192,includedCategories:['devtools.timeline','blink.user_timing','toplevel']},transferMode:'ReturnAsStream'})
  await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/shaderPreparation.html?mode=${mode}`})
  await b.wait('!!window.isolation&&isolation.events.some(e=>e.type===\'first-geometry\'||e.type===\'error\')',30000)
  report.initial=await b.evaluate('isolation.snapshot()');report.support=report.initial.events.find(e=>e.type==='support')
  assert.ok(report.support,'Renderer support response is required')
  assert.equal(report.support.worker,mode==='worker'&&!process.argv.includes('--unsupported'),'No silent fallback can count as worker evidence')
  if(process.argv.includes('--unsupported'))assert.equal(report.initial.mode,'main-fallback')
  console.log('SUPPORT',JSON.stringify(report.support))
  await shot('basic')
  if(!process.argv.includes('--inspect')){
    const targets=await b.evaluate(`Object.fromEntries(['#ack','#prepare','#left','#right','#replace','#cancel','#shutdown','#drag-track'].map(key=>{const r=document.querySelector(key).getBoundingClientRect();return[key,{x:r.x+r.width/2,y:r.y+r.height/2,left:r.x}]}))`)
    for(const [key,value]of Object.entries(targets))points.set(key,value)
    report.prepareAt=Date.now();await click('#prepare')
    const end=Date.now()+12000;let n=0
    while(Date.now()<end){
      await click('#ack');await click(n%2?'#left':'#right')
      if(n%3===0){const track=points.get('#drag-track'),p={x:track.left+dragPosition+14,y:track.y};await pointer(p,'mousePressed');dragPosition=Math.max(0,Math.min(212,dragPosition+(n%2?-50:50)));const next={x:track.left+dragPosition+14,y:track.y};await pointer(next,'mouseMoved');await pointer(next,'mouseReleased')}
      if(n%5===0&&!process.argv.includes('--no-capture-during'))await shot(`preparing-${n}`)
      n++;await pause(180)
    }
    const snapshot=await b.evaluate('isolation.snapshot()')
    if(!snapshot.events.some(e=>e.type==='ready'||e.type==='error')){try{await b.wait('isolation.events.some(e=>e.type===\'ready\'||e.type===\'error\')',15000)}catch{report.incomplete=true}}
    report.prepared=await b.evaluate('isolation.snapshot()')
    const errors=report.prepared.events.filter(e=>e.type==='error');assert.deepEqual(errors,[])
    if(!report.incomplete){
      const id=await b.evaluate('isolation.camera(0)')
      await b.wait(`isolation.events.some(e=>e.type==='camera-gpu-complete'&&e.id===${id})`,10000)
      assert.equal(await shot('matched-camera'),id,'Compositor screenshot contains the requested camera sequence')
      await b.evaluate('isolation.action("snapshot")');await b.wait('isolation.events.some(e=>e.type===\'snapshot\')',5000)
      report.renderer=await b.evaluate(`isolation.events.filter(e=>e.type==='snapshot').at(-1).report`)
      // Exercise generation rejection and cooperative cancellation after the matched view.
      await click('#replace');await b.wait('isolation.events.some(e=>e.type===\'replaced\'&&e.generation===2)',5000)
      await b.evaluate('isolation.obsolete()');await b.wait('isolation.events.some(e=>e.type===\'rejected\')',5000)
      await click('#prepare');await click('#cancel');await b.wait('isolation.events.some(e=>e.type===\'job-settled\'&&e.generation===2&&e.activeJobs===0)',10000)
    }
  }
  await click('#shutdown');await b.wait('isolation.events.some(e=>e.type===\'disposed\')',10000)
  report.final=await b.evaluate('isolation.snapshot()');report.programAudit=await b.evaluate('shaderProgramAudit.snapshot()');const replay=await b.evaluate('shaderProgramAudit.replay()');if(replay)writeFileSync(`${out}/replay.json`,JSON.stringify(replay));await b.evaluate('isolation.stopMetrics()')
  assert.deepEqual(b.errors,[])
  console.log('COMPLETE',JSON.stringify({mode,ready:!!report.renderer,incomplete:report.incomplete,buttonCount:report.final.buttonCount,disposed:report.final.events.find(e=>e.type==='disposed')?.report?.resources}))
}catch(error){report.failure=String(error);console.error(error);process.exitCode=1;try{report.final=await b.evaluate('window.isolation?.snapshot()');await shot('failure')}catch{}}
finally{
  await b.call('Tracing.end').catch(()=>{});const result=await Promise.race([trace,pause(10000)])
  if(result?.stream){let data='';for(;;){const c=await b.call('IO.read',{handle:result.stream});data+=c.data;if(c.eof)break}writeFileSync(`${out}/trace.json`,data);await b.call('IO.close',{handle:result.stream})}
  writeFileSync(`${out}/report.json`,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2));b.close()
}
