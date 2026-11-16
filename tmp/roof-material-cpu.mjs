import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
const root='node_modules/.cache/browser-test-profiles/'
const dir=readdirSync(root).sort((a,b)=>statSync(root+b).mtimeMs-statSync(root+a).mtimeMs)[0]
const port=readFileSync(root+dir+'/DevToolsActivePort','utf8').split('\n')[0].trim()
const tabs=await fetch('http://127.0.0.1:'+port+'/json').then(r=>r.json())
const w=new WebSocket(tabs.find(x=>x.url.includes('roofShader')).webSocketDebuggerUrl)
await new Promise(r=>w.onopen=r)
let id=0;const pending=new Map()
w.onmessage=e=>{const p=JSON.parse(e.data);if(p.id){pending.get(p.id)?.(p.result);pending.delete(p.id)}}
const call=(method,params={})=>new Promise(r=>{pending.set(++id,r);w.send(JSON.stringify({id,method,params}))})
await call('Profiler.enable');await call('Profiler.start')
await call('Runtime.evaluate',{expression:`window.roofMaterialTimeline=[];window.roofMaterialLongTasks=[];new PerformanceObserver(list=>roofMaterialLongTasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});window.roofMaterialTimelineTimer=setInterval(()=>{const d=roofState().scene.userData;roofMaterialTimeline.push({at:performance.now(),applyAt:window.applyAt,pending:d.shaderWarmupPending,scan:d.indirectScanPending,reflection:d.indirectReflectionPending,gi:d.indirectLighting&&{state:d.indirectLighting.state,phase:d.indirectLighting.phase},status:document.querySelector('[aria-label="3D engine status"]')?.innerText})},100)`})
await new Promise(r=>setTimeout(r,30000))
const result=await call('Profiler.stop');writeFileSync('tmp/roof-material-cpu.json',JSON.stringify(result))
const timeline=await call('Runtime.evaluate',{expression:'JSON.stringify({timeline:roofMaterialTimeline,longTasks:roofMaterialLongTasks})',returnByValue:true});writeFileSync('tmp/roof-material-timeline.json',timeline.result.value)
w.close()
