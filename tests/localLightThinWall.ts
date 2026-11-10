import assert from 'node:assert/strict'
import fs from 'node:fs'
import {BoxGeometry,DataUtils,Mesh,MeshStandardMaterial,Scene,Vector3} from 'three'
import {createIndirectField} from '../src/indirectLighting.ts'
import {createIndirectVisibility} from '../src/indirectVisibility.ts'
import {writeIndirectFloorLayer,sampleBakedIndirectFloor} from '../src/indirectFloorLighting.ts'
import {createLocalLightSampler,localDefinitions} from './localLightReconstruction.ts'
if(!process.argv.includes('--diagnostic-local-light'))throw Error('Diagnostic opt-in required')
const field=createIndirectField([{id:'room',elevation:0,height:2.8,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:0,y:4}]}]}],0),scene=new Scene(),geometry=new BoxGeometry(.006,2.8,4),material=new MeshStandardMaterial()
const step=field.bounds.size/(field.floorLayer.n-1),left=field.bounds.minX+Math.round((2.5-field.bounds.minX)/step)*step,wallX=left+step/2,wall=new Mesh(geometry,material)
wall.position.set(wallX,1.4,2);scene.add(wall);field.probes.splice(4);field.positionData.fill(0)
field.probes.forEach((p,i)=>{p.position.set(i<2?2:3.7,.25,i%2?2.1:1.9);p.position.toArray(field.positionData,p.index*4);field.positionData[p.index*4+3]=1;field.coefficients.forEach(c=>c[p.index*4]=DataUtils.toHalfFloat((i<2?.1:1)/.886227))})
const mask=field.mask.image.data as Uint8Array;for(let i=0;i<mask.length;i+=4)if(mask[i]){mask[i+1]=255;mask[i+2]=255}
const visibility=createIndirectVisibility(scene),sampler=createLocalLightSampler(field,visibility,true),position=[wallX-.004,.016,2],exact=sampler.sample(position)
for(const key of localDefinitions){const q=exact.variants[key];assert.ok(q.candidates.every(p=>!p.visible||p.position[0]<wallX));for(const mode of ['production','conservative','maskedRGB'] as const)assert.ok(Math.abs(q[mode][0]-.1)<.001)}
writeIndirectFloorLayer(field,visibility)
const filtered=sampleBakedIndirectFloor(field,0,new Vector3().fromArray(position),new Vector3(0,1,0)).rgb
assert.ok(filtered[0]>.2,'Preserve detection of existing sub-grid hardware filtering leak')
fs.writeFileSync('docs/local-light/thin-wall.json',JSON.stringify({wallThickness:.006,step,wallX,position,exact,productionFiltered:filtered,decision:'Exact links reject cross-wall probes. Existing linear texture filtering leaks across a 6 mm wall; none of these selectors addresses that stage. Not a passed end-to-end leak test.'},null,2))
console.log('6mm exact gates pass; retained hardware filtering failure',filtered)
visibility.dispose();field.dispose();geometry.dispose();material.dispose()
