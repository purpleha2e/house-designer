import fs from 'node:fs'
import {Vector3,DataUtils} from 'three'
import {readLocalLightInput} from './localLightIO.mjs'
import {restoreIndirectField} from '../src/indirectLighting.ts'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {inspectIndirectPoint} from '../src/indirectLightingDiagnostic.ts'
const root='docs/sunlit-bounce',input=readLocalLightInput(`${root}/scene-input.bin.gz`),field=restoreIndirectField(input.field),visibility=createIndirectVisibilityFromSnapshot(input.geometry),report=JSON.parse(fs.readFileSync(`${root}/production.json`)),audit=JSON.parse(fs.readFileSync(`${root}/capture-audit.json`)),results={}
const inspect=()=>input.points.map(p=>inspectIndirectPoint(field,visibility,new Vector3().fromArray(p.position),new Vector3().fromArray(p.normal),[]))
try{
 for(const variant of report.variants.slice(0,3)){const saved=readLocalLightInput(`${root}/field-${variant.name}.bin.gz`);field.volume.data.set(saved.volume);field.floorLayer.data.set(saved.floor);field.floorLayer.ready=true
  for(const pass of [0,5]){field.coefficients.forEach(a=>a.fill(0));for(const p of variant.passes[pass].coefficients)for(let c=0;c<3;c++)for(let k=0;k<4;k++)field.coefficients[c][p.index*4+k]=DataUtils.toHalfFloat(p.rgb[c][k]);results[variant.name+'-'+(pass+1)]=inspect()}
 }
 field.coefficients.forEach(a=>a.fill(0));for(const p of audit.results){const samples=p.groups[0].samples;for(let k=0;k<4;k++){const value=samples.reduce((s,q)=>s+q.reference*q.weight*(k===0?.28209479177387814:.4886025119029199*q.direction[[0,1,2,0][k]]),0);for(let c=0;c<3;c++)field.coefficients[c][p.index*4+k]=DataUtils.toHalfFloat(value)}}
 results.referenceProbeFirstDuvet=inspect();fs.writeFileSync(`${root}/spatial-audit.json`,JSON.stringify(results,null,2))
}finally{field.dispose();visibility.dispose()}
