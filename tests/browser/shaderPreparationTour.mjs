import { lightingBrowser } from './lightingHarness.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const [label='final',port='5225']=process.argv.slice(2),out=`tmp/shader-preparation/tour-${label}`;mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),report={label},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:760,deviceScaleFactor:1,mobile:false})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/shaderPreparationTour.html?view=walk`})
 await b.wait('!!window.rendererRecovery?.state()',30000)
 const until=Date.now()+30000
 for(;;){const s=await b.evaluate(`(()=>{const s=rendererRecovery.state();return{at:performance.now(),warm:s.scene.userData.shaderWarmupPending,progress:s.scene.userData.viewportPreparation,programs:s.gl.info.programs.length,lost:s.gl.getContext().isContextLost(),camera:s.camera.position.toArray(),cover:!!document.querySelector('.viewport-preparing-overlay')}})()`);report.state=s;if(s.warm===false&&!s.cover)break;if(Date.now()>until){report.incomplete=true;break}await pause(250)}
 const image=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/matched-camera.png`,Buffer.from(image.data,'base64'))
 report.programAudit=await b.evaluate('shaderProgramAudit.snapshot()');report.errors=b.errors
 assert.equal(report.state.lost,false);assert.deepEqual(b.errors,[])
 console.log('TOUR',JSON.stringify({label,incomplete:report.incomplete,state:report.state,programs:report.programAudit.contexts.flatMap(c=>c.rows).length}))
}catch(error){report.failure=String(error);console.error(error);process.exitCode=1}
finally{writeFileSync(`${out}/report.json`,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2));b.close()}
