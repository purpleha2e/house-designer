// Inspect only an isolated viewport test browser owned by this test suite.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const root='node_modules/.cache/browser-test-profiles'
const profile=readdirSync(root).filter(n=>n.startsWith('viewport-response-')).sort((a,b)=>statSync(join(root,b)).mtimeMs-statSync(join(root,a)).mtimeMs)[0]
if(!profile)throw Error('No active viewport test profile')
const [port,path]=readFileSync(join(root,profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/)
const ws=new WebSocket(`ws://127.0.0.1:${port}${path}`),jobs=new Map(),logs=[]
await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}))
let id=0
ws.addEventListener('message',event=>{
  const r=JSON.parse(event.data),job=jobs.get(r.id)
  if(job){jobs.delete(r.id);clearTimeout(job.timer);r.error?job.reject(r.error):job.resolve(r.result)}
  if(r.method==='Log.entryAdded')logs.push(r.params.entry)
})
const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  const request=++id,timer=setTimeout(()=>reject(Error(method+' timed out')),10000)
  jobs.set(request,{resolve,reject,timer});ws.send(JSON.stringify({id:request,method,params,sessionId}))
})
try{
  const {targetInfos}=await send('Target.getTargets')
  const target=targetInfos.find(t=>t.url.includes('/tests/browser/roofWallRegression.html'))
  if(!target)throw Error(JSON.stringify(targetInfos.map(t=>t.url)))
  const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})
  await send('Log.enable',{},sessionId)
  const state=await send('Runtime.evaluate',{expression:`({text:document.body.innerText.slice(0,2500),gi:window.roofWallScene?.()?.scene.userData.indirectLighting,preview:window.responseProfile?.previewDraws,resources:performance.getEntriesByType('resource').filter(e=>e.name.includes('roomEnvironment')).map(e=>({name:e.name,size:e.decodedBodySize}))})`,returnByValue:true},sessionId)
  console.log(JSON.stringify({state:state.result.value,logs},null,2))
}finally{ws.close()}
