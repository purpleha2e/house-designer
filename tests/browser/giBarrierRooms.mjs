import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),results=[]
try{
 for(const kind of ['sealed','window','two-rooms','furniture']){
  await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/probeDaylightReference.html?probe`});await b.wait('!!window.probeDaylight')
  console.log('REFERENCE ROOM',kind)
  const r=await b.evaluate(`(async()=>{const m=await import('/tests/browser/giBarrierRooms.ts');return m.barrierRoom('${kind}')})()`);assert.equal(r.glError,0);assert.equal(r.barrier.readings.glError,0);assert.equal(r.barrier.controls.spatial,'legacy');assert.equal(r.barrier.controls.fill,0);assert.equal(r.barrier.controls.probes,26)
  results.push(r);writeFileSync('docs/gi-barrier-filtering/reference-rooms.json',JSON.stringify(results,null,2))
  const metrics=Object.fromEntries(Object.entries(r.barrier.readings.modes).map(([mode,points])=>{const errors=points.flatMap((p,i)=>p.rgb.map((v,c)=>v-r.points[i].reference.sky[c]-r.points[i].reference.reflected[c]));return[mode,{mae:errors.reduce((s,v)=>s+Math.abs(v),0)/errors.length,rmse:Math.sqrt(errors.reduce((s,v)=>s+v*v,0)/errors.length)}]}))
  console.log('ROOM RESULT',kind,JSON.stringify(metrics))
 }
 assert.deepEqual(b.errors,[])
}finally{b.close()}
