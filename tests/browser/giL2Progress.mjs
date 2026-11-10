import fs from 'node:fs'
const root='node_modules/.cache/browser-test-profiles'
for(const name of fs.readdirSync(root).filter(n=>n.startsWith('lighting-audit-'))){
 try{
  const port=fs.readFileSync(`${root}/${name}/DevToolsActivePort`,'utf8').split('\n')[0],targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target=targets.find(t=>t.type==='page'&&t.url.includes('gi-l2-house'));if(!target)continue
  const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}))
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout')),10000);ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1){clearTimeout(timer);resolve(m.result)}});ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{returnByValue:true,expression:`(()=>{const s=window.roofWallScene?.(),u=s?.scene.userData;return{url:location.href,gi:u?.indirectLighting,phase:u?.progressiveStartup,selection:u?.indirectSHExperiment,preparation:u?.viewportPreparation,keys:Object.keys(u??{}),warmup:u?.shaderWarmupProfile,pending:u?.shaderWarmupPending}})()`}}))})
  console.log(JSON.stringify(result));ws.close()
 }catch{}
}
