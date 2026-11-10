import {readdirSync,readFileSync,statSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
// Only inspect this investigation's isolated benchmark Chrome profile.
const root=resolve('node_modules/.cache/browser-test-profiles')
const profile=readdirSync(root).filter(p=>p.startsWith('lighting-audit-')&&existsSync(join(root,p,'DevToolsActivePort'))).sort((a,b)=>statSync(join(root,b)).birthtimeMs-statSync(join(root,a)).birthtimeMs)[0]
if(!profile)throw Error('No isolated lighting benchmark browser')
const [port,path]=readFileSync(join(root,profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/)
const ws=new WebSocket(`ws://127.0.0.1:${port}${path}`);await new Promise(r=>ws.addEventListener('open',r,{once:true}))
let id=0;const pending=new Map()
ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}})
const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params,sessionId}))})
try{const {targetInfos}=await send('Target.getTargets'),target=targetInfos.find(t=>t.url.includes('roofWallRegression.html'));if(!target)throw Error('No test page')
const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})
const result=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const s=window.roofWallScene?.();return {url:location.href,gi:s?.scene.userData.indirectLighting,startup:s?.scene.userData.progressiveStartup,performance:s?.scene.userData.getLightingPerformance?.()}})()`},sessionId)
console.log(JSON.stringify(result.result?.value??result,null,2))
}finally{ws.close()}
