import {readdirSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs'
const dir='tmp/renderer-audit',files=readdirSync(dir).filter(x=>/^(?:building|walk)-(?:single|off)-\d+-(?:full|baseline)\.json$/.test(x)||/^building-cascaded-\d+-prepare\.json$/.test(x))
const fmt=new Map([[6408,4],[35907,4],[32856,4],[33321,1],[33323,2],[33325,2],[33327,4],[33326,4],[33328,8],[34842,8],[34843,6],[34836,16],[34837,12],[33189,2],[33190,4],[33191,4],[36012,4],[35056,4],[36013,8]])
function textureBytes(t){
 const levels=Object.values(t.levels??{});let bytes=0,unknown=[]
 for(const l of levels){
  const count=t.mipLevels??(t.generatedMipmaps?Math.floor(Math.log2(Math.max(l.width,l.height,l.depth)))+1:1)
  // Immutable texStorage reports one base record for all levels; explicit images report each level.
  const n=t.mipLevels||t.generatedMipmaps?count:1
  for(let m=0;m<n;m++){
   const w=Math.max(1,l.width>>m),h=Math.max(1,l.height>>m),d=Math.max(1,l.depth>>m),faces=l.target===34067?6:1
   if([36492,36493].includes(l.internal))bytes+=Math.ceil(w/4)*Math.ceil(h/4)*d*16*faces
   else if(fmt.has(l.internal))bytes+=w*h*d*fmt.get(l.internal)*faces
   else if(l.compressed&&l.bytes)bytes+=l.bytes
   else unknown.push(l.internal)
  }
 }
 return{bytes,unknown:[...new Set(unknown)]}
}
const records=[]
for(const file of files){
 const r=JSON.parse(readFileSync(`${dir}/${file}`,'utf8')),s=r.final??r.initial??r.initialResources
 const textures=s?.textures?.filter(t=>!t.deletedAt).map(t=>({id:t.id,labels:t.labels,...textureBytes(t),target:t.target,levels:t.levels,mipLevels:t.mipLevels}))??[]
 const bufferBytes=s?.buffers?.filter(b=>!b.deletedAt).reduce((a,b)=>a+(b.bytes??0),0)??null
 const renderbufferBytes=s?.renderbuffers?.filter(b=>!b.deletedAt).reduce((a,b)=>a+(b.width??0)*(b.height??0)*(b.samples||1)*(fmt.get(b.internal)??0),0)??null
 const samples=Object.entries(r.samples??{}).map(([label,p])=>({label,duration:p.durationMs,fps:p.presentedFPS,median:p.frameMs.median,p95:p.frameMs.p95,p99:p.frameMs.p99,worst:p.frameMs.worst,cpu:p.cpuFrameMs.mean,gpu:p.gpuFrameMs.mean,calls:p.passes.reduce((a,x)=>a+x.drawCallsPerFrame,0),triangles:p.passes.reduce((a,x)=>a+x.trianglesPerFrame,0),programs:p.after.three.programs,newPrograms:p.newPrograms,uploads:p.newTextureUploads,workerMessages:p.newWorkerMessages,queriesRemaining:p.timerQueriesRemaining,config:p.after.config}))
 const passes=r.passProfile?.passes.map(p=>({name:p.name,executions:p.executionsPerFrame,cpu:p.cpuMsPerFrame,gpu:p.gpuMs.mean==null?null:p.gpuMs.mean*p.executionsPerFrame,calls:p.drawCallsPerFrame,triangles:p.trianglesPerFrame,switches:p.switches/Math.max(1,r.passProfile.cpuFrameMs.count),target:p.target}))
 const groups=new Map();for(const p of r.samplers?.programs??[]){const key=p.vertexHash+p.fragmentHash;let group=groups.get(key);if(!group)groups.set(key,group=[]);group.push({id:p.id,name:p.programName,cacheKey:p.cacheKey})}
 let profile
 try{const p=JSON.parse(readFileSync(`${dir}/${file.replace('.json','.cpuprofile')}`)),nodes=new Map(p.nodes.map(n=>[n.id,n])),cost=new Map();p.samples.forEach((id,i)=>{const f=nodes.get(id).callFrame,key=`${f.functionName||'(anonymous)'} ${f.url}:${f.lineNumber+1}`;cost.set(key,(cost.get(key)||0)+(p.timeDeltas[i]??0)/1000)});profile={elapsedMs:(p.endTime-p.startTime)/1000,selfMs:[...cost].sort((a,b)=>b[1]-a[1]).slice(0,35)}}catch{}
 records.push({file,mode:r.mode,view:r.view,size:r.size,failure:r.failure,hardware:s?.hardware??r.initialResources?.hardware,gi:s?.gi,models:r.initialResources?.models,three:s?.three,native:s?.native?.live??s?.live,samples,passes,callbacks:r.passProfile?.callbacks,programs:{total:r.samplers?.programs.length,observed:r.samplers?.programs.filter(p=>p.observedAtDraw!==false).length,maxFragmentUnits:r.samplers?.programs[0]?.stageUnits.fragment.length,duplicates:[...groups.values()].filter(x=>x.length>1)},memory:{textureBytes:s?.textures?textures.reduce((a,t)=>a+t.bytes,0):null,bufferBytes,renderbufferBytes,unknown:textures.filter(t=>t.unknown.length),textures:textures.sort((a,b)=>b.bytes-a.bytes)},profile})
}
writeFileSync(`${dir}/summary.json`,JSON.stringify(records,null,2))
const n=x=>x==null?'—':Number(x).toFixed(2),rows=[]
for(const r of records)for(const s of r.samples)rows.push(`| ${r.view}/${r.mode}/${r.size} | ${s.label} | ${n(s.fps)} | ${n(s.median)} | ${n(s.p95)} | ${n(s.p99)} | ${n(s.worst)} | ${n(s.cpu)} | ${n(s.gpu)} | ${n(s.calls)} | ${Math.round(s.triangles)} | ${s.newPrograms} |`)
const lines=['# Measured renderer audit tables','Generated from raw JSON; all times in milliseconds.','', '| Scene / shadows / size | Case | FPS | Median | P95 | P99 | Worst | CPU submit | GPU frame | Draws | Triangles | New programs |','|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',...rows,'']
for(const r of records){
 lines.push(`## ${r.file}`,'')
 if(r.failure)lines.push(`Failure: ${r.failure}`,'')
 if(r.passes){lines.push('| Pass | Executes/frame | CPU/frame | GPU/frame | Draws/frame | Triangles/frame | Switches/frame |','|---|---:|---:|---:|---:|---:|---:|');for(const p of r.passes)lines.push(`| ${p.name} | ${n(p.executions)} | ${n(p.cpu)} | ${n(p.gpu)} | ${n(p.calls)} | ${n(p.triangles)} | ${n(p.switches)} |`);lines.push('')}
 const mib=v=>v==null?'not captured':n(v/1048576)+' MiB'
 lines.push(`Estimated texture storage: ${mib(r.memory.textureBytes)}; native buffer stores: ${mib(r.memory.bufferBytes)}; renderbuffers: ${mib(r.memory.renderbufferBytes)}. Unknown texture formats: ${r.memory.unknown.length}.${r.failure?' This is a preparation-failure snapshot, not a completed scene.':''}`,'')
}
mkdirSync('docs/renderer-audit',{recursive:true});writeFileSync('docs/renderer-audit/measurements.md',lines.join('\n'))
console.log(JSON.stringify(records.map(r=>({file:r.file,failure:r.failure,samples:r.samples,memoryMiB:{textures:r.memory.textureBytes/1048576,buffers:r.memory.bufferBytes/1048576,renderbuffers:r.memory.renderbufferBytes/1048576},programs:r.programs.total,maxUnits:r.programs.maxFragmentUnits})),null,2))
