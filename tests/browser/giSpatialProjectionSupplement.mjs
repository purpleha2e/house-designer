// Attaches only to this audit's disposable headless profile; the bulk
// projection is also built into giSpatialHouse.mjs for subsequent runs.
import assert from 'node:assert/strict'
import {readdirSync,existsSync,readFileSync,statSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
const root=resolve('node_modules/.cache/browser-test-profiles'),profiles=readdirSync(root).filter(p=>p.startsWith('lighting-audit-')&&existsSync(join(root,p,'DevToolsActivePort'))).sort((a,b)=>statSync(join(root,b)).birthtimeMs-statSync(join(root,a)).birthtimeMs)
assert.ok(profiles.length)
const [port,path]=readFileSync(join(root,profiles[0],'DevToolsActivePort'),'utf8').trim().split(/\r?\n/),ws=new WebSocket(`ws://127.0.0.1:${port}${path}`)
await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map()
ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}})
const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,sessionId}))})
try{
 const {targetInfos}=await send('Target.getTargets'),target=targetInfos.find(t=>t.url.includes('roofWallRegression.html?colin&materials&kitchen-diagnostics&lightingProfile&saved-gi'))
 assert.ok(target,'target must be this spatial audit house fixture')
 const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})
 const response=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{const started=performance.now();while(true){const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;if(g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&g.fullPassPublications===6&&window.spatialAtlas?.atlas())break;if(performance.now()-started>600000)throw Error('Supplement timed out');await new Promise(r=>setTimeout(r,100))}const m=await import('/tests/browser/giSpatialProjection.ts');return m.captureHouseProjection(roofWallScene(),spatialAtlas.atlas())})()`},sessionId)
 if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails))
 writeFileSync(process.argv[2]??'docs/gi-spatial-accuracy/baseline/house/projection.json',JSON.stringify(response.result.value,null,2));console.log('PASS same-atlas projection',response.result.value.probes.length,'probes',response.result.value.maxCoefficientDifference)
}finally{ws.close()}
