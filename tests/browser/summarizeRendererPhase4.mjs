import {readFileSync,writeFileSync,existsSync,mkdirSync,statSync} from 'node:fs'
import {basename,resolve} from 'node:path'
import {TraceMap,originalPositionFor} from '@jridgewell/trace-mapping'
import sharp from 'sharp'
const out='tmp/renderer-phase4',mapsDirectory=process.argv[2]??`${out}/production-reference/assets`
const read=p=>JSON.parse(readFileSync(p,'utf8')),summary={generated:new Date().toISOString()}
const baseline=read(`${out}/baseline.json`)
summary.baseline=baseline.runs.flatMap(r=>Object.entries(r.samples).map(([movement,s])=>({build:r.build,view:r.view,run:r.label,movement,durationMs:s.durationMs,fps:s.presentedFPS,medianMs:s.frameMs.median,p95Ms:s.frameMs.p95,p99Ms:s.frameMs.p99,cpuMs:s.cpuFrameMs.mean,gpuMs:s.gpuFrameMs.mean,drawCalls:s.passes.reduce((n,p)=>n+p.drawCallsPerFrame,0),triangles:s.passes.reduce((n,p)=>n+p.trianglesPerFrame,0),programs:s.after.three.programs,heapBefore:s.before.heap,heapAfter:s.after.heap,newPrograms:s.newPrograms,newWorkers:s.newWorkerMessages,newTextureUploads:s.newTextureUploads,newBufferUploads:s.newBufferUploads,reactCommits:s.after.reactUI.commits-s.before.reactUI.commits})))
const columns=Object.keys(summary.baseline[0]);writeFileSync(`${out}/baseline.csv`,columns.join(',')+'\n'+summary.baseline.map(r=>columns.map(k=>r[k]).join(',')).join('\n')+'\n')
const ppLines=readFileSync('node_modules/postprocessing/build/index.js','utf8').split('\n'),ppClasses=ppLines.flatMap((line,i)=>{const m=line.match(/^var (\w+) = class/);return m?[{name:m[1],line:i}]:[]})
function cpuProfile(path,frames){
 const p=read(path),maps=new Map(),nodes=new Map(),stacks=new Map(),sources=new Map()
 for(const n of p.nodes){const f=n.callFrame,file=basename(f.url.split('?')[0]);let mapped={...f}
  if(file&&existsSync(resolve(mapsDirectory,file+'.map'))){if(!maps.has(file))maps.set(file,new TraceMap(read(resolve(mapsDirectory,file+'.map'))));const original=originalPositionFor(maps.get(file),{line:f.lineNumber+1,column:f.columnNumber});if(original.source)mapped={...f,url:original.source,lineNumber:original.line-1,columnNumber:original.column,functionName:original.name??f.functionName}}
  if(mapped.url.includes('postprocessing/build/index.js'))mapped.className=ppClasses.findLast(c=>c.line<=mapped.lineNumber)?.name
  const sourcePath=resolve(mapsDirectory,mapped.url)
  if(mapped.url&&existsSync(sourcePath)&&statSync(sourcePath).isFile()){
   if(!sources.has(sourcePath)){const lines=readFileSync(sourcePath,'utf8').split('\n');sources.set(sourcePath,{lines,containers:lines.flatMap((line,i)=>{const m=line.match(/^(?:function|class) (\w+)/);return m?[{name:m[1],line:i}]:[]})})}
   const source=sources.get(sourcePath),line=source.lines[mapped.lineNumber]??''
   const declaration=line.match(/function\s+(\w+)\s*\(/)?.[1]??line.match(/\.(\w+)\s*=\s*function/)?.[1]??line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:\([^)]*\)|\w+)\s*=>/)?.[1]
   if(declaration)mapped.functionName=declaration
   mapped.container=source.containers.findLast(c=>c.line<=mapped.lineNumber)?.name
  }
  nodes.set(n.id,{...n,callFrame:mapped})
 }
 for(const n of nodes.values())for(const child of n.children??[])nodes.get(child).parent=n.id
 const stackFor=id=>{if(stacks.has(id))return stacks.get(id);const a=[];for(let n=nodes.get(id);n;n=nodes.get(n.parent))a.push(n.callFrame);stacks.set(id,a);return a}
 const self=new Map(),inclusive=new Map(),categories=new Map(),mainCategories=new Map()
 const add=(map,key,ms)=>map.set(key,(map.get(key)??0)+ms)
 function category(stack){const leaf=stack[0],url=leaf.url,name=leaf.functionName
  if(name.startsWith('('))return name
  if(stack.some(f=>f.container==='WebGLUniforms'||/^setValue|^upload$/.test(f.functionName)&&f.url.includes('three.module')))return 'uniform setup/upload'
  if(stack.some(f=>f.container==='WebGLTextures'))return 'texture setup/binding'
  if(stack.some(f=>f.container==='WebGLState'))return 'GPU state setup'
  if(stack.some(f=>f.container==='WebGLMaterials'))return 'material uniform selection/refresh'
  if(stack.some(f=>f.container==='WebGLPrograms'||/^(setProgram|getProgram)$/.test(f.functionName)))return 'program selection/setup'
  if(stack.some(f=>f.url.includes('Frustum')))return 'frustum culling'
  if(stack.some(f=>/^(updateMatrixWorld|updateWorldMatrix)$/.test(f.functionName)))return 'world-matrix updates'
  if(stack.some(f=>f.container==='WebGLRenderList'||f.container==='WebGLRenderLists'))return 'render-list construction/sorting'
  if(stack.some(f=>f.functionName==='projectObject'))return 'scene projection/traversal'
  if(url.includes('rendererAttributeDefaults')||stack.some(f=>f.url.includes('rendererAttributeDefaults')&&f.functionName==='apply'))return 'generic vertex-attribute defaults'
  if(stack.some(f=>/renderBufferDirect|WebGLBufferRenderer|WebGLIndexedBufferRenderer/.test(f.functionName+' '+f.container)))return 'draw submission (remaining)'
  if(stack.some(f=>/Raycaster|raycast|intersectObject/.test(f.url+' '+f.functionName)))return 'ray queries'
  if(/Matrix|Vector|Quaternion/.test(url))return 'matrix/vector math (other)'
  if(url.includes('rendererAudit'))return 'audit instrumentation'
  if(url.includes('/react-')||url.includes('/react/'))return 'React/R3F reconciliation'
  if(url.includes('/src/'))return 'application frame work'
  return 'other JavaScript/native attribution'
 }
 let sampledMs=0,mainMs=0
 for(let i=0;i<p.samples.length;i++){const ms=p.timeDeltas[i]/1000,stack=stackFor(p.samples[i]);sampledMs+=ms
  const key=f=>`${f.functionName||'(anonymous)'} | ${f.url}:${f.lineNumber+1}`
  add(self,key(stack[0]),ms);for(const k of new Set(stack.map(key)))add(inclusive,k,ms)
  const c=category(stack);add(categories,c,ms)
  if(stack.some(f=>f.className==='RenderPass'&&f.functionName==='render')){mainMs+=ms;add(mainCategories,c,ms)}
 }
 const rows=map=>[...map].sort((a,b)=>b[1]-a[1]).map(([name,ms])=>({name,ms,msPerFrame:ms/frames,percentSample:100*ms/sampledMs}))
 return{durationMs:(p.endTime-p.startTime)/1000,sampledMs,frames,mainSampledMs:mainMs,warning:'Sampled stack time can include native/driver blocking; inclusive values overlap. It is not pure JS instruction time.',categories:rows(categories),mainCategories:rows(mainCategories),self:rows(self).slice(0,60),inclusive:rows(inclusive).slice(0,60)}
}
if(existsSync(`${out}/analysis.json`)){
 const a=read(`${out}/analysis.json`);summary.analysis=a.runs.map(r=>({view:r.view,passes:r.passProfile?.passes,callbacks:r.passProfile?.callbacks,mainScene:r.mainScene&&{categories:r.mainScene.categories,timings:r.mainScene.timings,uniforms:r.mainScene.uniforms,duplicateMaterialCandidates:r.mainScene.duplicateMaterialCandidates,repeatedGeometry:r.mainScene.repeatedGeometry},programs:r.samplers?.programs,cpu:existsSync(`${out}/${r.view}-production.cpuprofile`)?cpuProfile(`${out}/${r.view}-production.cpuprofile`,r.profileWindow.cpuFrameMs.count):null}))
}
mkdirSync('docs/renderer-phase4',{recursive:true});writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2))
console.log(JSON.stringify({baseline:summary.baseline,ROI:summary.baselineROI,analysis:summary.analysis?.map(a=>({view:a.view,main:a.cpu?.mainCategories,topSelf:a.cpu?.self.slice(0,8),categories:a.mainScene?.categories}))},null,2))
