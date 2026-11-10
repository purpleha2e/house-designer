import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {sampleIndirectCoefficients} from '../src/indirectVolume.ts'
import {buildBarrierMetadata,independentBarrierRay,sampleBarrierField,barrierValid} from './giBarrierGeometry.ts'
import {barrierFixture,rebuildBarrierFixture} from './giBarrierFixtures.ts'
export async function runBarrierRegressions(out='docs/gi-barrier-filtering'){
 mkdirSync(out,{recursive:true});const results=[]
 for(const [kind,thickness]of [['thin-wall',.006],['partition-100',.1],['wall-150',.15],['closed-door',.035],['doorway',.035],['open-window',.006],['furniture-panel',.006],['panel-edge',.006],['slab',.006],['stairwell',.006]]){
  const f=barrierFixture(kind,thickness),visibility=rebuildBarrierFixture(f)
  try{
   const snapshot=visibility.snapshot(),metadata=await buildBarrierMetadata(f.field,snapshot),samples=Object.fromEntries(['legacy','A','B'].map(mode=>[mode,sampleBarrierField(f.field,metadata,f.receiver,f.normal,0,f.floorLayer,mode)])),coefficients=new Float64Array(12)
   sampleIndirectCoefficients(f.field,0,...f.receiver.toArray(),coefficients,visibility);const exact=coefficients[0]*.886227,blocked=!['doorway','open-window','panel-edge','stairwell'].includes(kind)
   for(const mode of ['A','B']){
    if(blocked)assert.ok(Math.abs(samples[mode].rgb[0]-.1)<.001,`${kind} ${mode} dark side: ${samples[mode].rgb}`)
    else assert.ok(Math.abs(samples[mode].rgb[0]-samples.legacy.rgb[0])<.002,`${kind} ${mode} keeps open transport`)
    for(const tap of samples[mode].taps)if(tap.valid&&tap.support>0&&tap.weight>1e-8)assert.ok(independentBarrierRay(snapshot,f.receiver.toArray(),tap.position),`${kind} ${mode} retained a blocked tap`)
   }
   // Geometry-only decisions must not depend on room IDs or irradiance.
   for(const cell of metadata.cells.values())if(cell.plane)for(const p of samples.A.taps)assert.equal(barrierValid(cell,p.position,p.position,'B'),true)
   if(kind==='thin-wall'){assert.ok(Math.abs(samples.legacy.rgb[0]-.45949)<.001);assert.ok(Math.abs(exact-.1)<.001)}
   results.push({kind,thickness,receiver:f.receiver.toArray(),wallX:f.wallX,floorGridStep:f.step,floorLayer:f.floorLayer,expected:blocked?.1:'same geometrically valid open-space interpolation',exactProbeBlend:exact,samples,metadata:metadata.statistics,plane:metadata.cells.get(samples.A.cell)?.plane??null});console.log('PASS',kind,'legacy',samples.legacy.rgb[0],'A',samples.A.rgb[0],'B',samples.B.rgb[0])
  }finally{visibility.dispose();f.dispose()}
 }
 writeFileSync(`${out}/regressions.json`,JSON.stringify(results,null,2));return results
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/giBarrierRegression.mjs'))await runBarrierRegressions(process.argv[2])
