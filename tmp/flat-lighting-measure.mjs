import {lightingBrowser} from '../tests/browser/lightingHarness.mjs'
import {mkdirSync,writeFileSync} from 'node:fs'
const b=await lightingBrowser(),label=process.argv[2]??'before',out='tmp/flat-lighting'
mkdirSync(out,{recursive:true})
try{
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/probeDaylightReference.html?probe&lightingDiagnostics'+(label==='local'?'&giSpatial=distance-local':'')})
 await b.wait('!!window.probeDaylight&&!!window.houseDesignerLighting')
 await b.evaluate(`probeDaylight.run('direct',6,false)`)
 const r=await b.evaluate(`(async()=>{const m=await import('/tests/browser/flatIndirectLighting.ts');return m.measureFlatIndirectLighting()})()`)
 writeFileSync(`${out}/${label}.json`,JSON.stringify(r,null,2))
 console.log(JSON.stringify(r.points.map(p=>({name:p.name,first:p.inspection.bounces.firstBrightness,final:p.inspection.bounces.finalBrightness,reference:p.reference.final.sky.map((v,c)=>v+p.reference.final.reflected[c]),displayed:p.inspection.displayed.rgb}))))
 writeFileSync(`${out}/${label}.png`,Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
 console.log('errors',b.errors)
}finally{b.close()}
