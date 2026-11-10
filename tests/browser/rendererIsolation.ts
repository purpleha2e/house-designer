import { createCameraMailbox, isolationNow, type IsolationCommand, type IsolationEvent } from './rendererIsolationProtocol'
type Runtime = Awaited<ReturnType<typeof import('./rendererIsolationRuntime').createIsolationRenderer>>
const requestedMode=new URLSearchParams(location.search).get('mode')??'worker'
let mode=requestedMode,generation=1,revision=0,worker:Worker|undefined,runtime:Runtime|undefined,shutdown=false,received=0
const canvas=document.querySelector<HTMLCanvasElement>('#view')!,status=document.querySelector<HTMLElement>('#status')!
const events:IsolationEvent[]=[],inputs:Record<string,unknown>[]=[],heartbeats:{at:number;ms:number}[]=[],mainFrames:number[]=[],longTasks:{at:number;ms:number}[]=[],cameraCommands:ReturnType<ReturnType<typeof createCameraMailbox>['update']>[]=[],messageTimes:number[]=[]
let count=0,lastHeartbeat=isolationNow(),heartbeat=0,frameHandle=0,pointerActive=false
const transport=(message:IsolationCommand)=>{if(shutdown&&message.type!=='snapshot')return;if(worker)worker.postMessage(message);else runtime?.command(message)}
const cameraMailbox=createCameraMailbox(command=>transport({type:'camera',generation,revision,command}))
const camera=(angle:number)=>{const command=cameraMailbox.update(angle);cameraCommands.push(command);return command.id}
const action=(type:'prepare'|'cancel'|'replace'|'shutdown'|'snapshot')=>{if(type==='replace'){generation++;cameraMailbox.clear()};if(type!=='snapshot')revision++;transport({type,generation,revision,sentAt:isolationNow()})}
const controls=(disabled:boolean)=>document.querySelectorAll<HTMLButtonElement>('#prepare,#left,#right,#cancel,#replace,#shutdown').forEach(button=>button.disabled=disabled)
controls(true)
const receive=(event:IsolationEvent)=>{
  received++;if(events.length<4000)events.push(event)
  if(event.generation!==generation)return
  if(event.type==='camera-ack'){messageTimes.push(Math.max(0,isolationNow()-Number(event.sentAt)));cameraMailbox.ack(Number(event.id))}
  if(event.type==='first-geometry')controls(false)
  if(event.type==='ready'||event.type==='first-geometry'||event.type==='stage'||event.type==='error'||event.type==='cancelled'||event.type==='disposed')status.textContent=`${mode} / project ${generation} / ${event.type}${event.stage?': '+event.stage:''}${event.error?': '+event.error:''}`
  if(event.type==='disposed'){shutdown=true;worker?.terminate();worker=undefined}
  if(event.type==='error'&&!events.some(e=>e.type==='support')){
    status.textContent+=' — Worker renderer unsupported.';worker?.terminate();worker=undefined
    document.querySelector<HTMLAnchorElement>('#fallback')!.hidden=false;controls(true)
  }
}
const acknowledge=(event:Event,kind:string)=>{
  const at=isolationNow(),row={kind,at,eventAt:performance.timeOrigin+event.timeStamp,handlerMs:at-(performance.timeOrigin+event.timeStamp),nextRafAt:0}
  inputs.push(row);requestAnimationFrame(()=>{row.nextRafAt=isolationNow()})
}
document.querySelector('#ack')!.addEventListener('pointerdown',event=>{acknowledge(event,'button');document.querySelector('#ack')!.textContent=`UI button ${++count}`})
const track=document.querySelector<HTMLElement>('#drag-track')!,drag=document.querySelector<HTMLElement>('#drag')!
drag.addEventListener('pointerdown',event=>{pointerActive=true;drag.setPointerCapture(event.pointerId);acknowledge(event,'drag-start')})
drag.addEventListener('pointermove',event=>{if(!pointerActive)return;const x=Math.max(0,Math.min(212,event.clientX-track.getBoundingClientRect().left-14));drag.style.left=`${x}px`;drag.setAttribute('aria-valuenow',String(x));acknowledge(event,'drag')})
drag.addEventListener('pointerup',()=>{pointerActive=false})
document.querySelector('#prepare')!.addEventListener('click',()=>action('prepare'))
document.querySelector('#cancel')!.addEventListener('click',()=>action('cancel'))
document.querySelector('#replace')!.addEventListener('click',()=>action('replace'))
document.querySelector('#shutdown')!.addEventListener('click',()=>action('shutdown'))
document.querySelector('#left')!.addEventListener('click',()=>camera(-.22))
document.querySelector('#right')!.addEventListener('click',()=>camera(.22))
canvas.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='a')camera(-.22);if(event.key==='ArrowRight'||event.key==='d')camera(.22)})
let originX:number|undefined
canvas.addEventListener('pointerdown',event=>{originX=event.clientX;canvas.setPointerCapture(event.pointerId)})
canvas.addEventListener('pointermove',event=>{if(originX!==undefined&&event.buttons)camera(Math.max(-.4,Math.min(.4,(event.clientX-originX)/400)))})
canvas.addEventListener('pointerup',()=>{originX=undefined})
const timer=setInterval(()=>{const at=isolationNow();if(heartbeats.length<4000)heartbeats.push({at,ms:at-lastHeartbeat});lastHeartbeat=at;document.querySelector('#pulse')!.textContent=`Heartbeat ${++heartbeat}`},20)
const frame=()=>{if(mainFrames.length<4000)mainFrames.push(isolationNow());if(!shutdown)frameHandle=requestAnimationFrame(frame)};frameHandle=requestAnimationFrame(frame)
const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push({at:performance.timeOrigin+e.startTime,ms:e.duration})});observer.observe({type:'longtask'})
Object.assign(window,{isolation:{events,inputs,heartbeats,longTasks,mainFrames,cameraCommands,messageTimes,camera,action,
  snapshot:()=>({requestedMode,mode,generation,revision,buttonCount:count,events,inputs,heartbeats,longTasks,mainFrames,cameraCommands,messageTimes,cameraMailbox:cameraMailbox.state(),received,shutdown}),
  obsolete:()=>transport({type:'camera',generation:generation-1,revision:0,command:{id:4095,angle:1,sentAt:isolationNow()}}),
  stopMetrics:()=>{clearInterval(timer);cancelAnimationFrame(frameHandle);observer.disconnect()},
}})
try{
  if(mode==='worker'&&typeof canvas.transferControlToOffscreen==='function'&&typeof Worker!=='undefined'){
    const offscreen=canvas.transferControlToOffscreen();worker=new Worker(new URL('./rendererIsolation.worker.ts',import.meta.url),{type:'module'});worker.onmessage=({data})=>receive(data);worker.onerror=event=>receive({type:'error',generation,revision,at:isolationNow(),error:event.message})
    worker.postMessage({type:'init',generation,revision,canvas:offscreen,width:840,height:480},[offscreen])
  }else{
    if(mode==='worker'){mode='main-fallback';status.textContent='OffscreenCanvas transfer unavailable; using explicitly labelled main-thread fallback'}
    const {createIsolationRenderer}=await import('./rendererIsolationRuntime');runtime=await createIsolationRenderer(canvas,generation,receive)
  }
  document.querySelector('#mode')!.textContent=`Requested: ${requestedMode}. Active renderer: ${mode}. 840 × 480, 30 Hz cap, one WebGL2 context.`
}catch(error){status.textContent=`Renderer unavailable: ${error}. Reload with ?mode=main for fallback.`;receive({type:'error',generation,revision,at:isolationNow(),error:String(error)})}
addEventListener('beforeunload',()=>{action('shutdown');worker?.terminate();clearInterval(timer);observer.disconnect()})
