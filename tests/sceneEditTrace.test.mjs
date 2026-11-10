import assert from 'node:assert/strict'
import test from 'node:test'
import {installSceneEditPreload} from './browser/sceneEditTrace.js'

class WorkerStub extends EventTarget {
 postMessage(){}
 terminate(){}
 reply(data){this.dispatchEvent(new MessageEvent('message',{data}))}
}
function trace(run){
 const previous=globalThis.window
 globalThis.window={Worker:WorkerStub}
 try{installSceneEditPreload({devtools:false});run(window.sceneEditTrace,window.Worker)}
 finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous}
}
test('streamed wall chunks represent one request until its final response',()=>trace((t,Worker)=>{
 const w=new Worker('/src/wallEngine/wallRoofClip.worker.ts')
 w.postMessage({stream:'start',job:{faces:[]}})
 w.postMessage({stream:'faces',field:'faces',faces:[]})
 w.postMessage({stream:'end'})
 assert.equal(t.workers.get(w.traceId).outstanding,1)
 w.reply({stream:'faces',faces:[]})
 w.reply({stream:'renderFaces',faces:[]})
 assert.equal(t.workers.get(w.traceId).outstanding,1)
 w.reply({ok:true,streamedFaces:true})
 assert.equal(t.workers.get(w.traceId).outstanding,0)
}))
test('GI progress and lamp exchange preserve the originating request generation',()=>trace((t,Worker)=>{
 const w=new Worker('/src/indirectLighting.worker.ts')
 t.mark('edit');w.postMessage({kind:'prepare',id:17});t.mark('newer edit')
 w.reply({id:17,progress:{stage:'geometry'}})
 w.reply({id:17,lampQuery:true})
 w.postMessage({id:17,kind:'lampResult'})
 assert.equal(t.workers.get(w.traceId).outstanding,1)
 w.reply({id:17,ok:true,value:{}})
 assert.equal(t.workers.get(w.traceId).outstanding,0)
 const event=t.events.at(-1)
 assert.equal(event.kind,'worker.response')
 assert.equal(event.generation,2)
 assert.equal(event.requestGeneration,1)
}))
test('loader init is one-way and disposal clears an active request',()=>trace((t,Worker)=>{
 const w=new Worker('blob:loader')
 w.postMessage({type:'init'})
 assert.equal(t.workers.get(w.traceId).pending,false)
 w.postMessage({type:'transcode',id:4})
 assert.equal(t.workers.get(w.traceId).pending,true)
 w.terminate()
 assert.equal(t.workers.get(w.traceId).pending,false)
 assert.equal(t.workers.get(w.traceId).outstanding,0)
}))
test('diagnostic history is bounded and preserves monotonic sequence IDs',()=>trace(t=>{
 t.mark('edit')
 for(let i=0;i<2500;i++)t.record('sample',{i})
 assert.equal(t.events.length,2400)
 assert.equal(t.events[0].seq,102)
 assert.equal(t.events.at(-1).seq,2501)
 assert.equal(t.events.at(-1).generation,1)
}))
