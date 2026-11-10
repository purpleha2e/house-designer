// Read-only inspection of this audit's isolated browser, useful on failed captures.
import {readdirSync,readFileSync,statSync,existsSync} from 'node:fs'
const root='node_modules/.cache/browser-test-profiles',profiles=readdirSync(root).filter(n=>n.startsWith('lighting-audit-')).map(n=>`${root}/${n}`).filter(p=>existsSync(`${p}/DevToolsActivePort`)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)
for(const profile of profiles){
 let ws
 try{
  const [port,path]=readFileSync(`${profile}/DevToolsActivePort`,'utf8').trim().split(/\r?\n/);ws=new WebSocket(`ws://127.0.0.1:${port}${path}`);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})
  let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}})
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});ws.send(JSON.stringify({id:request,method,params,sessionId}))})
  const targets=await send('Target.getTargets'),target=targets.targetInfos.find(t=>t.url.includes('roofWallRegression.html'));if(!target){ws.close();continue}
  const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})
  const r=await send('Runtime.evaluate',{expression:`(()=>{const s=roofWallScene(),u=s.scene.userData.getIndirectUniforms(),d=s.scene.userData.lightingDiagnostics,packed=d?.components().packed;return {url:location.href,frameloop:s.frameloop,fieldHeight:s.scene.userData.getLightingField().volume.height,uniformHeight:u.hdGIVolumeSize.value.y,packedHeight:packed?.volume.height,packedBound:u.hdGIVolume.value===packed?.volume.maps[0],skyCoefficientNonzero:d?.snapshot().sky?.map(a=>a.filter(v=>v!==0).length)}})()`,returnByValue:true},sessionId)
  console.log(JSON.stringify(r))
  console.log(JSON.stringify(await send('Runtime.evaluate',{expression:`(()=>{const u=roofWallScene().scene.userData;return{startup:u.progressiveStartup,gi:u.indirectLighting,warmup:u.shaderWarmupPending}})()`,returnByValue:true},sessionId)))
  console.log(JSON.stringify(await send('Runtime.evaluate',{expression:`(async()=>{const m=await import('/tests/browser/rendererTestModules.ts');let composer;const visit=f=>{if(!f)return;const v=f.ref?.current;if(v?.passes)composer=v;visit(f.child);visit(f.sibling)};visit(m.getEditorFiber());return composer?.passes.map(p=>({name:p.constructor.name,enabled:p.enabled,configuration:'configuration'in p?Object.fromEntries(Object.entries(p.configuration)):null}))})()`,awaitPromise:true,returnByValue:true},sessionId)))
  ws.close();break
 }catch{ws?.close()}
}
