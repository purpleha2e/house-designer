import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),report={}
try{
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/lightingRefinementWorker.html'})
 report.results=await b.evaluate(`(async()=>{
  const {BoxGeometry,PerspectiveCamera}=await import('/tests/browser/rendererTestModules.ts')
  const {LIGHTING_REFINEMENT}=await import('/src/lightingRefinement.ts')
  const geometry=new BoxGeometry(4,4,4).toNonIndexed(),positions=geometry.attributes.position.array,normals=geometry.attributes.normal.array,uvs=geometry.attributes.uv.array
  const camera=new PerspectiveCamera(70,1,.1,100);camera.updateMatrixWorld()
  const material={color:[.6,.6,.6],metalness:0,map:-1,side:2,shadowSide:2,opacity:1,opaquePipeline:true,matrix:[1,0,0,0,1,0,0,0,1],wrapS:1001,wrapT:1001,flatShading:true}
  const lights=Array.from({length:18},(_,i)=>({position:[Math.sin(i)*.7,.5,Math.cos(i)*.7],color:i<6?[1,.8,.6]:[0,0,0],direction:[0,-1,0],distance:10,decay:2,cone:-1,penumbra:-1}))
  const worker=new Worker('/src/localSunPreview.worker.ts',{type:'module'}),results=[]
  const failure=new Promise((_,reject)=>worker.onerror=e=>reject(Error(e.message)))
  try{
   await Promise.race([failure,new Promise((resolve,reject)=>{
    worker.onmessage=e=>e.data.kind==='prepared'?resolve():e.data.kind==='error'?reject(Error(e.data.error)):null
    worker.postMessage({kind:'prepare',data:{positions,normals,uvs,materialIndices:new Uint16Array(12),owners:new Uint32Array(12),materials:[material],textures:[],sunDirection:[0,1,0],sunIrradiance:[0,0,0],daylightGain:1,refinement:{skyBase:[.65,.8,1],skySun:[0,0,0],skyMode:'clear',sunDirection:[0,1,0],sunIrradiance:[0,0,0],lights}}})
   })])
   for(const [index,quality]of ['balanced','high','ultra'].entries()){
    const budget=LIGHTING_REFINEMENT[quality],id=index+1,started=performance.now(),images=[],progress=[]
    const visibleTriangles=new Uint8Array(12);visibleTriangles[10]=1 // missing receivers and off-screen blockers
    const result=await Promise.race([failure,new Promise((resolve,reject)=>{
     worker.onmessage=e=>{const m=e.data;if(m.kind==='error'){reject(Error(m.error));return}if(m.id!==id)return
      if(m.kind==='progress')progress.push({phase:m.phase,percent:m.percent,ms:m.ms})
      if(m.kind==='image'){
       if(!Array.from(m.image).every(Number.isFinite)){reject(Error('Non-finite irradiance'));return}
       images.push({samples:m.rays,ms:m.ms,done:m.done,supported:m.supportedPixels})
       if(m.done)resolve({quality,images,progress,totalMs:performance.now()-started,totalRays:m.totalRays})
      }
     }
     // Exercise every sampling/bounce budget on a bounded image; full-house
     // visual regressions cover the production image dimensions separately.
     worker.postMessage({kind:'render',id,camera:{world:camera.matrixWorld.toArray(),projectionInverse:camera.projectionMatrixInverse.toArray(),width:24,height:24,rays:budget.rays,bounces:budget.bounces,visibleTriangles}})
    })]);results.push(result)
   }
   const id=9;let cancelAt=0,lateImages=0
   await new Promise((resolve,reject)=>{
    worker.onmessage=e=>{const m=e.data;if(m.kind==='error'){reject(Error(m.error));return}if(m.id!==id)return
     if(cancelAt){if(m.kind==='image')lateImages++;return}
     if(m.kind==='image'&&m.coarse){if(m.width!==32||m.done){reject(Error('Invalid quick preview'));return}cancelAt=performance.now();worker.postMessage({kind:'cancel'});setTimeout(resolve,1000)}
    }
    worker.postMessage({kind:'render',id,camera:{world:camera.matrixWorld.toArray(),projectionInverse:camera.projectionMatrixInverse.toArray(),width:128,height:128,rays:128,bounces:8}})
   })
   results.push({cancelled:cancelAt>0,lateImages})
   return results
  }finally{worker.terminate();geometry.dispose()}
 })()`)
 for(const result of report.results.slice(0,3)){
  assert.equal(result.images[0].samples,4);assert.equal(result.images[0].done,false)
  assert.equal(result.images.at(-1).done,true)
  assert.ok(result.images.every(i=>i.supported>0))
  assert.ok(result.progress.some(p=>p.phase.startsWith('Refining')&&p.percent>0))
 }
 assert.deepEqual(report.results.at(-1),{cancelled:true,lateImages:0})
 assert.deepEqual(b.errors,[]);report.passed=true
 console.log(JSON.stringify(report.results.map(r=>({quality:r.quality,images:r.images,totalMs:r.totalMs,cancelled:r.cancelled,lateImages:r.lateImages}))))
}catch(error){report.error=String(error);throw error}finally{mkdirSync('tmp/refinement-worker',{recursive:true});writeFileSync('tmp/refinement-worker/results.json',JSON.stringify(report,null,2));b.close()}
