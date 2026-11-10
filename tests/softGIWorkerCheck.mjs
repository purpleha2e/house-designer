import fs from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Worker} from 'node:worker_threads'
import assert from 'node:assert/strict'
const out='docs/soft-gi/original',read=(name,C)=>new C(Uint8Array.from(gunzipSync(fs.readFileSync(`${out}/${name}.gz`))).buffer),graph={...JSON.parse(fs.readFileSync(`${out}/graph.json`)),a:read('a',Uint32Array),b:read('b',Uint32Array),d2:read('d2',Float32Array),valid:read('valid',Uint8Array)},original=read('baseline.rgba16f',Uint16Array),expected=read('10cm.rgba16f',Uint16Array),backup=original.slice(),worker=new Worker(new URL('./softGI.worker.mjs',import.meta.url))
const results=[],started=performance.now();let latest=0
try{
 await new Promise((resolve,reject)=>{worker.once('message',m=>m.kind==='ready'?resolve():reject(Error(JSON.stringify(m))));worker.once('error',reject);worker.postMessage({kind:'initialize',graph,original})})
 const initializeMs=performance.now()-started
 const completion=new Promise((resolve,reject)=>{worker.on('message',m=>{if(m.kind==='error')return reject(Error(m.error));results.push({id:m.id,published:m.id===latest,statistics:m.statistics,elapsedMs:performance.now()-started});if(m.id===latest){assert.deepEqual(m.output,expected);resolve()}});worker.once('error',reject)})
 const submit=performance.now();for(const radius of [.05,.2,.1]){latest++;worker.postMessage({kind:'filter',id:latest,radius})}const submissionMs=performance.now()-submit
 await completion;assert.deepEqual(original,backup);assert.deepEqual(results.map(r=>r.published),[false,false,true])
 fs.writeFileSync('docs/soft-gi/worker-check.json',JSON.stringify({initializeMs,submissionMs,results,originalUnchanged:true,latestEqualsOfflineResult:true,note:'Actual worker-thread filtering and generation-gated publication. Obsolete work is discarded at publication, not preempted mid-loop. Production progressive publication remains untouched.'},null,2));console.log({initializeMs,submissionMs,results})
}finally{await worker.terminate()}
