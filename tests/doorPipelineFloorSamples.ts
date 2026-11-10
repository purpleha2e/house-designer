import fs from 'node:fs'
import {BoxGeometry,DataUtils,Mesh,MeshStandardMaterial,Scene,Vector3} from 'three'
import {createIndirectField,writeIndirectPosition} from '../src/indirectLighting.ts'
import {createIndirectVisibility} from '../src/indirectVisibility.ts'
import {sampleIndirectCoefficients} from '../src/indirectVolume.ts'
const data=JSON.parse(fs.readFileSync('docs/door-pipeline/resolution.json','utf8')),scene=new Scene(),material=new MeshStandardMaterial()
for(const b of data.boxes){const m=new Mesh(new BoxGeometry(...b.size as[number,number,number]),material);m.position.fromArray(b.position);m.rotation.y=b.rotation;scene.add(m)}scene.updateMatrixWorld(true)
const field=createIndirectField([{id:'room',elevation:0,height:2.8,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:0,y:4}]}]}],0),visibility=createIndirectVisibility(scene)
field.probes.length=0;field.positionData.fill(0)
data.points.forEach((p:any,index:number)=>{const position=new Vector3().fromArray(p.position);field.probes.push({index,position,region:field.regions[0]});writeIndirectPosition(field.positionData,index,position);for(let c=0;c<3;c++)field.coefficients[c][index*4]=DataUtils.toHalfFloat((data.references[index].sky[c]+data.references[index].reflected[c])/.886227)})
const coeff=new Float64Array(12),measurements=data.points.map((p:any,i:number)=>{const support=sampleIndirectCoefficients(field,0,...p.position as[number,number,number],coeff,visibility);return{position:p.position,directReference:data.references[i].sky.map((v:number,c:number)=>v+data.references[i].reflected[c]),blended:[0,1,2].map(c=>Math.max(0,.886227*coeff[c*4]+1.023328*coeff[c*4+1])*Math.min(1,support/.1))}})
fs.writeFileSync('docs/door-pipeline/floor-samples.json',JSON.stringify({count:field.probes.length,measurements,note:'Reference values at all actual floor receivers, encoded as L0 for exact upward irradiance (quantized to production half float). Direct samples are the accuracy bound. The second column still applies the unchanged 3.5m compact kernel and binary visibility; it tests whether representation, rather than missing samples, limits reconstruction.'}))
field.dispose();visibility.dispose();scene.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose()});material.dispose()
