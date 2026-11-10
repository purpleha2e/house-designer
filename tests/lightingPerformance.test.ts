import test from 'node:test'
import assert from 'node:assert/strict'
import type {WebGLRenderer} from 'three'
import {createLightingPerformance} from '../src/lightingPerformance.ts'
import {shouldPublishLivePreview} from '../src/indirectLivePreview.ts'
test('exclusive wall phases total 100%, independently of CPU and asynchronous spans',async()=>{
  let at=0
  const fake={getContext:()=>({getExtension:()=>null}),info:{memory:{textures:3,geometries:2},programs:[]}} as unknown as WebGLRenderer
  const profile=createLightingPerformance(fake,()=>at)
  profile.begin('test');at=10;profile.phase('capture');profile.measure('CPU submission',()=>{at+=4});profile.record('worker',8);at=30
  await profile.wait('readback wait',Promise.resolve());profile.finish()
  const report=profile.report();assert.equal(report.totalMs,30);assert.equal(report.wallPhases.reduce((s,p)=>s+p.ms,0),30)
  assert.ok(Math.abs(report.wallPhases.reduce((s,p)=>s+p.percent,0)-100)<1e-10);assert.equal(report.stages.find(s=>s.name==='CPU submission')?.cpuMs,4)
  assert.equal(report.gpuTimerSupported,false);assert.equal(report.pendingGpuQueries,0);profile.dispose()
})
test('world-space publication batches prevent a 300 ms volume rebuild loop',()=>{
  assert.equal(shouldPublishLivePreview(4,0,100,-Infinity,2000,16),true,'first useful probes can publish promptly')
  assert.equal(shouldPublishLivePreview(20,4,1800,100,2000,16),false)
  assert.equal(shouldPublishLivePreview(20,4,2200,100,2000,16),true)
})
