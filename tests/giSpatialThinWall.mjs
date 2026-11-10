import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {BoxGeometry,DataUtils,Mesh,MeshStandardMaterial,Scene,Vector3} from 'three'
import {createIndirectField} from '../src/indirectLighting.ts'
import {createIndirectVisibility} from '../src/indirectVisibility.ts'
import {sampleIndirectCoefficients} from '../src/indirectVolume.ts'
import {sampleBakedIndirectFloor,writeIndirectFloorLayer} from '../src/indirectFloorLighting.ts'
const field=createIndirectField([{id:'room',elevation:0,height:2.8,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:0,y:4}]}]}],0),scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry(.006,2.8,4)
const step=field.bounds.size/(field.floorLayer.n-1),left=field.bounds.minX+Math.round((2.5-field.bounds.minX)/step)*step,wallX=left+step/2,wall=new Mesh(geometry,material)
wall.position.set(wallX,1.4,2);scene.add(wall);field.probes.splice(2);field.positionData.fill(0)
field.probes.forEach((p,i)=>{p.position.set(i?3.7:2,.25,2);p.position.toArray(field.positionData,p.index*4);field.positionData[p.index*4+3]=1;field.coefficients.forEach(c=>c[p.index*4]=DataUtils.toHalfFloat((i?1:.1)/.886227))})
const mask=field.mask.image.data;for(let i=0;i<mask.length;i+=4)if(mask[i]){mask[i+1]=255;mask[i+2]=255}
const visibility=createIndirectVisibility(scene),receiver=new Vector3(wallX-.004,.016,2),values=new Float64Array(12),results=[]
try{
 for(const mode of ['legacy','occluder-local']){
  field.spatialInterpolation=mode;const support=sampleIndirectCoefficients(field,0,receiver.x,receiver.y,receiver.z,values,visibility),exact=values[0]*.886227
  writeIndirectFloorLayer(field,visibility);const filtered=sampleBakedIndirectFloor(field,0,receiver,new Vector3(0,1,0)).rgb[0]
  assert.ok(Math.abs(exact-.1)<.001,'exact links reject the bright far-side probe')
  assert.ok(filtered>exact+.1,'known limitation: hardware-equivalent filtering still crosses a thinner-than-grid wall')
  results.push({mode,exactReceiverIrradiance:exact,filteredFloorIrradiance:filtered,support})
 }
 writeFileSync('docs/gi-spatial-accuracy/thin-wall.json',JSON.stringify({wallThickness:.006,floorStep:step,wallX,receiver:receiver.toArray(),results,decision:'Known accuracy failure retained: exact per-texel links do not prevent filtering two valid texels across sub-grid solid geometry. The furniture-local flag does not fix it and remains off by default.'},null,2));console.log('REPRODUCED unresolved thin-wall filtering',JSON.stringify(results))
}finally{field.dispose();visibility.dispose();geometry.dispose();material.dispose()}
