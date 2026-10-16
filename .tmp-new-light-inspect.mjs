import { readdirSync,statSync,readFileSync,writeFileSync } from 'node:fs'
const root='node_modules/.cache/browser-test-profiles/'
const dirs=readdirSync(root).filter(n=>n.startsWith('new-light-')).sort((a,b)=>statSync(root+b).mtimeMs-statSync(root+a).mtimeMs)
const port=readFileSync(root+dirs[0]+'/DevToolsActivePort','utf8').split('\n')[0]
const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()
const target=targets.find(t=>t.url.includes('roofWallRegression'))
const ws=new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}))
ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id===1){console.log(JSON.stringify(r.result?.result?.value??r.result));if(process.argv[3])ws.send(JSON.stringify({id:2,method:'Page.captureScreenshot',params:{format:'png'}}));else ws.close()}if(r.id===2){writeFileSync(process.argv[3],Buffer.from(r.result.data,'base64'));ws.close()}})
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:process.argv[2]?readFileSync(process.argv[2],'utf8'):`(()=>{const s=window.roofWallScene();return {pos:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray(),projection:s.camera.projectionMatrix.elements,scene:s.scene.userData}})()`,returnByValue:true,awaitPromise:true}}))
