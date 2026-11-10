// CPU-only inventory of repeated placed GLB assets. Counts are before camera
// culling and are an upper bound, not measured viewport draw savings.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
const input=process.argv[2]??'colin_house_v2.json'
const project=JSON.parse(readFileSync(input,'utf8'))
const assets=new Map(readdirSync('src/models/assets').filter(name=>name.endsWith('.glb')).map(name=>[
  name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase(),resolve('src/models/assets',name)]))
const placements=new Map()
for(const model of project.floors.flatMap(f=>f.models??[])){
  const rows=placements.get(model.modelId)??[];rows.push(model);placements.set(model.modelId,rows)
}
const result=[]
for(const [id,instances] of placements){
  if(instances.length<2||!assets.has(id))continue
  const bytes=readFileSync(assets.get(id))
  if(bytes.readUInt32LE(0)!==0x46546c67)continue
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8').trim())
  const groups=new Map(),transparent=[],excluded=[]
  const visit=index=>{
    const node=gltf.nodes[index],mesh=gltf.meshes?.[node.mesh]
    if(mesh)for(const primitive of mesh.primitives){
      const material=gltf.materials?.[primitive.material]??{}
      if(material.alphaMode==='BLEND'||(material.extensions?.KHR_materials_transmission?.transmissionFactor??0)>0){transparent.push(1);continue}
      if(node.skin!==undefined||primitive.targets?.length||gltf.animations?.length||(primitive.mode??4)!==4){excluded.push(1);continue}
      const key=JSON.stringify([primitive.indices,Object.entries(primitive.attributes??{}).sort(([a],[b])=>a.localeCompare(b)),primitive.material])
      groups.set(key,(groups.get(key)??0)+1)
    }
    for(const child of node.children??[])visit(child)
  }
  for(const root of gltf.scenes[gltf.scene??0].nodes)visit(root)
  const compatible=instances.filter(m=>Object.keys(m.materialOverrides??{}).length===0).length
  const before=[...groups.values()].reduce((a,b)=>a+b,0)*compatible
  const after=compatible?groups.size:0
  result.push({id,placements:instances.length,withoutOverrides:compatible,opaquePrimitivesPerPlacement:[...groups.values()].reduce((a,b)=>a+b,0),
    opaquePrimitiveSubmissions:before,idealInstancedSubmissions:after,potentialReduction:before-after,
    transparentPrimitivesPerPlacement:transparent.length,excludedPrimitivesPerPlacement:excluded.length,
    existingWallMountCandidate:/window|door/.test(id)})
}
result.sort((a,b)=>b.potentialReduction-a.potentialReduction)
const report={input,scope:'Upper bound from GLB metadata. Excludes glass, morphs, skins, clips, overrides. Does not account for frustum culling, shear, custom hooks, material changes, or actual runtime batch state.',assets:result}
if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
