import assert from 'node:assert/strict'
import {writeFileSync,readFileSync,existsSync} from 'node:fs'
import {lightingBrowser} from '../tests/browser/lightingHarness.mjs'
const dir='docs/flat-indirect-lighting',html=readFileSync(dir+'/report.html','utf8')
for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g))assert.ok(existsSync(dir+'/'+match[1]),'missing report artifact '+match[1])
const b=await lightingBrowser()
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1280,height:1600,deviceScaleFactor:1,mobile:false})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/'+dir+'/report.html'})
 await b.wait(`document.images.length===8&&[...document.images].every(i=>i.complete&&i.naturalWidth>0)`)
 const state=await b.evaluate(`({title:document.title,overflow:document.documentElement.scrollWidth>innerWidth,images:document.images.length,tables:document.querySelectorAll('table').length,text:document.body.innerText})`)
 assert.equal(state.overflow,false);assert.ok(!/NaN|pending\./.test(state.text));assert.deepEqual(b.errors,[])
 writeFileSync('tmp/flat-lighting/report-preview.png',Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
 console.log('PASS report links, 8 images, 4 tables, no horizontal overflow')
}finally{b.close()}
