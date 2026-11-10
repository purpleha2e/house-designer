import test from 'node:test'
import assert from 'node:assert/strict'
import {extractProfiles,analyseProfile} from './analyseViewportCpuTrace.mjs'
const frame=(functionName,url='')=>({functionName,url,lineNumber:0,columnNumber:0})

test('Chrome profile chunks merge repeated nodes and preserve explicit parents',()=>{
  const common={pid:4,tid:8,id:'0x1'}
  const trace={traceEvents:[{...common,name:'Profile',args:{data:{startTime:100}}},
    {...common,name:'ProfileChunk',args:{data:{cpuProfile:{nodes:[{id:1,callFrame:frame('(root)')},
      {id:2,parent:1,callFrame:frame('renderBufferDirect','/WebGLRenderer.js')},
      {id:3,parent:2,callFrame:frame('setValueV2fArray','/WebGLUniforms.js')}],samples:[3,2]},timeDeltas:[1000,2000]}}},
    {...common,name:'ProfileChunk',args:{data:{cpuProfile:{nodes:[{id:3,callFrame:frame('setValueV2fArray','/WebGLUniforms.js')}],samples:[3]},timeDeltas:[3000]}}}]}
  const profiles=extractProfiles(trace)
  assert.equal(profiles.length,1);assert.deepEqual(profiles[0].samples,[3,2,3])
  const result=analyseProfile(profiles[0])
  assert.equal(result.sampledMs,6);assert.equal(result.missingSamples,0)
  assert.equal(result.categories.find(row=>row.name==='uniform setup/upload').ms,4)
  assert.equal(result.inclusive.find(row=>row.name.startsWith('renderBufferDirect')).ms,6)
})

test('standalone CPU profiles reconstruct children and use source-mapped functions',()=>{
  const profile={nodes:[{id:1,callFrame:frame('(root)'),children:[2]},
    {id:2,callFrame:frame('a','http://localhost:4173/assets/index.js')}],samples:[2],timeDeltas:[2500]}
  const result=analyseProfile(extractProfiles(profile)[0],f=>f.functionName==='a'?frame('matches','/src/rendererUniformArrays.ts'):f)
  assert.equal(result.categories[0].name,'shared lighting array comparison')
  assert.equal(result.self[0].ms,2.5)
})

test('distinct renderer threads stay separate and missing samples remain explicit',()=>{
  const event=tid=>({pid:1,tid,id:'0x1',name:'ProfileChunk',args:{data:{cpuProfile:{nodes:[],samples:[99]},timeDeltas:[1000]}}})
  const profiles=extractProfiles({traceEvents:[event(2),event(3)]})
  assert.equal(profiles.length,2)
  const result=analyseProfile(profiles[0])
  assert.equal(result.missingSamples,1);assert.equal(result.sampledMs,1)
})
