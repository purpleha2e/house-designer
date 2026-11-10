// Retry only real pointer input in the already-owned editor test. No state mutation.
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
const root=resolve('node_modules/.cache/browser-test-profiles')
const profiles=readdirSync(root).filter(n=>/^lighting-audit-[A-Za-z0-9]{6}$/.test(n)).sort((a,b)=>statSync(join(root,b)).mtimeMs-statSync(join(root,a)).mtimeMs)
let endpoint
for(const profile of profiles){try{const [port,path]=readFileSync(join(root,profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(800)})).json();if(targets.some(t=>t.url.startsWith('http://127.0.0.1:5202/?rendererAudit=1&sceneEditTrace=1'))){endpoint=`ws://127.0.0.1:${port}${path}`;break}}catch{}}
if(!endpoint)throw Error('Owned editor test not found')
const ws=new WebSocket(endpoint);await new Promise(r=>ws.addEventListener('open',r,{once:true}))
let id=0;const pending=new Map()
ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}})
const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});ws.send(JSON.stringify({id:requestId,method,params,sessionId}))})
try{
 const {targetInfos}=await send('Target.getTargets'),target=targetInfos.find(t=>t.url.startsWith('http://127.0.0.1:5202/?rendererAudit=1&sceneEditTrace=1'))
 const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true}),call=(m,p)=>send(m,p,sessionId)
 const evaluate=async expression=>(await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value
 const before=await evaluate(`(async()=>{const p=await editorPlanPoint('3fc467b2-f9bc-4f90-a31a-f04a3b6fe969');return{selected:editorProps('FloorplanCanvas').selectedModelId,point:p,hit:document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,500)}})()`)
 console.log(before)
 if(process.argv[2]!=='inspect'){
  const p=before.point
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:0,x:p.x+50,y:p.y+50})
  for(const event of [{type:'mouseMoved',buttons:0},{type:'mousePressed',button:'left',buttons:1,clickCount:1},{type:'mouseReleased',button:'left',buttons:0,clickCount:1}])await call('Input.dispatchMouseEvent',{...event,x:p.x,y:p.y})
  await new Promise(r=>setTimeout(r,600))
 }
 const after=await evaluate(`({selected:editorProps('FloorplanCanvas').selectedModelId})`)
 const path='tmp/renderer-phase5/ui-selection-retry.json',attempt={before,after,realPointerRetry:process.argv[2]!=='inspect'}
 let previous=[];try{const r=JSON.parse(readFileSync(path));previous=r.attempts??[r]}catch{}
 writeFileSync(path,JSON.stringify({attempts:[...previous,attempt]},null,2));console.log(after)
}finally{ws.close()}
