import type {RootState} from '@react-three/fiber'
import {getEditorFiber} from './rendererTestModules'
import type {EffectComposer} from 'postprocessing'

export async function measureConfidenceBaselineFrames(s:RootState,count=60){
 let composer:EffectComposer|undefined
 const visit=(f:ReturnType<typeof getEditorFiber>)=>{if(!f)return;if(f.ref?.current?.passes)composer=f.ref.current;visit(f.child);visit(f.sibling)}
 visit(getEditorFiber());if(!composer)throw Error('Missing compositor')
 const cpu:number[]=[],intervals:number[]=[];let previous=0
 for(let i=0;i<count+5;i++){
  const now=await new Promise<number>(requestAnimationFrame)
  const start=performance.now();composer.render(1/60)
  if(i>=5){cpu.push(performance.now()-start);intervals.push(now-previous)}previous=now
 }
 const stats=(a:number[])=>{const b=[...a].sort((a,b)=>a-b);return{median:b[Math.floor(b.length*.5)],p95:b[Math.floor(b.length*.95)],max:b.at(-1)}}
 return{frames:count,cpuSubmissionMs:stats(cpu),animationFrameIntervalMs:stats(intervals),gpuExecutionMeasured:false,renderer:s.gl.info.memory}
}
