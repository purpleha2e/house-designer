import { existsSync, readFileSync } from 'node:fs'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
const profile = JSON.parse(readFileSync(process.argv[2]))
const reportPath=process.argv[2].replace(/\.cpuprofile$/,'.json')
const offset=reportPath!==process.argv[2]&&existsSync(reportPath)?JSON.parse(readFileSync(reportPath,'utf8')).profilerOffsetMs??0:0
if(profile.errors){
  for(const error of profile.errors){
    const frame=error.stackTrace?.callFrames?.[0]
    if(!frame)continue
    const path=`node_modules/.cache/viewport-production/assets/${frame.url.split('/').at(-1)}.map`
    console.log(originalPositionFor(new TraceMap(JSON.parse(readFileSync(path,'utf8'))),{line:frame.lineNumber+1,column:frame.columnNumber}))
  }
  process.exit(0)
}
const nodes = new Map(profile.nodes.map(n => [n.id, n])), totals = new Map()
const maps=new Map()
for(const node of nodes.values()) {
  const frame=node.callFrame,file=frame.url.split('/').at(-1)?.split('?')[0]
  if(!file)continue
  const path=`node_modules/.cache/viewport-production/assets/${file}.map`
  if(!maps.has(file))maps.set(file,existsSync(path)?new TraceMap(JSON.parse(readFileSync(path,'utf8'))):null)
  const map=maps.get(file)
  if(!map)continue
  const original=originalPositionFor(map,{line:frame.lineNumber+1,column:frame.columnNumber})
  if(original.source)node.callFrame={...frame,functionName:original.name??frame.functionName,url:original.source,lineNumber:original.line-1}
}
for (const node of nodes.values()) for (const child of node.children ?? []) nodes.get(child).parent = node.id
let at = 0
for (let i = 0; i < profile.samples.length; i++) {
  at += profile.timeDeltas[i]/1000
  const pageTime=at+offset
  if (process.argv[3]==='--range' && (pageTime<Number(process.argv[4]) || pageTime>Number(process.argv[5]))) continue
  let node = nodes.get(profile.samples[i]); const stack = []
  while (node) { stack.push(`${node.callFrame.functionName} (${node.callFrame.url.split('/').at(-1)?.split('?')[0]}:${node.callFrame.lineNumber + 1})`); node = nodes.get(node.parent) }
  const match = process.argv[3]==='--range' ? 0 : stack.findIndex(frame => frame.startsWith(process.argv[3] ?? 'onFirstUse'))
  if (match < 0) continue
  const key = stack.slice(match, match + 12).join(' <- ')
  totals.set(key, (totals.get(key) ?? 0) + profile.timeDeltas[i] / 1000)
}
console.log([...totals].sort((a,b) => b[1]-a[1]).slice(0,15))
console.log({ duration:at, start:profile.startTime, end:profile.endTime })
