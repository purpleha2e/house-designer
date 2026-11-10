// node --experimental-strip-types tests/doorConfidenceRadiometric.ts
import fs from 'node:fs'
import {BoxGeometry,DataUtils,Group,Mesh,MeshStandardMaterial,Vector3} from 'three'
import {createIndirectField} from '../src/indirectLighting.ts'
import {createIndirectVisibility} from '../src/indirectVisibility.ts'
import {createDoorConfidenceSampler} from './doorVisibilityConfidence.ts'
import {createSceneLightingReference,type ReferenceSceneData} from './sceneLightingReference.ts'

const results=[]
for(const kind of ['open-room','broad-door','narrow-door','closed-door','thin-wall','window','cabinet','cushion-gap','table-leg','stairwell','slab']){
 const field=createIndirectField([{id:'ground',elevation:0,height:3,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:0,y:4}]}]}],0)
 const scene=new Group(),material=new MeshStandardMaterial({color:0xcccccc}),geometries:BoxGeometry[]=[]
 const box=(p:number[],size:number[])=>{const g=new BoxGeometry(...size as[number,number,number]),m=new Mesh(g,material);m.position.fromArray(p);scene.add(m);geometries.push(g)}
 box([2.5,-.05,2],[5,.1,4])
 if(kind==='thin-wall')box([2.5,1.5,2],[.006,3,4])
 if(kind==='closed-door')box([2.5,1,2],[.035,2,1])
 if(['broad-door','narrow-door','window'].includes(kind)){
  const gap=kind==='narrow-door'?.03:1
  box([2.5,1.5,(2-gap/2)/2],[.035,3,2-gap/2]);box([2.5,1.5,3+gap/4],[.035,3,2-gap/2])
  if(kind==='window')box([2.5,.4,2],[.035,.8,gap])
 }
 if(kind==='cabinet')box([2.5,.55,2],[.8,1,.8])
 if(kind==='cushion-gap'){box([2.5,.3,1.7],[.2,.6,.55]);box([2.5,.3,2.3],[.2,.6,.55])}
 if(kind==='table-leg')box([2.5,.4,2],[.04,.8,.04])
 if(kind==='slab')box([2.5,1.5,2],[5,.1,4])
 if(kind==='stairwell'){box([.6,1.5,2],[1.2,.1,4]);box([4.4,1.5,2],[1.2,.1,4])}
 scene.updateMatrixWorld(true)
 const positions:number[]=[],v=new Vector3()
 scene.traverse(o=>{if(o instanceof Mesh){const g=o.geometry;for(let i=0;i<(g.index?.count??g.attributes.position.count);i++){v.fromBufferAttribute(g.attributes.position,g.index?.getX(i)??i).applyMatrix4(o.matrixWorld);positions.push(v.x,v.y,v.z)}}})
 const data:ReferenceSceneData={positions:new Float32Array(positions),uvs:new Float32Array(positions.length/3*2),materialIndices:new Uint16Array(positions.length/9),materials:[{color:material.color.toArray(),metalness:0,map:-1,matrix:[1,0,0,0,1,0,0,0,1],wrapS:1001,wrapT:1001}],textures:[],skyBase:[.65,.72,.82],skySun:[0,0,0],skyMode:'clear',sunDirection:[.3,1,.2],sunIrradiance:[3,3,3],daylightGain:1,lights:[]}
 const reference=createSceneLightingReference(data),visibility=createIndirectVisibility(scene),vertical=kind==='slab'||kind==='stairwell',y=vertical?1.016:kind==='window'?1.4:.016
 field.probes.splice(2);field.positionData.fill(0)
 const measurements=field.probes.map((p,i)=>{
  p.position.set(vertical?2:i?3.5:1.5,vertical?(i?2:1):kind==='window'?1.4:.18,2);p.position.toArray(field.positionData,p.index*4);field.positionData[p.index*4+3]=1
  const result=reference.evaluate({name:'probe-'+i,position:p.position.toArray(),normal:[0,1,0],geometricNormal:[0,1,0]},16384,6,1234)
  const irradiance=result.sky.map((v,c)=>v+result.reflected[c]);field.coefficients.forEach((a,c)=>a[p.index*4]=DataUtils.toHalfFloat(irradiance[c]/.886227))
  return{position:p.position.toArray(),result}
 })
 const sampler=createDoorConfidenceSampler(field,visibility),points=[]
 for(const x of [2.1,2.3,2.4,2.6,2.7,2.9])for(const z of [1.9,2,2.1]){
  const position=[x,y,z],result=sampler.sample(position),ref=reference.evaluate({name:`${x}-${z}`,position:[x,y-.004,z],normal:[0,1,0],geometricNormal:[0,1,0]},8192,6,1234)
  points.push({...result,reference:ref})
 }
 results.push({kind,measurements,points,counters:sampler.counters})
 reference.dispose();visibility.dispose();field.dispose();material.dispose();geometries.forEach(g=>g.dispose())
 console.log('completed',kind)
}
fs.mkdirSync('docs/door-confidence',{recursive:true})
fs.writeFileSync('docs/door-confidence/radiometric-regressions.json',JSON.stringify({note:'Synthetic floor interpolation fixtures: two L1 probes with L0 chosen to match independently measured upward irradiance. This isolates spatial interpolation; it is not a production transport bake.',results}))
