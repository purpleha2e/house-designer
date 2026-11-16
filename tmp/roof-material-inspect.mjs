import { readdirSync, statSync, readFileSync } from 'node:fs'
const root='node_modules/.cache/browser-test-profiles/'
const dir=readdirSync(root).sort((a,b)=>statSync(root+b).mtimeMs-statSync(root+a).mtimeMs)[0]
const port=readFileSync(root+dir+'/DevToolsActivePort','utf8').split('\n')[0].trim()
const tabs=await fetch('http://127.0.0.1:'+port+'/json').then(r=>r.json())
const p=tabs.find(x=>x.url.includes('roofShader'))??tabs.find(x=>x.url.includes(':4173')||x.url.includes(':5181'))
console.log(tabs.map(t=>t.url))
const w=new WebSocket(p.webSocketDebuggerUrl)
if(p.url.includes(':4173')) {
 w.onopen=()=>w.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`({body:document.body.innerText,ready:!!roofState(),stage:!!roofCreateStage(),profiles:roofState()?.scene.userData.shaderWarmupProfile})`,returnByValue:true}}))
} else if(process.argv.includes('--apply')) {
 w.onopen=()=>w.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`(async()=>{const p=materialProps(p=>p?.onSelectSurface&&p.floors),f=p.floors[0];if(!p.selectedSurface)p.onSelectSurface({type:'roof',floorId:f.id,roofId:f.roofs[0].id});await new Promise(r=>setTimeout(r,150));window.applyAt=performance.now();materialDisplayWatch.at=applyAt;materialProps(p=>p?.onApplyMaterial).onApplyMaterial({materialId:materialDisplayWatch.id,textureScale:1,textureRotation:0});return 'applied'})()`,awaitPromise:true,returnByValue:true}}))
} else
w.onopen=()=>w.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`(async()=>{const {getEditorFiber}=await import('/tests/browser/rendererTestModules.ts');const found=[];const visit=f=>{if(!f)return;const p=f.memoizedProps;if(p?.surfaceAssignments||p?.onPendingChange&&p?.warmupKey)found.push({name:f.type?.name,assignments:p.surfaceAssignments,blocked:p.blocked,ready:p.scanReady});visit(f.child);visit(f.sibling)};visit(getEditorFiber());const meshes=[];roofState().scene.traverse(o=>{if(o.userData.houseDesignerRole?.startsWith('roof-')&&o.material)meshes.push({role:o.userData.houseDesignerRole,id:o.userData.roofId,color:o.material.color?.getHexString(),map:!!o.material.map})});return {at:performance.now(),watch:window.materialDisplayWatch,body:document.body.innerText.slice(-700),found,meshes,profiles:roofState().scene.userData.shaderWarmupProfile}})()`,awaitPromise:true,returnByValue:true}}))
w.onmessage=e=>{console.log(JSON.stringify(JSON.parse(e.data).result,null,2));w.close()}
