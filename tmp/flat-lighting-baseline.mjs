import {lightingBrowser} from '../tests/browser/lightingHarness.mjs'
import {mkdirSync,writeFileSync} from 'node:fs'
const b=await lightingBrowser(),out='tmp/flat-lighting'
mkdirSync(out,{recursive:true})
try{
 for(const order of [1,2]){
  await b.call('Page.navigate',{url:`http://127.0.0.1:5188/tests/browser/probeDaylightReference.html?probe&lightingDiagnostics&giSH=${order}`})
  await b.wait('!!window.probeDaylight&&!!window.houseDesignerLighting')
  console.log('Running',order)
  const r=await b.evaluate(`(async()=>{const m=await import('/tests/browser/lightingCorrectnessRooms.ts');return m.runCorrectnessRoom('sunlight')})()`)
  writeFileSync(`${out}/baseline-l${order}.json`,JSON.stringify(r,null,2))
  console.log(JSON.stringify(r.reference.results.map(p=>({name:p.name,production:p.productionIrradiance,reference:p.reference}))))
  writeFileSync(`${out}/baseline-l${order}.png`,Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
 }
 console.log('errors',b.errors)
}finally{b.close()}
