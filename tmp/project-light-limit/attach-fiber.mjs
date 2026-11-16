// Apply the same corrected test inspection to the already-running test tab.
const pages=await(await fetch('http://127.0.0.1:53631/json/list')).json()
const page=pages.find(p=>p.type==='page'&&p.url==='http://127.0.0.1:5187/')
if(!page)throw Error('The isolated regression tab was not found')
const ws=new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r=>ws.addEventListener('open',r,{once:true}))
const result=new Promise(r=>ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1)r(m)}))
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{awaitPromise:true,returnByValue:true,expression:`(async()=>{
 const m=await import('/tests/browser/rendererTestModules.ts');window.lightFiber=m.getEditorFiber;
 const previous=window.propsFor;
 window.propsFor=name=>{const existing=previous(name);if(existing)return existing;let found;
  const walk=f=>{if(!f)return;if((f.type?.name??f.type?.type?.name)===name)found=f.memoizedProps;walk(f.child);walk(f.sibling)};
  walk(lightFiber());return found};
 return {lights:propsFor('IndirectLighting')?.localLights?.length,gi:lightScene()?.scene.userData.indirectLighting?.state};
})()`}}))
console.log(JSON.stringify(await result));ws.close()
