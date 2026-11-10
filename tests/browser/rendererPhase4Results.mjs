import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
const out='tmp/renderer-phase4',read=p=>JSON.parse(readFileSync(`${out}/${p}`,'utf8'))
const final=read('final-benchmark.json')
assert.ok(final.finished);assert.equal(final.failure,undefined)
const rows=final.runs.flatMap(run=>Object.entries(run.samples).map(([movement,s])=>({
 label:run.label,view:run.view,arm:run.label.includes('candidate')?'candidate':'reference',movement,
 durationMs:s.durationMs,fps:s.presentedFPS,p50:s.frameMs.median,p95:s.frameMs.p95,p99:s.frameMs.p99,
 composer:s.cpuFrameMs.mean,main:s.passes.filter(p=>p.name.startsWith('0:')&&p.name.includes('/house/')).reduce((n,p)=>n+p.cpuMsPerFrame,0),
 html:s.callbacks.filter(c=>c.name.includes('updateMatrixWorld()')&&c.name.includes('current.updateWorldMatrix(!0,!1)')).reduce((n,c)=>n+c.cpuMsPerFrame,0),gpu:s.gpuFrameMs.mean,draws:s.passes.reduce((n,p)=>n+p.drawCallsPerFrame,0),
 triangles:s.passes.reduce((n,p)=>n+p.trianglesPerFrame,0),programs:s.after.three.programs,
 textures:s.after.three.textures,geometries:s.after.three.geometries,heapBefore:s.before.heap,heapAfter:s.after.heap,
 longTasks:s.longTasks.length,longTaskMs:s.longTasks.reduce((n,t)=>n+t.duration,0),
 newPrograms:s.newPrograms,newWorkers:s.newWorkerMessages,newTextures:s.newTextureUploads,newBuffers:s.newBufferUploads,
 extendedUploads:s.extendedUploads,lost:s.after.lost,glErrors:s.after.errors.length,giSource:s.after.gi?.source,giFaces:s.after.gi?.capturedFaces
})))
assert.equal(rows.length,16)
for(const row of rows){assert.ok(row.durationMs>=30000);assert.equal(row.lost,false);assert.equal(row.glErrors,0)
 for(const key of ['newPrograms','newWorkers','newTextures','newBuffers'])assert.equal(row[key],0)
 if(row.view==='walk'){assert.equal(row.giSource,'saved');assert.equal(row.giFaces,0)}
}
const mean=(a,key)=>a.reduce((n,r)=>n+r[key],0)/a.length
const scenarios=[]
for(const view of ['building','walk'])for(const movement of ['stationary','moving']){
 const scenario={view,movement}
 for(const arm of ['reference','candidate']){
  const selected=rows.filter(r=>r.view===view&&r.movement===movement&&r.arm===arm)
  scenario[arm]=Object.fromEntries(['fps','composer','main','gpu','html','draws','triangles','longTasks'].map(key=>[key,mean(selected,key)]))
  scenario[arm].p95Range=[Math.min(...selected.map(r=>r.p95)),Math.max(...selected.map(r=>r.p95))]
 }
 scenario.delta=Object.fromEntries(['fps','composer','main','gpu','html'].map(key=>[key,scenario.candidate[key]-scenario.reference[key]]))
 scenarios.push(scenario)
}
const aggregate={}
for(const arm of ['reference','candidate']){
 const selected=rows.filter(r=>r.arm===arm)
 aggregate[arm]={...Object.fromEntries(['composer','main','gpu'].map(key=>[key,mean(scenarios.map(s=>s[arm]),key)])),
  worstP95:Math.max(...selected.map(r=>r.p95)),programs:[...new Set(selected.map(r=>r.programs))].sort(),
  maxHeap:Math.max(...selected.map(r=>r.heapAfter)),longTasks:selected.reduce((n,r)=>n+r.longTasks,0)}
}
const galleries=['gallery.json','gallery-glass.json','stair-gallery.json'].map(read)
for(const gallery of galleries){assert.ok(gallery.finished);assert.equal(gallery.failure,undefined);assert.ok(gallery.comparisons.every(c=>c.changedPixels===0))}
const retention=read('retention.json');assert.ok(retention.finished);assert.equal(retention.failure,undefined)
const result={generated:new Date().toISOString(),rows,scenarios,aggregate,
 visual:galleries.flatMap(g=>g.comparisons),retention:retention.runs[0],
 targetMet:rows.filter(r=>r.arm==='candidate').every(r=>r.fps>=60&&r.p95<16.67)}
writeFileSync(`${out}/acceptance.json`,JSON.stringify(result,null,2))
const keys=Object.keys(rows[0]).filter(k=>k!=='extendedUploads')
writeFileSync(`${out}/final-windows.csv`,keys.join(',')+'\n'+rows.map(r=>keys.map(k=>r[k]).join(',')).join('\n')+'\n')
console.log(JSON.stringify({scenarios,aggregate,targetMet:result.targetMet,visualComparisons:result.visual.length},null,2))
