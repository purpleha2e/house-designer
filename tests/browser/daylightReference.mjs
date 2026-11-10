import assert from 'node:assert/strict'
import { mkdirSync,writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'
const browser=await lightingBrowser(),out=process.argv[3]??'tmp/daylight-baseline'
try{
  mkdirSync(out,{recursive:true});await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/daylightReference.html`});await browser.wait('!!window.daylightReference')
  const hardware=await browser.evaluate(`(()=>{const gl=daylightReference.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown',cores:navigator.hardwareConcurrency}})()`),results=[]
  for(const condition of ['away','direct','overcast','sealed']){
    const result=await browser.evaluate(`daylightReference.run('${condition==='sealed'?'away':condition}',${condition==='sealed'})`);results.push(result);console.log(condition,JSON.stringify(result))
    const image=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${condition}.png`,Buffer.from(image.data,'base64'));writeFileSync(`${out}/report.json`,JSON.stringify({hardware,results,errors:browser.errors},null,2))
    assert.equal(result.glError,0)
  }
  assert.deepEqual(browser.errors,[])
}finally{browser.close()}
