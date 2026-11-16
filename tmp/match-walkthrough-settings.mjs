import {readFileSync} from 'node:fs'
// This is the isolated regression browser started by this task, not the user's browser.
const [port,path]=readFileSync('node_modules/.cache/browser-test-profiles/lighting-audit-zWqe5D/DevToolsActivePort','utf8').trim().split(/\r?\n/)
const ws=new WebSocket(`ws://127.0.0.1:${port}${path}`)
await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}))
let id=0;const pending=new Map()
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}})
const call=(method,params={},sessionId)=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params,sessionId}))})
try{
 const targets=await call('Target.getTargets'),target=targets.result.targetInfos.find(t=>t.url.includes('5188/tests/browser/editorRegression.html'))
 if(!target)throw Error('Regression tab not found')
 const session=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).result.sessionId
 const result=await call('Runtime.evaluate',{expression:`(()=>{const original=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(/^Fade obstructing (walls|roofs)$/.test(this.closest('label')?.textContent.trim()??''))return;return original.call(this)};return {stage:perfScene().scene.userData.viewportPreparation,fadeClicksBlocked:true}})()`,returnByValue:true},session)
 console.log(JSON.stringify(result))
}finally{ws.close()}
