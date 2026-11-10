// Reads a saved Chrome Performance trace or .cpuprofile locally. Never opens a
// browser or prints raw trace data. Supports Chrome's default gzip export.
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {basename,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {TraceMap,originalPositionFor} from '@jridgewell/trace-mapping'

export function extractProfiles(trace) {
  if(Array.isArray(trace.nodes)&&Array.isArray(trace.samples))return [{key:'cpu-profile',...trace}]
  const profiles=new Map()
  for(const event of trace.traceEvents??trace){
    if(!['Profile','ProfileChunk','CpuProfile'].includes(event.name))continue
    const data=event.args?.data??{},cpu=data.cpuProfile
    if(event.name==='CpuProfile'&&cpu?.nodes){profiles.set(`${event.pid}:${event.tid}:legacy`,{key:'legacy',...cpu});continue}
    const key=`${event.pid}:${event.tid}:${event.id??event.id2?.local??event.id2?.global??''}`
    let profile=profiles.get(key)
    if(!profile){profile={key,nodes:[],samples:[],timeDeltas:[],startTime:data.startTime};profiles.set(key,profile)}
    if(event.name==='Profile'){profile.startTime=data.startTime;continue}
    if(cpu?.nodes)profile.nodes.push(...cpu.nodes)
    if(cpu?.samples)profile.samples.push(...cpu.samples)
    if(data.timeDeltas??cpu?.timeDeltas)profile.timeDeltas.push(...(data.timeDeltas??cpu.timeDeltas))
  }
  return [...profiles.values()].filter(p=>p.samples.length)
}

export function analyseProfile(profile,mapFrame=frame=>frame) {
  const nodes=new Map()
  for(const node of profile.nodes){
    const previous=nodes.get(node.id)
    nodes.set(node.id,{...previous,...node,callFrame:node.callFrame?mapFrame(node.callFrame):previous?.callFrame,
      children:[...new Set([...(previous?.children??[]),...(node.children??[])])]})
  }
  for(const node of nodes.values())for(const child of node.children??[]){const n=nodes.get(child);if(n&&n.parent===undefined)n.parent=node.id}
  const self=new Map(),inclusive=new Map(),categories=new Map(),stacks=new Map()
  const key=frame=>`${frame?.functionName||'(anonymous)'} | ${frame?.url??''}:${(frame?.lineNumber??-1)+1}`
  const stackFor=id=>{
    if(stacks.has(id))return stacks.get(id)
    const stack=[],seen=new Set()
    for(let node=nodes.get(id);node&&!seen.has(node.id);node=nodes.get(node.parent)){seen.add(node.id);stack.push(node.callFrame)}
    stacks.set(id,stack);return stack
  }
  const category=stack=>{
    const leaf=stack[0]??{},name=leaf.functionName??''
    if(name.startsWith('(')&&name!=='(anonymous)')return name
    const has=pattern=>stack.some(frame=>pattern.test(`${frame?.functionName} ${frame?.url} ${frame?.scope}`))
    if(has(/rendererUniformArrays/))return 'shared lighting array comparison'
    if(has(/WebGLUniforms|setValue\w*Array/)||stack.some(f=>/^setValue|^upload$|^flatten$/.test(f?.functionName??'')&&/three\//.test(f?.url??'')))return 'uniform setup/upload'
    if(/rendererAttributeDefaults/.test(leaf.url??'')||stack.some(f=>f?.functionName==='apply'&&/rendererAttributeDefaults/.test(f.url??'')))return 'generic vertex attributes'
    if(stack.some(f=>/customProgramCacheKey|patchedProgramCacheKey/.test(f?.functionName??'')||
      /indirectLightingShader/.test(f?.url??'')&&f?.functionName==='key'))return 'shader cache-key construction'
    if(has(/WebGLTextures/))return 'texture binding/setup'
    if(has(/WebGLMaterials/))return 'material refresh'
    if(has(/WebGLPrograms|\bsetProgram\b|\bgetProgram\b/))return 'program selection/setup'
    if(has(/WebGLState/))return 'GPU state setup'
    if(has(/updateMatrixWorld|updateWorldMatrix/))return 'world matrix update'
    if(has(/Raycaster|raycast|intersectObject/))return 'ray queries'
    if(has(/WebGLRenderLists|WebGLRenderList|projectObject/))return 'scene traversal/render lists'
    if(has(/renderBufferDirect|WebGLBufferRenderer|WebGLIndexedBufferRenderer/))return 'remaining draw submission'
    if(has(/\/konva\/|\/react-konva\/|\/FloorplanCanvas\./))return '2D floorplan'
    if(has(/react-dom|react-reconciler/))return 'React reconciliation'
    if(has(/\/src\//))return 'application frame work'
    return 'other JavaScript/native attribution'
  }
  const add=(map,id,ms)=>map.set(id,(map.get(id)??0)+ms)
  let sampledMs=0,missingSamples=0
  for(let i=0;i<profile.samples.length;i++){
    const ms=(profile.timeDeltas?.[i]??0)/1000,stack=stackFor(profile.samples[i])
    if(!stack.length)missingSamples++
    sampledMs+=ms;add(self,key(stack[0]),ms)
    for(const id of new Set(stack.map(key)))add(inclusive,id,ms)
    add(categories,category(stack),ms)
  }
  const rows=map=>[...map].sort((a,b)=>b[1]-a[1]).map(([name,ms])=>({name,ms:Math.round(ms*100)/100,percent:Math.round(ms*10000/Math.max(1,sampledMs))/100}))
  return {key:profile.key,samples:profile.samples.length,sampledMs,missingSamples,
    warning:'Sampled stacks include possible browser/native blocking. Inclusive times overlap; they are not pure JavaScript instruction time.',
    categories:rows(categories),self:rows(self).slice(0,35),inclusive:rows(inclusive).slice(0,35)}
}

export function sourceMapper(directory) {
  const maps=new Map(),sources=new Map()
  return frame=>{
    const file=basename((frame.url??'').split('?')[0]),path=resolve(directory,file+'.map')
    if(!file||!existsSync(path)||frame.lineNumber<0)return frame
    if(!maps.has(file))maps.set(file,new TraceMap(JSON.parse(readFileSync(path,'utf8'))))
    const position=originalPositionFor(maps.get(file),{line:frame.lineNumber+1,column:frame.columnNumber})
    if(!position.source)return frame
    const source=resolve(directory,position.source)
    let functionName=position.name??frame.functionName
    if(existsSync(source)){
      if(!sources.has(source)){
        const lines=readFileSync(source,'utf8').split('\n')
        sources.set(source,{lines,scopes:lines.flatMap((line,index)=>{const match=line.match(/^(?:function|class) (\w+)/);return match?[{name:match[1],line:index}]:[]})})
      }
      const info=sources.get(source),line=info.lines[position.line-1]??''
      functionName=line.match(/function\s+(\w+)\s*\(/)?.[1]??line.match(/\.(\w+)\s*=\s*function/)?.[1]??
        line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:\([^)]*\)|\w+)\s*=>/)?.[1]??functionName
      frame={...frame,scope:info.scopes.findLast(item=>item.line<=position.line-1)?.name}
    }
    return {...frame,url:position.source,lineNumber:position.line-1,columnNumber:position.column,functionName}
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const input=process.argv[2]
  if(!input)throw Error('Provide a saved Chrome trace or CPU-profile file')
  const bytes=readFileSync(input),raw=bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes):bytes
  const trace=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''))
  const profiles=extractProfiles(trace),directory=process.argv[3]??'tmp/viewport-fps/submission/source-map/assets'
  const relevant=profiles.filter(p=>p.nodes.some(n=>/localhost:4173|127\.0\.0\.1:4173/.test(n.callFrame?.url??'')))
  const result={input,profiles:(relevant.length?relevant:profiles).map(p=>analyseProfile(p,sourceMapper(directory)))}
  if(!result.profiles.length)throw Error('No CPU samples found. Keep JavaScript sampling enabled when recording.')
  const output=process.argv[4]??'tmp/viewport-fps/cpu-trace-summary.json'
  writeFileSync(output,JSON.stringify(result,null,2))
  console.log(JSON.stringify({output,profiles:result.profiles.map(p=>({key:p.key,samples:p.samples,sampledMs:p.sampledMs,
    missingSamples:p.missingSamples,categories:p.categories,topSelf:p.self.slice(0,8)}))},null,2))
}
