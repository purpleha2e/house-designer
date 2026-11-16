import { readdirSync, statSync, readFileSync } from 'node:fs'
const root='node_modules/.cache/browser-test-profiles/'
const dir=readdirSync(root).sort((a,b)=>statSync(root+b).mtimeMs-statSync(root+a).mtimeMs)[0]
const port=readFileSync(root+dir+'/DevToolsActivePort','utf8').split('\n')[0].trim()
const tabs=await fetch('http://127.0.0.1:'+port+'/json').then(r=>r.json())
const tab=tabs.find(t=>t.url.includes(':4173'))
const w=new WebSocket(tab.webSocketDebuggerUrl)
w.onopen=()=>w.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`({body:document.body.innerText.slice(-1700),data:(window.lightState?.()??window.roofState?.())?.scene.userData})`,returnByValue:true}}))
w.onmessage=e=>{console.log(JSON.stringify(JSON.parse(e.data).result,null,2));w.close()}
