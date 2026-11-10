import test from 'node:test'
import assert from 'node:assert/strict'
import {profileRuntime,waitForSlow,summarizeProfile,downloadProfile} from '../public/diagnostics/viewportProfile.js'

async function environment(run) {
  const keys=['document','window','requestAnimationFrame','cancelAnimationFrame']
  const saved=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
  Object.assign(globalThis,{document:{hidden:false,hasFocus:()=>true},window:{},
    requestAnimationFrame:callback=>setTimeout(()=>callback(performance.now()),4),cancelAnimationFrame:clearTimeout})
  try { await run() }
  finally {for(const key of keys){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else Reflect.deleteProperty(globalThis,key)}}
}

function fixture({gpu=false,ready=true}={}) {
  const queries=new Set(),state={draws:0,created:0,deleted:0,begin:0,end:0}
  const extension={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2}
  const gl={RENDERER:3,CURRENT_QUERY:4,QUERY_RESULT_AVAILABLE:5,QUERY_RESULT:6,
    getExtension:name=>name==='EXT_disjoint_timer_query_webgl2'&&gpu?extension:null,
    getParameter:key=>key===2?false:'test graphics device',isContextLost:()=>false,getQuery:()=>null,
    createQuery(){const q={};queries.add(q);state.created++;return q},
    beginQuery(){state.begin++},endQuery(){state.end++},
    getQueryParameter(q,key){return key===5?ready:2e6},deleteQuery(q){queries.delete(q);state.deleted++},
    drawElements(){state.draws++;return 'drawn'},bufferData(){return 'uploaded'},bufferSubData(){},getUniformLocation(){},
  }
  const pass={name:'RenderPass',render(){return gl.drawElements()}}
  const composer={passes:[pass],render(){return pass.render()}}
  const renderer={getContext:()=>gl,domElement:{width:800,height:600},info:{memory:{textures:5,geometries:10},programs:[{}]}}
  const scene={userData:{shaderWarmupPending:false,indirectLighting:{state:'ready',generation:1}}}
  return {scene,composer,renderer,gl,pass,state,queries}
}

test('profiling never submits its own draw and restores the existing renderer methods', async()=>environment(async()=>{
  const f=fixture(),draw=f.gl.drawElements,render=f.pass.render,composition=f.composer.render,lighting=f.scene.userData.indirectLighting
  const report=await profileRuntime(f,{durationMs:30,sampleMs:10})
  assert.equal(f.state.draws,0)
  assert.equal(f.gl.drawElements,draw);assert.equal(f.pass.render,render);assert.equal(f.composer.render,composition)
  assert.equal(f.scene.userData.indirectLighting,lighting)
  assert.equal(report.graphics,'test graphics device')
  assert.equal(report.samples.reduce((n,s)=>n+s.displayFrames,0),0)
}))

test('existing draws are observed with nonblocking GPU samples and queries are released', async()=>environment(async()=>{
  const f=fixture({gpu:true}),draw=f.gl.drawElements,render=f.pass.render
  let existing=0
  const timer=setInterval(()=>{existing++;assert.equal(f.composer.render(),'drawn')},3)
  let report
  try {report=await profileRuntime(f,{durationMs:60,sampleMs:15})}finally{clearInterval(timer)}
  assert.ok(existing>0);assert.equal(f.state.draws,existing)
  assert.equal(report.samples.reduce((n,s)=>n+s.displayFrames,0),existing)
  assert.ok(report.gpu.length>0);assert.ok(report.gpu.every(row=>row.ms===2))
  assert.equal(f.state.begin,f.state.end);assert.equal(f.state.created,f.state.deleted);assert.equal(f.queries.size,0)
  assert.equal(f.gl.drawElements,draw);assert.equal(f.pass.render,render)
}))

test('a partial instrumentation failure restores earlier wrappers without submitting work', async()=>environment(async()=>{
  const f=fixture(),draw=f.gl.drawElements,buffer=f.gl.bufferData
  Object.defineProperty(f.gl,'bufferSubData',{value:()=>{},writable:false})
  await assert.rejects(profileRuntime(f,{durationMs:30}),TypeError)
  assert.equal(f.gl.drawElements,draw);assert.equal(f.gl.bufferData,buffer);assert.equal(f.state.draws,0)
}))

test('unfinished GPU query results are never read synchronously and all allocations are released', async()=>environment(async()=>{
  const f=fixture({gpu:true,ready:false}),original=f.gl.getQueryParameter
  f.gl.getQueryParameter=(query,key)=>{assert.notEqual(key,f.gl.QUERY_RESULT);return original(query,key)}
  const timer=setInterval(()=>f.composer.render(),3)
  let report
  try {report=await profileRuntime(f,{durationMs:30,sampleMs:10})}finally{clearInterval(timer)}
  assert.equal(report.gpu.length,0);assert.ok(f.state.created>0);assert.equal(f.state.created,f.state.deleted)
  assert.equal(f.queries.size,0)
}))

