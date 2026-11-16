import {readFileSync,writeFileSync} from 'node:fs'
const [port,path]=readFileSync('node_modules/.cache/browser-test-profiles/lighting-audit-FFuJi1/DevToolsActivePort','utf8').trim().split('\n')
const ws=new WebSocket(`ws://127.0.0.1:${port}${path}`)
await new Promise(r=>ws.addEventListener('open',r,{once:true}))
let id=0;const pending=new Map()
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id)}})
const call=(method,params={},sessionId)=>new Promise(r=>{pending.set(++id,r);ws.send(JSON.stringify({id,method,params,sessionId}))})
const targets=await call('Target.getTargets');console.log(targets.targetInfos.map(t=>[t.targetId,t.url]))
const t=targets.targetInfos.find(t=>t.url.includes('editorRegression.html')),s=await call('Target.attachToTarget',{targetId:t.targetId,flatten:true})
const expression=process.argv[2]??`({state:perfScene()?.scene.userData.indirectLighting,warm:perfScene()?.scene.userData.shaderWarmupPending,overlay:document.querySelector('.viewport-preparing-overlay')?.textContent,text:document.querySelector('[aria-label="3D engine status"]')?.textContent,spatial:perfScene()?.scene.userData.getLightingField?.().spatialInterpolation,body:document.body.innerText.slice(-3000)})`
console.log(JSON.stringify(await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},s.sessionId),null,2))
ws.close()
