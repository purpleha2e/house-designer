import fs from 'node:fs'
import assert from 'node:assert/strict'
import {BoxGeometry,DataUtils,Group,Mesh,MeshStandardMaterial,Vector3} from 'three'
import {createIndirectField} from '../src/indirectLighting.ts'
import {createIndirectVisibility} from '../src/indirectVisibility.ts'
import {indirectSHRadianceBasis} from '../src/indirectSH.ts'
import {createSceneLightingReference,type ReferenceSceneData} from './sceneLightingReference.ts'
import {createLocalLightSampler,localDefinitions} from './localLightReconstruction.ts'
if(!process.argv.includes('--diagnostic-local-light'))throw Error('Diagnostic opt-in required')
const out='docs/local-light';fs.mkdirSync(out,{recursive:true})
const configurations=['closed','narrow','medium','open','thin-wall','cabinet','underside','slab','stairwell']
const results=[]
for(const kind of configurations){
 const started=performance.now(),scene=new Group(),material=new MeshStandardMaterial({color:0xaaaaaa}),geometries:BoxGeometry[]=[]
 const box=(position:number[],size:number[])=>{const g=new BoxGeometry(...size as [number,number,number]),m=new Mesh(g,material);m.position.fromArray(position);scene.add(m);geometries.push(g)}
 box([4,-.05,2],[8,.1,4]);box([4,3.05,2],[8,.1,4]);box([-.05,1.5,2],[.1,3,4]);box([8.05,1.5,2],[.1,3,4]);box([4,1.5,-.05],[8,3,.1]);box([4,1.5,4.05],[8,3,.1])
 const opening=kind==='closed'||kind==='thin-wall'?0:kind==='narrow'?.06:kind==='medium'?.6:1.6
 const thickness=kind==='thin-wall'?.006:.1
 if(!opening)box([4,1.5,2],[thickness,3,4])
 else {box([4,1.5,(2-opening/2)/2],[thickness,3,2-opening/2]);box([4,1.5,3+opening/4],[thickness,3,2-opening/2]);box([4,2.6,2],[thickness,.8,opening])}
 if(kind==='cabinet')box([6.5,.55,3.5],[2,1.1,1])
 if(kind==='underside')box([6,.65,2],[2,.15,2])
 if(kind==='slab')box([6,1.2,2],[3,.1,4])
 if(kind==='stairwell')for(let i=0;i<6;i++)box([5+i*.4,.3+i*.25,2],[.4,.12,2])
 scene.updateMatrixWorld(true)
 const positions:number[]=[],v=new Vector3()
 scene.traverse(o=>{if(o instanceof Mesh){const g=o.geometry;for(let i=0;i<(g.index?.count??g.attributes.position.count);i++){v.fromBufferAttribute(g.attributes.position,g.index?.getX(i)??i).applyMatrix4(o.matrixWorld);positions.push(v.x,v.y,v.z)}}})
 const data:ReferenceSceneData={positions:new Float32Array(positions),uvs:new Float32Array(positions.length/3*2),materialIndices:new Uint16Array(positions.length/9),materials:[{color:material.color.toArray() as [number,number,number],metalness:0,map:-1,matrix:[1,0,0,0,1,0,0,0,1],wrapS:1001,wrapT:1001}],textures:[],skyBase:[0,0,0],skySun:[0,0,0],skyMode:'clear',sunDirection:[0,1,0],sunIrradiance:[0,0,0],daylightGain:1,lights:[{position:[2,2.5,2],color:[1,1,1],intensity:8,distance:0,decay:2}]}
 const reference=createSceneLightingReference(data),visibility=createIndirectVisibility(scene),field=createIndirectField([{id:'rooms',elevation:0,height:3,rooms:[{signature:'open-plan',polygon:[{x:0,y:0},{x:8,y:0},{x:8,y:4},{x:0,y:4}]}]}],0)
 const probePositions:number[][]=[]
 for(const x of [1,2.5,3.5,4.5,5.5,7])for(const z of [.7,2,3.3])for(const y of [.18,1.6]){
  // Geometry-defined rejection of interior probes; identical for all candidates.
  if(kind==='cabinet'&&x>=5.5&&z>=3&&y<1.1)continue
  probePositions.push([x,y,z])
 }
 const region=field.probes[0].region
 field.probes.splice(0,field.probes.length,...probePositions.map((p,index)=>({index,position:new Vector3().fromArray(p),region})))
 field.positionData.fill(0);field.coefficients.forEach(a=>a.fill(0))
 const directions=Array.from({length:256},(_,i)=>{const y=1-2*(i+.5)/256,r=Math.sqrt(1-y*y),theta=i*Math.PI*(3-Math.sqrt(5));return[r*Math.cos(theta),y,r*Math.sin(theta)]})
 const probeStart=performance.now()
 for(const p of field.probes){
  p.position.toArray(field.positionData,p.index*4);field.positionData[p.index*4+3]=1
  const incoming=reference.incoming(p.position.toArray(),directions,32,6,700+p.index*1009,false,6)
  for(let c=0;c<3;c++)for(let k=0;k<4;k++)field.coefficients[c][p.index*4+k]=DataUtils.toHalfFloat(incoming.reduce((s,q,i)=>s+q.radiance[c]*indirectSHRadianceBasis(new Vector3().fromArray(directions[i]),1)[k]*4*Math.PI/directions.length,0))
 }
 const probeCaptureMs=performance.now()-probeStart,sampler=createLocalLightSampler(field,visibility,true),points=[]
 for(const x of [2.5,3.25,3.75,3.9,4.1,4.25,4.75,5.5,6.5,7.5])for(const z of [1.75,2,2.25,3.8]){
  const position=[x,.016,z],r=reference.evaluate({name:`${kind}-${x}-${z}`,position:[x,.012,z],normal:[0,1,0],geometricNormal:[0,1,0]},8192,6,1234,6)
  const result=sampler.sample(position)
  if(!opening)for(const definition of localDefinitions){const q=result.variants[definition];assert.ok(q.candidates.every(p=>!p.visible||(p.position[0]<4)===(x<4)),'Closed barrier must block every cross-wall link');if(x>4)assert.ok(q.maskedRGB.every(v=>v===0),'Dark closed room must remain black')}
  points.push({name:r.name,side:x<4?'bright':'dark',reference:r,referenceRGB:r.sky.map((v,c)=>v+r.reflected[c]),...result})
 }
 const record={kind,opening,thickness,points,probes:sampler.probes,probeCaptureMs,counters:sampler.counters,elapsedMs:performance.now()-started}
 results.push(record);fs.writeFileSync(`${out}/rooms-${kind}.json`,JSON.stringify(record));console.log('controlled',kind,'complete',record.elapsedMs)
 reference.dispose();visibility.dispose();field.dispose();material.dispose();geometries.forEach(g=>g.dispose())
}
fs.writeFileSync(`${out}/rooms.json`,JSON.stringify({method:'Six-encounter diffuse path projected to L1 once per configuration (256 sphere directions x 32 paths); independent cosine hemisphere receiver reference (8192 paths), no probe interpolation. Reconstruction-only experiment, not production transport validation.',results}))

