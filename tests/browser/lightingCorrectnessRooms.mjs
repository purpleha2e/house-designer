import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'

const b=await lightingBrowser(),port=process.argv[2]??5180,out=process.argv[3]??'docs/lighting-correctness/reference-rooms',results=[]
mkdirSync(out,{recursive:true})
try{
  for(const kind of ['sealed','window','two-rooms','furniture','sunlight']){
    await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/probeDaylightReference.html?probe`});await b.wait('!!window.probeDaylight')
    console.log('ROOM',kind)
    const r=await b.evaluate(`(async()=>{const m=await import('/tests/browser/lightingCorrectnessRooms.ts');return m.runCorrectnessRoom('${kind}')})()`)
    assert.equal(r.glError,0);assert.equal(r.controls.fill,0);assert.equal(r.controls.gain,1)
    if(kind==='sealed')assert.ok(r.reference.results.every(p=>p.productionIrradiance.every(c=>c<1e-5)&&p.reference.sky.every(c=>c===0)&&p.reference.reflected.every(c=>c===0)))
    if(kind==='sunlight'){assert.ok(r.shadowComparison.changedComponents>0);assert.ok(r.shadowComparison.generationUnchanged&&r.shadowComparison.coefficientsUnchanged)}
    results.push(r);writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2))
    const p=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${kind}.png`,Buffer.from(p.data,'base64'))
  }
  assert.deepEqual(b.errors,[]);console.log('PASS six controlled cases (sunlight includes shadows-disabled repeat), six passes, fill=0, gain=1')
}finally{b.close()}
