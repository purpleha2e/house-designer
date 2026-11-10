import {readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs'
const root='node_modules/.cache/browser-test-profiles'
for(const profile of readdirSync(root).filter(p=>p.startsWith('lighting-audit-')).sort((a,b)=>statSync(`${root}/${b}`).birthtimeMs-statSync(`${root}/${a}`).birthtimeMs)){
 let port,targets
 try{port=readFileSync(`${root}/${profile}/DevToolsActivePort`,'utf8').split('\n')[0];targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()}catch{continue}
 const target=targets.find(t=>t.type==='page'&&t.url.includes('roofWallRegression.html')&&t.url.includes('giContacts=local'));if(!target)continue
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}))
 const result=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Inspection timed out')),30000)
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id!==1)return;clearTimeout(timeout);m.result?.exceptionDetails?reject(Error(JSON.stringify(m.result.exceptionDetails))):resolve(m.result.result.value)})
  ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{returnByValue:true,expression:`(()=>{const s=roofWallScene(),models=[];s.scene.traverse(o=>{if(!o.name.startsWith('model-transform-'))return;const safety=[],meshes=[];o.traverse(c=>{if(c.userData.indirectReceiverSafety)safety.push(c.userData.indirectReceiverSafety);if(c.geometry?.attributes.hdGIReceiverMaxBias)meshes.push({name:c.name,vertices:c.geometry.attributes.position.count,refined:!!c.geometry.attributes.hdGIReceiverLinearNormal})});if(safety.length)models.push({name:o.name,safety,meshes})});return{models,contacts:s.scene.userData.indirectContactReceivers,mode:s.scene.userData.getIndirectUniforms().hdGIContactMode.value}})()`}}))
 })
 ws.close();writeFileSync('docs/colin-contact-fix/live-receivers.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));break
}