test('CPU callback, matrix and dispatch hooks restore the exact existing functions', async()=>environment(async()=>{
  const f=fixture({gpu:true}),ref={current:()=>f.composer.render()}
  const callback=ref.current,matrix=()=>{},dispatch=()=>{}
  f.scene.updateMatrixWorld=matrix
  f.scene.__r3f={root:{getState:()=>({internal:{subscribers:[{ref,priority:1}]}})}}
  f.renderer.renderBufferDirect=dispatch
  const timer=setInterval(()=>{ref.current();f.scene.updateMatrixWorld();f.renderer.renderBufferDirect()},3)
  let report
  try{report=await profileRuntime(f,{durationMs:40,sampleMs:10,gpuTimers:false})}finally{clearInterval(timer)}
  assert.equal(f.state.created,0,'GPU timing can be disabled without starting a query')
  assert.ok(report.samples.some(s=>s.callbacks[0].calls>0&&s.matrices[0].calls>0&&s.dispatch.sampledCalls>0))
  assert.equal(ref.current,callback);assert.equal(f.scene.updateMatrixWorld,matrix);assert.equal(f.renderer.renderBufferDirect,dispatch)
}))

test('slow capture waits for focus and ignores hidden intervals before triggering', async()=>environment(async()=>{
  const f=fixture(),render=f.composer.render,status=[]
  let focused=false
  document.hasFocus=()=>focused
  const waiting=waitForSlow(f,{windowMs:12,slowWindows:2,maxWaitMs:300,onStatus:text=>status.push(text)})
  await new Promise(resolve=>setTimeout(resolve,35))
  assert.ok(status.some(s=>s.startsWith('Waiting:')))
  assert.equal(status.some(s=>s.startsWith('Watching:')),false)
  focused=true;document.hidden=true
  await new Promise(resolve=>setTimeout(resolve,35))
  assert.equal(status.some(s=>s.startsWith('Watching:')),false)
  document.hidden=false
  const result=await waiting
  assert.equal(result.fps,0);assert.equal(f.composer.render,render);assert.equal(f.state.draws,0)
}))

test('slow watcher times out and restores its hook when the view never receives focus', async()=>environment(async()=>{
  const f=fixture(),render=f.composer.render
  document.hasFocus=()=>false
  await assert.rejects(waitForSlow(f,{maxWaitMs:25}),/No sustained foreground slowdown/)
  assert.equal(f.composer.render,render);assert.equal(f.state.created,0);assert.equal(f.state.draws,0)
}))

test('watcher visibility listener resets a hidden gap even if no RAF ran while hidden', async()=>environment(async()=>{
  const f=fixture(),listeners=new Map()
  document.addEventListener=(type,callback)=>listeners.set(type,callback)
  document.removeEventListener=(type,callback)=>{if(listeners.get(type)===callback)listeners.delete(type)}
  let frame
  globalThis.requestAnimationFrame=callback=>{frame=callback;return 1}
  globalThis.cancelAnimationFrame=()=>{}
  const waiting=waitForSlow(f,{windowMs:1000,slowWindows:2,maxWaitMs:200})
  frame(0);frame(1000)
  listeners.get('visibilitychange')()
  frame(600000);frame(601000)
  assert.equal(listeners.size,1,'background time must not complete the two slow windows')
  frame(602000)
  await waiting
  assert.equal(listeners.size,0)
}))

test('a large raw profile becomes a bounded summary without losing pass costs or FPS',()=>{
  const profile={graphics:'GPU',samples:Array.from({length:100},(_,i)=>({at:(i+1)*1000,elapsedMs:1000,
    displayFrames:20,callbackFrames:20,focused:true,hidden:false,lighting:{state:'ready'},
    passes:[{name:'RenderPass',calls:20,cpuMs:600}],
    callbacks:Array.from({length:1000},(_,index)=>({index,calls:20,cpuMs:index,source:'x'.repeat(180)}))})),
    gpu:[{pass:'RenderPass',ms:30}],errors:['error'.repeat(10000)]}
  const raw=JSON.stringify(profile),summary=summarizeProfile(raw),result=JSON.parse(summary)
  assert.ok(raw.length>1e7);assert.ok(summary.length<=5000)
  assert.equal(result.displayFps,20);assert.equal(result.cpuPasses[0].msPerFrame,30)
  assert.equal(result.gpuPasses[0].meanMs,30);assert.ok(result.cpuCallbacks.length<=5)
  assert.ok(result.timeline.length<=12);assert.equal(result.errors[0].length,100)
  assert.equal(profile.samples.length,100,'summarizing preserves the original capture')
})

test('file recovery downloads the existing capture without starting any profiling',async()=>environment(async()=>{
  let clicked=0,removed=0,appended=0,link
  document.createElement=()=>link={click(){clicked++},remove(){removed++}}
  document.body={append(){appended++}}
  window.extaplanProfile=JSON.stringify({samples:[],marker:'original capture'})
  const message=await downloadProfile()
  assert.match(message,/Downloaded extaplan-viewport-profile.json/)
  assert.equal(clicked,1);assert.equal(removed,1);assert.equal(appended,1)
  assert.equal(link.download,'extaplan-viewport-profile.json')
  assert.equal(await (await fetch(link.href)).text(),window.extaplanProfile)
  window.extaplanProfile=undefined
  await assert.rejects(downloadProfile(),/No completed profile remains/)
  assert.equal(clicked,1,'missing data must not initiate a capture or another download')
}))
