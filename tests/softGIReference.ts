import fs from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Vector3} from 'three'
import {readDoorInput} from './doorPipelineInput.mjs'
import {createSceneLightingReference} from './sceneLightingReference.ts'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {sampleBakedIndirectFloor} from '../src/indirectFloorLighting.ts'
const input=readDoorInput(),reference=createSceneLightingReference(input.reference),loaded=await loadIndirectLighting(JSON.parse(fs.readFileSync('docs/door-confidence/original-field.json','utf8')),{reflections:false,allowLegacy:true}),field=loaded!.field,points=[]
for(const x of [3.45,3.85,4.25,4.65,5.05,5.45])for(const z of [14.8,15.2,15.6,16]){
 const position=[x,.012,z],p={name:`stairs-${x}-${z}`,position,normal:[0,1,0],geometricNormal:[0,1,0]},r=reference.evaluate(p,16384,6,1234)
 points.push({...p,reference:r});console.log(p.name)
}
const comparisons=[]
for(const name of ['baseline','5cm','10cm','20cm']){field.floorLayer.data=new Uint16Array(Uint8Array.from(gunzipSync(fs.readFileSync(`docs/soft-gi/original/${name}.rgba16f.gz`))).buffer);comparisons.push({name,values:points.map(p=>sampleBakedIndirectFloor(field,0,new Vector3(p.position[0],.016,p.position[2]),new Vector3(0,1,0)).rgb)})}
fs.writeFileSync('docs/soft-gi/staircase-reference.json',JSON.stringify({points,comparisons,note:'Sparse supplemental reference for the staircase; uniform grid includes heavily occluded positions. Report these separately from the retained door grid. No probe/capture/SH-order experiment.'}));reference.dispose();field.dispose()
