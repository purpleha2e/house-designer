import {readFileSync,writeFileSync} from 'node:fs'
const out='tmp/renderer-phase4'
const telemetry=readFileSync(`${out}/telemetry.jsonl`,'utf8').trim().split(/\r?\n/).map(JSON.parse)
const report=JSON.parse(readFileSync(`${out}/${process.argv[2]??'baseline'}.json`,'utf8'))
const stats=a=>a.length?{n:a.length,min:Math.min(...a),max:Math.max(...a),mean:a.reduce((n,v)=>n+v,0)/a.length}:null
const windows=report.runs.flatMap(r=>Object.entries(r.samples).map(([movement,s])=>{
 const end=Date.parse(s.wallClockEnd),start=end-s.durationMs-100
 const rows=telemetry.filter(t=>Date.parse(t.utc)>=start&&Date.parse(t.utc)<=end)
 const paths=new Set(rows.flatMap(t=>(t.counters??[]).map(c=>c.Path)))
 const cores=[]
 for(let i=1;i<rows.length;i++){
  const a=rows[i-1],z=rows[i],before=new Map(a.chrome.map(p=>[p.Id,p.CPU]))
  const dt=(Date.parse(z.utc)-Date.parse(a.utc))/1000
  cores.push(z.chrome.reduce((n,p)=>n+(before.has(p.Id)?Math.max(0,p.CPU-before.get(p.Id)):0),0)/dt)
 }
 return{label:r.label,movement,fps:s.presentedFPS,cpu:s.cpuFrameMs.mean,gpu:s.gpuFrameMs.mean,
  heapStart:s.before.heap,heapEnd:s.after.heap,longTasks:s.longTasks.length,longTaskMs:s.longTasks.reduce((n,t)=>n+t.duration,0),
  start:new Date(start).toISOString(),end:s.wallClockEnd,telemetrySamples:rows.length,invalidSamples:rows.filter(t=>t.error).length,
  chromeCPUCores:stats(cores),counters:[...paths].map(path=>({path,...stats(rows.flatMap(t=>(t.counters??[]).filter(c=>c.Path===path).map(c=>c.CookedValue)))}))}
}))
writeFileSync(`${out}/${process.argv[2]??'baseline'}-drift.json`,JSON.stringify({
 warning:'Wall-clock boundaries are approximate (100 ms post-window drain plus synchronous snapshot). Chrome CPU includes all Chrome processes, not only the audit. Frequency is the OS counter, not a per-core effective-clock measurement.',windows},null,2))
console.log(JSON.stringify(windows.map(w=>({label:w.label,movement:w.movement,fps:w.fps,cpu:w.cpu,
 frequency:w.counters.find(c=>c.path.endsWith('processor frequency'))?.mean,
 performance:w.counters.find(c=>c.path.endsWith('% processor performance'))?.mean,
 chromeCPUCores:w.chromeCPUCores?.mean,longTasks:w.longTasks})),null,2))
