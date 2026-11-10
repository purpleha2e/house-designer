import {readFileSync,writeFileSync} from 'node:fs'
const path=process.argv[2]
if(!path)throw Error('Provide the captured profile JSON path')
let profile=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''))
if(typeof profile==='string')profile=JSON.parse(profile)
const frames=profile.samples.filter(s=>s.at>=2000&&s.elapsedMs>=500&&!s.hidden&&!s.warm)
const sum=(rows,key)=>rows.reduce((total,row)=>total+(row[key]??0),0)
const displays=sum(frames,'displayFrames'),elapsed=sum(frames,'elapsedMs')
const passes={}
for(const sample of frames)for(const pass of sample.passes){const row=passes[pass.name]??={calls:0,cpuMs:0};row.calls+=pass.calls;row.cpuMs+=pass.cpuMs}
const gpu={}
for(const sample of profile.gpu.filter(s=>s.at>=2000)){(gpu[sample.pass]??=[]).push(sample.ms)}
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null
const result={graphics:profile.graphics,gpuTimers:profile.gpuTimers,disjoint:profile.disjoint,
  validSamples:frames.length,viewports:[...new Set(frames.map(s=>s.viewport.join('x')))],
  callbackFps:sum(frames,'callbackFrames')*1000/elapsed,displayFps:displays*1000/elapsed,
  lightingStates:[...new Set(frames.map(s=>s.lighting?.state))],
  cpuPerDisplay:Object.fromEntries(Object.entries(passes).map(([name,row])=>[name,{calls:row.calls,ms:row.cpuMs/Math.max(1,row.calls)}])),
  gpuPerPass:Object.fromEntries(Object.entries(gpu).map(([name,values])=>[name,{samples:values.length,meanMs:mean(values),maxMs:Math.max(...values)}])),
  nativePerDisplay:Object.fromEntries(Object.keys(frames[0]?.native??{}).map(key=>[key,frames.reduce((n,s)=>n+s.native[key],0)/Math.max(1,displays)])),
  timeline:profile.samples.map(s=>({at:s.at,callbackFps:s.callbackFps,displayFps:s.displayFps,hidden:s.hidden,focused:s.focused,lighting:s.lighting?.state,phase:s.phase,
    passes:s.passes.map(p=>({name:p.name,calls:p.calls,cpuMs:p.cpuMs})),lightRevision:s.lightRevision,programs:s.programs})),errors:profile.errors}
console.log(JSON.stringify(result,null,2))
if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(result,null,2))
