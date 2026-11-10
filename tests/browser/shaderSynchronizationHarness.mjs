import { lightingBrowser } from './lightingHarness.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const [kind='cheap',mode='poll',port='5220',label='reference']=process.argv.slice(2),out=`tmp/shader-preparation/raw-${label}-${kind}-${mode}`;mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),report={kind,mode},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function click(point){await b.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,timestamp:Date.now()/1000,...point});await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,timestamp:Date.now()/1000,...point})}
try{
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/shaderSynchronization.html?kind=${kind}&mode=${mode}`});await b.wait('!!window.rawShaderProbe',10000)
 const points=await b.evaluate(`Object.fromEntries(['ack','run'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return[id,{x:r.x+r.width/2,y:r.y+r.height/2}]}))`)
 await click(points.run);for(let i=0;i<12;i++){await click(points.ack);await pause(100)}await b.wait('rawShaderProbe.done',25000)
 report.result=await b.evaluate('rawShaderProbe');assert.equal(report.result.error,undefined);assert.equal(report.result.linkStatus,true);assert.equal(report.result.glError,0);assert.ok(report.result.fragmentSamplerCount<=16)
 const png=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/draw.png`,Buffer.from(png.data,'base64'));await b.evaluate('rawCleanup()');report.contextLost=await b.evaluate('rawShaderProbe.contextLost');assert.equal(report.contextLost,true);assert.deepEqual(b.errors,[])
 console.log('RAW',JSON.stringify({kind,mode,total:report.result.totalMs,calls:report.result.calls.filter(c=>!c.name.startsWith('completion.')),initialCompletion:report.result.initialCompletion,completionBeforeReflection:report.result.completionBeforeReflection}))
}catch(error){report.failure=String(error);console.error(error);process.exitCode=1}
finally{writeFileSync(`${out}/report.json`,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2));b.close()}
