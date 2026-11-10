import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {DataUtils} from 'three'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
const bytes=fs.readFileSync('colin_house_v2.json'),project=JSON.parse(bytes.toString()),loaded=await loadIndirectLighting(project.indirectLighting,{reflections:false,allowLegacy:true})
if(!loaded)throw Error('Saved GI could not load')
const {field}=loaded,normals=[[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0]]
const probes=field.probes.filter(p=>p.region.id===10).map(p=>{
 const evaluate=(coefficients?:Uint16Array[])=>coefficients?normals.map(([x,y,z])=>[0,1,2].map(c=>{const at=p.index*4,a=coefficients[c];return Math.max(0,.886227*DataUtils.fromHalfFloat(a[at])+1.023328*(y*DataUtils.fromHalfFloat(a[at+1])+z*DataUtils.fromHalfFloat(a[at+2])+x*DataUtils.fromHalfFloat(a[at+3])))})):null
 return{index:p.index,kind:p.kind,position:p.position.toArray(),final:evaluate(field.coefficients),firstPass:evaluate(loaded.directCoefficients),sky:evaluate(loaded.skyCoefficients)}
})
const report={sha256:createHash('sha256').update(bytes).digest('hex'),sun:project.sunPosition,view:project.threeDView,settings:project.indirectLighting.settings,normals,probes}
fs.writeFileSync('docs/bedroom-sun-audit/saved-field.json',JSON.stringify(report,null,2));console.log(JSON.stringify(probes.map(p=>({index:p.index,position:p.position,final:p.final?.[0],first:p.firstPass?.[0],sky:p.sky?.[0]})),null,2));field.dispose()
