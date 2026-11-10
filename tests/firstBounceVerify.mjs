import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {BufferAttribute,Triangle,Vector3} from 'three'
import {createIndirectVisibilityFromSnapshot} from '../src/indirectVisibility.ts'
import {readGatherInput} from './localFinalGatherInput.mjs'
import {readFirstBounceInput} from './firstBounceTextures.mjs'
import {mapSunTriangles} from './firstBounceMapping.ts'
import {createSunHitMaterials,createSunSurfaceQuery,createDirectSunRadiance} from './firstBounceSun.ts'
import {gatherLocalIndirect} from './localFinalGather.ts'
import {createSceneLightingReference} from './sceneLightingReference.ts'
if(!process.argv.includes('--first-bounce-sun'))throw Error('Diagnostic opt-in required')
const root='docs/first-bounce-sun',loaded=await readFirstBounceInput('docs/sunlit-bounce/scene-input.bin.gz',fs.mkdtempSync('tmp/first-bounce-textures-')),d=loaded.data,r=d.reference
process.once('exit',()=>loaded.close())
const {data:tagged}=await readGatherInput('docs/sunlit-bounce/reference-input.bin.gz',p=>p==='reference.sourceCategories'),categories=tagged.reference.sourceCategories,owners=new Uint32Array(r.materialIndices.length),records=[]
let cursor=0,owner=0
for(let part=0;part<d.geometry.length;part++)for(let instance=0;instance<d.geometry[part].matrices.length;instance++){const count=d.geometry[part].ranges.reduce((s,g)=>s+Math.floor(g.count/3),0);owners.fill(owner,cursor,cursor+count);records.push({owner,part,instance,start:cursor,count});cursor+=count;owner++}
const visibility=createIndirectVisibilityFromSnapshot(d.geometry),mapped=mapSunTriangles(visibility.snapshot().positions.subarray(0,cursor*9),r.positions,r.materialIndices,r.uvs,Uint8Array.from(categories,c=>c===1?1:0),.000005,r.materials),meta={...r,owners,textures:loaded.textures,triangleMap:mapped.mapping,legacyOpaqueDoubleSide:true},resolve=createSunHitMaterials(meta),query=createSunSurfaceQuery(visibility,resolve)
const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex')
function glb(file){const fd=fs.openSync(file,'r');try{const h=Buffer.alloc(20);fs.readSync(fd,h,0,20,0);if(h.readUInt32LE(0)!==0x46546c67)return;const body=Buffer.alloc(h.readUInt32LE(12));fs.readSync(fd,body,0,body.length,20);return{file,json:JSON.parse(body.toString()),bin:28+body.length}}finally{fs.closeSync(fd)}}
const assets=fs.readdirSync('src/models/assets',{recursive:true}).filter(p=>p.endsWith('.glb')).map(p=>glb(path.join('src/models/assets',p))).filter(Boolean)
function assetFor(part){
 const attribute=new BufferAttribute(part.position,part.stride,part.normalized),count=part.position.length/part.stride,packed=new Float32Array(count*3)
 for(let i=0;i<count;i++)for(let k=0;k<3;k++)packed[i*3+k]=attribute.getComponent(i,part.offset+k)
 const expected=digest(Buffer.from(packed.buffer))
 for(const asset of assets)for(let index=0;index<(asset.json.accessors?.length??0);index++){
  const positionAccessors=new Set((asset.json.meshes??[]).flatMap(mesh=>mesh.primitives.map(p=>p.attributes.POSITION)))
  const accessor=asset.json.accessors[index];if(!positionAccessors.has(index)||accessor.type!=='VEC3'||accessor.componentType!==5126||accessor.count!==count||accessor.bufferView===undefined)continue
  const view=asset.json.bufferViews[accessor.bufferView],stride=view.byteStride??12,fd=fs.openSync(asset.file,'r'),bytes=Buffer.alloc((count-1)*stride+12),positions=new Float32Array(count*3)
  try{fs.readSync(fd,bytes,0,bytes.length,asset.bin+(view.byteOffset??0)+(accessor.byteOffset??0))}finally{fs.closeSync(fd)}
  for(let i=0;i<count;i++)for(let k=0;k<3;k++)positions[i*3+k]=bytes.readFloatLE(i*stride+k*4)
  if(digest(Buffer.from(positions.buffer))===expected)return{path:asset.file.replaceAll('\\','/'),positionAccessor:index,vertices:count,sha256:digest(fs.readFileSync(asset.file))}
 }
 return null
}
let textured;const paired=[]
try{
 for(const entry of records){
  if(entry.count<500||d.geometry[entry.part].structural)continue
  const indices=[];for(let t=entry.start;t<entry.start+entry.count;t++){const reference=mapped.mapping[t];if(reference>=0&&r.materials[r.materialIndices[reference]].map>=0)indices.push(reference);if(indices.length>=100)break}
  if(!indices.length)continue
  const asset=assetFor(d.geometry[entry.part]);if(!asset)continue
  for(const t of indices){const tri=new Triangle(new Vector3().fromArray(r.positions,t*9),new Vector3().fromArray(r.positions,t*9+3),new Vector3().fromArray(r.positions,t*9+6)),p=tri.getMidpoint(new Vector3()),n=tri.getNormal(new Vector3()),h=query.hit(p.clone().addScaledVector(n,.0005),n.clone().negate(),.002,.000001);if(!h)continue;const m=query.material(h,n.clone().negate());if(!m.valid||m.owner!==entry.owner||r.materials[m.materialId].map<0)continue;textured={name:'Textured imported glTF mesh',asset,owner:entry.owner,part:entry.part,primitive:m.primitiveTriangle,referenceTriangle:m.triangle,materialId:m.materialId,barycentric:m.barycentric,uv:m.uv,rho:m.rho,position:h.point.toArray(),material:r.materials[m.materialId],valid:true};break}
  if(textured)break
 }
 for(const point of d.points){
  const identity={geometry:1,lighting:1,source:'surface-sun',bounces:1},sun=createDirectSunRadiance({query,sunDirection:r.sunDirection,sunIrradiance:r.sunIrradiance,daylightGain:r.daylightGain,identity})
  const result=gatherLocalIndirect({enabled:true,receiver:point,rays:4096,seed:20261106,identity,visibility:query,lookup:sun.lookup,observe(index,rgb,hit,direction){const triangle=hit?mapped.mapping[Math.floor(hit.face.a/3)]:null;paired.push({receiver:point.name,index,direction:direction.toArray(),radiance:rgb,triangle,duvet:triangle!==null&&categories[triangle]===1})}})
  if(result.state!=='ready')throw Error('High-count paired check encountered unsupported samples: '+point.name)
 }
}finally{visibility.dispose()}
if(!textured)throw Error('Could not verify a textured imported asset against its frozen geometry')
fs.writeFileSync(root+'/textured-import-mapping.json',JSON.stringify(textured,null,2))
const bed=assets.find(a=>a.file.endsWith('king_bed.glb'))
fs.writeFileSync(root+'/duvet-material-audit.json',JSON.stringify({asset:bed.file,sha256:digest(fs.readFileSync(bed.file)),materials:bed.json.materials.map(m=>({name:m.name,alphaMode:m.alphaMode??'OPAQUE',doubleSided:m.doubleSided??false,pbr:m.pbrMetallicRoughness,normalMap:!!m.normalTexture})),sourceTriangles:categories.reduce((s,c)=>s+(c===1?1:0),0)},null,2))
fs.writeFileSync(root+'/paired-directions-4096.json',JSON.stringify(paired))
const reference=createSceneLightingReference({...r,textures:loaded.referenceTextures,sourceCategories:categories,skyBase:[0,0,0],skySun:[0,0,0],lights:[]}),checks=[]
try{
 for(const point of d.points){const rows=paired.filter(p=>p.receiver===point.name),origin=new Vector3().fromArray(point.position).addScaledVector(new Vector3().fromArray(point.geometricNormal).normalize(),.0002),truth=reference.incoming(origin.toArray(),rows.map(r=>r.direction),1,0,11,true,1);let max=0,duvetMismatch=0,differentPrimitive=0
  for(let i=0;i<rows.length;i++){const h=truth[i].firstHit;if(rows[i].triangle!==(h?.triangle??null))differentPrimitive++;if(rows[i].duvet!==(h?categories[h.triangle]===1:false))duvetMismatch++;for(let c=0;c<3;c++)max=Math.max(max,Math.abs((rows[i].radiance?.[c]??0)-truth[i].firstPass[c]))}
  checks.push({receiver:point.name,evaluations:rows.length,distinctNestedDirections:rows.length,maxRadianceDifference:max,differentPrimitiveIndices:differentPrimitive,duvetTagMismatches:duvetMismatch});console.log(JSON.stringify(checks.at(-1)))
 }
}finally{reference.dispose();loaded.close()}
if(checks.some(c=>c.maxRadianceDifference>1e-10||c.duvetTagMismatches))throw Error('Paired first-hit validation failed')
fs.writeFileSync(root+'/paired-verification.json',JSON.stringify({checks,texturedImportedObjectVerified:true,sourceAndBounce:'direct surface sunlight, exactly one diffuse reflection',scope:'explicit frozen opaque/double-sided reference material model'},null,2))
