// Verify the saved experiment's invariants without starting another renderer.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const dir='tmp/viewport-fps/render-loop/final',a=JSON.parse(readFileSync(dir+'/audit.json')),s=JSON.parse(readFileSync(dir+'/summary.json'))
assert.deepEqual(a.errors,[]);assert.deepEqual(a.browserErrors,[])
assert.equal(a.runs.length,6);assert.equal(s.detailed.length,2)
assert.equal(a.bundleSha256,createHash('sha256').update(readFileSync('dist/assets/'+s.bundle)).digest('hex'))
for(const i of [0,2]){const r=a.runs[i];assert.ok(r.durationMs>=10000);assert.equal(r.before.gi.state,'ready');assert.equal(r.after.gi.state,'ready');assert.equal(r.before.gi.source,'saved');assert.equal(r.after.gi.capturedFaces,0);assert.equal(r.after.lost,false);assert.deepEqual(r.before.resources,r.after.resources);assert.ok(Object.keys(r.native).every(k=>/drawArrays|drawElements/.test(k)));assert.ok(!Object.keys(r.counts).some(k=>k.startsWith('2D.')));assert.ok(r.before.workers.every((w,j)=>w.sent===r.after.workers[j].sent&&w.received===r.after.workers[j].received))}
for(const r of s.detailed){assert.equal(r.callbacks.reduce((n,c)=>n+c.callsPerFrame,0),a.initial.subscribers);assert.equal(r.callbacks.find(c=>c.priority===1).callsPerFrame,1);assert.ok(r.callbacks.every(c=>c.source.source&&c.source.line));assert.equal(r.perFrame['0:RenderPass:executions'],1);assert.equal(r.perFrame['1:Pass:executions'],1);assert.equal(r.perFrame['2:EffectPass:executions'],1);assert.ok(!Object.keys(r.perFrame).some(k=>k.startsWith('2D.')||/:shadow:GL.draw/.test(k)))}
const still=s.detailed[0],calls=still.groups.reduce((n,g)=>n+g.callsPerFrame,0),native=Object.values(s.normal[0].nativePerFrame).reduce((n,c)=>n+c,0)
assert.equal(calls,native);assert.equal(calls,846)
const skirt=still.groups.find(g=>g.name==='0:RenderPass:skirting:opaque');assert.equal(skirt.callsPerFrame,120);assert.equal(skirt.materials,120);assert.equal(skirt.geometries,120)
assert.ok(a.runs[3].native['1:texSubImage3D']>0,'The excluded publication window remains identified')
for(const mode of ['still','moving']){const p=JSON.parse(readFileSync(dir+'/'+mode+'-cpu.json')).profiles[0];assert.ok(p.samples>10000);assert.equal(p.missingSamples,0)}
console.log('Verified clean steady windows, callback coverage, source mapping, native/direct draw agreement, publication exclusion and CPU profiles.')
