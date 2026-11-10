import type { WebGLRenderer } from 'three'

type Timing = { count:number; cpuMs:number; wallMs:number; gpuMs:number; gpuSamples:number; maxCpuMs:number }
export type LightingPerformanceReport = ReturnType<ReturnType<typeof createLightingPerformance>['report']>
/** CPU submission, asynchronous wall waits and GPU execution are deliberately
 * separate. Polls completed timestamp queries only; never calls finish/readPixels. */
export function createLightingPerformance(renderer:WebGLRenderer,now=()=>performance.now()) {
  const context=renderer.getContext() as WebGL2RenderingContext
  const timer=context.getExtension('EXT_disjoint_timer_query_webgl2')
  const timingEnabled=typeof location!=='undefined'&&['lightingProfile','lightingDiagnostics'].some(key=>new URLSearchParams(location.search).has(key))
  let queryCount=0
  let started=now(),finished:number|undefined,version=0,phase='idle',phaseAt=started,label='idle',disposed=false
  let draws=0,triangles=0,lines=0,points=0,textureBytes=0,longTaskMs=0,maxLongTaskMs=0,longTasks=0
  const stages:Record<string,Timing>={},phases:Record<string,number>={}
  const pending:{query:WebGLQuery;stage:string;version:number}[]=[]
  const stage=(key:string)=>stages[key]??=( {count:0,cpuMs:0,wallMs:0,gpuMs:0,gpuSamples:0,maxCpuMs:0} )
  const settlePhase=()=>{const at=now();if(!finished)phases[phase]=(phases[phase]??0)+at-phaseAt;phaseAt=at}
  let observer:PerformanceObserver|undefined
  if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){
    observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.startTime>=started&&(!finished||entry.startTime<finished)){
      longTasks++;longTaskMs+=entry.duration;maxLongTaskMs=Math.max(maxLongTaskMs,entry.duration)
    }})
    observer.observe({type:'longtask'})
  }
  const api={
    get active(){return label!=='idle'&&finished===undefined},
    begin(nextLabel:string){version++;started=phaseAt=now();finished=undefined;label=nextLabel;phase='preparation';draws=triangles=lines=points=textureBytes=longTaskMs=maxLongTaskMs=longTasks=0
      for(const key of Object.keys(stages))delete stages[key];for(const key of Object.keys(phases))delete phases[key]
    },
    phase(next:string){if(next===phase||finished)return;settlePhase();phase=next},
    record(key:string,cpuMs:number,wallMs=0){const row=stage(key);row.count++;row.cpuMs+=cpuMs;row.wallMs+=wallMs;row.maxCpuMs=Math.max(row.maxCpuMs,cpuMs)},
    measure<T>(key:string,action:()=>T,gpu=false):T{
      if(disposed)return action()
      const at=now(),query=gpu&&timingEnabled&&timer&&pending.length===0&&++queryCount%8===0&&!context.getQuery(timer.TIME_ELAPSED_EXT,context.CURRENT_QUERY)?context.createQuery():null
      if(query)context.beginQuery(timer!.TIME_ELAPSED_EXT,query)
      try{return action()}finally{api.record(key,now()-at);if(query){context.endQuery(timer!.TIME_ELAPSED_EXT);pending.push({query,stage:key,version})}}
    },
    async wait<T>(key:string,promise:Promise<T>){const at=now(),id=version;try{return await promise}finally{if(id===version)api.record(key,0,now()-at)}},
    /** Scope render counters to lighting calls, including nested fullscreen passes. */
    renders<T>(key:string,action:()=>T):T{
      const render=renderer.render
      renderer.render=function(...args:Parameters<WebGLRenderer['render']>){
        const before={...renderer.info.render};render.apply(renderer,args);const after=renderer.info.render
        draws+=after.calls-(renderer.info.autoReset?0:before.calls);triangles+=after.triangles-(renderer.info.autoReset?0:before.triangles)
        lines+=after.lines-(renderer.info.autoReset?0:before.lines);points+=after.points-(renderer.info.autoReset?0:before.points)
      }
      try{return api.measure(key,action,true)}finally{renderer.render=render}
    },
    memory(bytes:number){textureBytes=bytes},
    poll(){
      while(pending.length&&context.getQueryParameter(pending[0].query,context.QUERY_RESULT_AVAILABLE)){
        const item=pending.shift()!
        if(item.version===version&&!context.getParameter(timer!.GPU_DISJOINT_EXT)){const row=stage(item.stage);row.gpuMs+=context.getQueryParameter(item.query,context.QUERY_RESULT)/1e6;row.gpuSamples++}
        context.deleteQuery(item.query)
      }
    },
    finish(){if(!finished){settlePhase();finished=now()}},
    report(){api.poll();const totalMs=(finished??now())-started,wall={...phases};if(!finished)wall[phase]=(wall[phase]??0)+now()-phaseAt
      return {label,version,complete:finished!==undefined,totalMs,
        // Exclusive wall phases sum to total. Async spans and CPU/GPU totals can
        // overlap; they must never be added into misleading percentages.
        wallPhases:Object.entries(wall).map(([name,ms])=>({name,ms,percent:totalMs?ms/totalMs*100:0})).sort((a,b)=>b.ms-a.ms),
        stages:Object.entries(stages).map(([name,row])=>({name,...row})),draws,triangles,lines,points,
        textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,programs:renderer.info.programs?.length??0,
        ownedTextureBytes:textureBytes,gpuTimerSupported:!!timer,gpuTimingEnabled:timingEnabled,gpuSamplingStride:8,pendingGpuQueries:pending.length,
        longTasks,longTaskMs,maxLongTaskMs,units:'ms; GPU execution and CPU submission are separate; async waits overlap',
      }
    },
    dispose(){disposed=true;observer?.disconnect();pending.forEach(item=>context.deleteQuery(item.query));pending.length=0},
  }
  return api
}
