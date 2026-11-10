import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {DataUtils,PerspectiveCamera,Raycaster,Vector2,Vector3} from 'three'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {sampleBakedIndirectFloor} from '../src/indirectFloorLighting.ts'
const root='docs/colin-contact-shading/verified',width=999,height=740
const hdr=(view,mode)=>{const b=gunzipSync(readFileSync(`${root}/${view}/${mode}.rgba16f.gz`));return new Uint16Array(b.buffer,b.byteOffset,b.length/2)},pixel=(data,x,y)=>[0,1,2].map(c=>DataUtils.fromHalfFloat(data[((height-1-y)*width+x)*4+c]))
const field=(await loadIndirectLighting(JSON.parse(readFileSync('docs/gi-spatial-accuracy/baseline/field-cache.json')),{reflections:false})).field
try{
 const view=JSON.parse(readFileSync(`${root}/cameras.json`)).find(v=>v.id==='table-legs'),camera=new PerspectiveCamera(65,width/height,.01,100);camera.position.fromArray(view.position);camera.lookAt(new Vector3().fromArray(view.lookAt));camera.updateMatrixWorld(true)
 const image=hdr('table-legs','no-ao-no-probes'),normals=hdr('table-legs','normals'),ray=new Raycaster(),samples=[]
 for(const [x,y]of [[333,630],[320,640],[300,640],[350,640],[280,640],[330,660],[330,610],[360,610],[665,369],[690,375],[640,390]]){
  const normal=pixel(normals,x,y);if(Math.abs(normal[1]-1)>.01)continue
  ray.setFromCamera(new Vector2((x+.5)/width*2-1,1-(y+.5)/height*2),camera);const p=ray.ray.at((.012-ray.ray.origin.y)/ray.ray.direction.y,new Vector3()),sample=sampleBakedIndirectFloor(field,0,p,new Vector3(0,1,0)),predicted=sample.rgb.map(v=>(v+.18)*.8/Math.PI),actual=pixel(image,x,y)
  const layer=field.floorLayer,gx=(p.x-field.bounds.minX)/field.bounds.size*(layer.n-1),gz=(p.z-field.bounds.minZ)/field.bounds.size*(layer.n-1),taps=[]
  for(let dz=0;dz<2;dz++)for(let dx=0;dx<2;dx++){
   const ix=Math.floor(gx)+dx,iz=Math.floor(gz)+dz,offset=(iz*layer.height*field.coefficientCount*layer.n+ix)*4,alpha=DataUtils.fromHalfFloat(layer.data[offset+3]),e=[0,1,2].map(c=>(DataUtils.fromHalfFloat(layer.data[offset+c])*.886227+DataUtils.fromHalfFloat(layer.data[offset+layer.height*layer.n*4+c])*1.023328)/Math.max(alpha,.00001))
   taps.push({coordinate:[ix,0,iz],position:[field.bounds.minX+ix/(layer.n-1)*field.bounds.size,.016,field.bounds.minZ+iz/(layer.n-1)*field.bounds.size],coverage:alpha,weight:(dx?gx%1:1-gx%1)*(dz?gz%1:1-gz%1),irradiance:e})
  }
  samples.push({pixel:[x,y],position:p.toArray(),coverage:sample.coverage,irradiance:sample.rgb,taps,predictedDiffuseHDR:predicted,actualHDR:actual,maxReconstructionError:Math.max(...actual.map((v,c)=>Math.abs(v-predicted[c])))})
 }
 const sofaSamples=[]
 for(const [name,x,y]of [['seat-back dark seam',500,455],['right dark back panel',778,430],['supported cushion',750,400]]){
  const values=Object.fromEntries(['baseline','no-ao','no-shadows','no-gi','small-bias','support','classification'].map(m=>[m,pixel(hdr('sofa-rear',m),x,y)]));sofaSamples.push({name,pixel:[x,y],values})
 }
 assert.ok(samples.length>=8)
 const result={sameCompletedCache:true,productionSourceChanged:false,method:'CPU bilinear SH sampling of the retained floor field; white diffuse response (E + .18) * .8 / pi; independently reproduces the display values without AO, shadows, material maps or probe spheres. This is an operator attribution, not a physical path-tracing reference.',floor:samples,sofa:sofaSamples,maxFloorReconstructionError:Math.max(...samples.map(s=>s.maxReconstructionError))}
 assert.ok(result.maxFloorReconstructionError<.0005,'Saved floor field must reproduce the rendered floor without screen-space effects')
 writeFileSync('docs/colin-contact-shading/field-attribution.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{field.dispose()}
