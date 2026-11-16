import fs from 'node:fs'
const [port]=fs.readFileSync('node_modules/.cache/browser-test-profiles/lighting-audit-H8e1Rz/DevToolsActivePort','utf8').split('\n')
const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json(),target=targets.find(t=>t.url.includes('editorRegression'))
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}))
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1){if(m.result.data)fs.writeFileSync('tmp/lighting-refinement/progressive.png',Buffer.from(m.result.data,'base64'));else console.log(JSON.stringify(m.result));ws.close()}})
ws.send(JSON.stringify(process.argv.includes('--shot')?{id:1,method:'Page.captureScreenshot',params:{format:'png'}}:{id:1,method:'Runtime.evaluate',params:{expression:`({warmup:perfScene().scene.userData.shaderWarmupPending,startup:perfScene().scene.userData.progressiveStartup,overlay:document.querySelector('.viewport-preparing-overlay')?.outerHTML,preview:perfScene().scene.userData.localSunPreview,body:document.body.innerText.slice(-2500)})`,returnByValue:true}}))


