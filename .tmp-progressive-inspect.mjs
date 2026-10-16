import { readdirSync, statSync, readFileSync } from 'node:fs'
const root='node_modules/.cache/browser-test-profiles/'
const dirs=readdirSync(root).filter(n=>n.startsWith('basic-scene-')).sort((a,b)=>statSync(root+b).mtimeMs-statSync(root+a).mtimeMs)
const port=readFileSync(root+dirs[0]+'/DevToolsActivePort','utf8').split('\n')[0]
const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()
const target=targets.find(t=>t.url.includes('basicSceneDiagnostic'))
const ws=new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}))
ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id===1){console.log(JSON.stringify(r.result?.result?.value));ws.close()}})
if(process.argv.includes('--reload')) ws.send(JSON.stringify({id:1,method:'Page.reload'}))
else ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`({gpu:(()=>{const gl=window.basicSceneState?.()?.gl.getContext();if(!gl)return null;const x=gl.getExtension('WEBGL_debug_renderer_info');return x?gl.getParameter(x.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)})(),report:window.basicSceneReport,scene:window.basicSceneState?.()?.scene.userData,body:document.body.innerText.slice(0,1000),programs:window.basicSceneState?.()?.gl.info.programs.length})`,returnByValue:true}}))
