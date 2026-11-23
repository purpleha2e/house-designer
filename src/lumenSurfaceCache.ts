import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Triangle, Vector3 } from 'three'
import { boundLumenSources,rasterSurfacePatches } from './lumenSurfacePatches.ts'
import { MeshBVH } from 'three-mesh-bvh'
import { sampleReferenceSurface, type ReferenceSceneData } from './diffuseSceneMaterials.ts'
import type { LumenDistanceField } from './lumenDistanceField.ts'
import { lumenGridDimensions, lumenGridSpacing } from './lumenRegion.ts'

export type SurfaceAtlas = {
  origin: number[]; dimensions: number[]; spacing: number; count: number; width: number; height: number
  boundsLo?:Uint8Array; boundsHi?:Uint8Array; cells: Uint32Array; positions: Float32Array; normals: Float32Array; albedo: Float32Array
  ground?:{bounds:number[];height:number;rho:number[]}
  distanceField?: LumenDistanceField
}
export type AtlasRow = {row:number; positions:Float32Array; normals:Float32Array; albedo:Float32Array}

/** Project the real triangles into a small world-aligned surface atlas. Each
 * occupied cell stores a surface index. Empty space consumes no atlas texels.
 * The full building BVH remains in the worker for exterior sun visibility. */
export function createLumenGeometry(data:ReferenceSceneData){
  const started=performance.now()
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(data.uvs, 2))
  const tree = data.positions.length ? new MeshBVH(geometry) : null
  return {tree,spans:boundLumenSources(data),ms:performance.now()-started,dispose:()=>geometry.dispose()}
}

function projectVolume(data:ReferenceSceneData,tree:MeshBVH|null,dimensions:number[],origin:number[],spacing:number){
  const cells = new Uint32Array(dimensions[0] * dimensions[1] * dimensions[2])
  const collisions=new Uint8Array(cells.length)
  const scores = new Float32Array(cells.length).fill(-Infinity)
  const positions: number[] = [], normals: number[] = [], albedo: number[] = []
  const faces: number[] = [], weights: number[] = []
  const ray = new Ray(), triangle = new Triangle(), bary = new Vector3()
  const cell = [0,0,0]
  for (let axis = 0; tree && axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3
    ray.direction.set(0,0,0).setComponent(axis,-1)
    ray.origin.setComponent(axis,origin[axis] + dimensions[axis] * spacing + .001)
    for (let j = 0; j < dimensions[v]; j++) for (let i = 0; i < dimensions[u]; i++) {
      ray.origin.setComponent(u,origin[u] + (i + .5) * spacing)
      ray.origin.setComponent(v,origin[v] + (j + .5) * spacing)
      for (const hit of tree.raycast(ray,DoubleSide,0,dimensions[axis] * spacing + .001)) {
        if (!hit.face) continue
        cell[u] = i; cell[v] = j
        cell[axis] = Math.floor((hit.point.getComponent(axis) - origin[axis]) / spacing)
        if (cell[axis] < 0 || cell[axis] >= dimensions[axis]) continue
        const address = cell[0] + dimensions[0] * (cell[1] + dimensions[1] * cell[2])
        const face = Math.floor(hit.face.a / 3), tag = data.sourceCategories?.[face] ?? 0
        // Prefer the authored floor finish over the slab a few mm below it.
        // For other surfaces choose the most face-on projection.
        const score = Math.abs(hit.face.normal.getComponent(axis)) + (tag > 0 ? 2 : 0)
          - .01 * Math.abs((hit.point.getComponent(axis) - origin[axis]) / spacing - cell[axis] - .5)
        if(cells[address]){
          const at=(cells[address]-1)*4, m=hit.face.normal
          const dot=m.x*normals[at]+m.y*normals[at+1]+m.z*normals[at+2]
          const gap=Math.abs((hit.point.x-positions[at])*m.x+(hit.point.y-positions[at+1])*m.y+(hit.point.z-positions[at+2])*m.z)
          if(Math.abs(dot)<.94)collisions[address]|=1
          if(positions[at+3]!==data.materialIndices[face])collisions[address]|=2
          if(Math.abs(dot)>=.94 && gap>.012)collisions[address]|=4
        }
        if (scores[address] >= score) continue
        scores[address] = score
        if (!cells[address]) cells[address] = positions.length / 4 + 1
        const at = (cells[address] - 1) * 4
        triangle.a.fromArray(data.positions,face * 9)
        triangle.b.fromArray(data.positions,face * 9 + 3)
        triangle.c.fromArray(data.positions,face * 9 + 6)
        triangle.getBarycoord(hit.point,bary)
        faces[at / 4] = face
        bary.toArray(weights,at / 4 * 3)
        const { rho } = sampleReferenceSurface(data,face,hit.uv?.x ?? 0,hit.uv?.y ?? 0,bary)
        hit.point.toArray(positions,at); positions[at + 3] = data.materialIndices[face]
        hit.face.normal.toArray(normals,at); normals[at + 3] = tag
        for (let channel = 0; channel < 3; channel++) albedo[at + channel] = rho[channel]
        albedo[at + 3] = 1
      }
    }
  }
  const count = positions.length / 4, width = 256, height = Math.max(1,Math.ceil(count / width))
  const pack = (source: number[]) => {
    const values = new Float32Array(width * height * 4)
    values.set(source)
    return values
  }
  const atlas: SurfaceAtlas = { origin, dimensions, spacing, count, width, height, cells,
    positions: pack(positions), normals: pack(normals), albedo: pack(albedo) }
  const conflicts={normal:0,material:0,separatedPlanes:0}
  for(const kind of collisions){
    if(kind&1)conflicts.normal++
    if(kind&2)conflicts.material++
    if(kind&4)conflicts.separatedPlanes++
  }
  return {atlas,faces,weights,conflicts,accounting:undefined}
}

export function buildLumenCache(data:ReferenceSceneData,center:number[],spacing=lumenGridSpacing,aligned=true,geometry=createLumenGeometry(data),viewProjection?:number[]){
  const started=performance.now()
  const {tree}=geometry
  const dimensions = lumenGridDimensions
  const origin = center.map((v, i) => (Math.floor(v / spacing) - dimensions[i] / 2) * spacing)
  const {atlas:projected,faces,weights,conflicts,accounting}=aligned ? rasterSurfacePatches(data,origin,dimensions,spacing,geometry.spans,viewProjection) : projectVolume(data,tree,dimensions,origin,spacing)
  const atlas:SurfaceAtlas=projected
  const {count,width,height}=atlas
  // The editor's ground is a finite horizontal rectangle, often extending
  // well beyond the camera cache. Preserve the authored diffuse response.
  const ground={bounds:[Infinity,Infinity,-Infinity,-Infinity],height:0,rho:[0,0,0]}
  for(let f=0;f<data.materialIndices.length;f++)if(data.sourceCategories?.[f]===3){
    ground.height=data.positions[f*9+1];ground.rho=sampleReferenceSurface(data,f,0,0,new Vector3(1,0,0)).rho
    for(let j=f*9;j<f*9+9;j+=3){const x=data.positions[j],z=data.positions[j+2]
      ground.bounds[0]=Math.min(ground.bounds[0],x);ground.bounds[1]=Math.min(ground.bounds[1],z)
      ground.bounds[2]=Math.max(ground.bounds[2],x);ground.bounds[3]=Math.max(ground.bounds[3],z)}
  }
  if(Number.isFinite(ground.bounds[0]))atlas.ground=ground
  const ray=new Ray(),bary=new Vector3()
  const buildMs = performance.now() - started
  const normal = new Vector3()
  let previousDirection = ''
  const visibility = new Float32Array(count), dirtyRows=new Set<number>()
  const updateMaterials = (next: ReferenceSceneData) => {
    if (data.positions.length !== next.positions.length || !data.positions.every((p,i) => p === next.positions[i])) return false
    if(aligned){
      if(data.sourceIds?.some((v,i)=>v!==next.sourceIds?.[i]))return false
      const renames=new Map<number,number>()
      for(let i=0;i<data.materialIndices.length;i++){
        const old=data.materialIndices[i],current=next.materialIndices[i]
        if(!renames.has(old))renames.set(old,current)
        else if(renames.get(old)!==current)return false
        if((data.sourceCategories?.[i]===3)!==(next.sourceCategories?.[i]===3))return false
      }
    }
    data = next
    dirtyRows.clear()
    faces.forEach((face,i) => {
      bary.fromArray(weights,i*3)
      const uv = (c: number) => data.uvs[face*6+c]*bary.x + data.uvs[face*6+c+2]*bary.y + data.uvs[face*6+c+4]*bary.z
      const {rho} = sampleReferenceSurface(data,face,uv(0),uv(1),bary)
      if(atlas.positions[i*4+3]===data.materialIndices[face] && atlas.normals[i*4+3]===(data.sourceCategories?.[face]??0)
        && rho.every((value,c)=>atlas.albedo[i*4+c]===Math.fround(value))) return
      dirtyRows.add(Math.floor(i/width))
      atlas.albedo.set(rho,i*4)
      atlas.positions[i*4+3] = data.materialIndices[face]
      atlas.normals[i*4+3] = data.sourceCategories?.[face] ?? 0
    })
    return true
  }
  const materialRows=():AtlasRow[]=>Array.from(dirtyRows,row=>{
    const start=row*width*4,end=start+width*4
    return {row,positions:atlas.positions.slice(start,end),normals:atlas.normals.slice(start,end),albedo:atlas.albedo.slice(start,end)}
  })
  const light = (direction: number[], irradiance: number[]) => {
    const start = performance.now(), radiance = new Float32Array(width * height * 4)
    ray.direction.fromArray(direction).normalize()
    const key = ray.direction.toArray().join(','), reuseVisibility = key === previousDirection
    previousDirection = key
    const sunEnabled = irradiance.some(c => c > 0)
    let lit = 0, litCarpet = 0
    for (let i = 0; tree && i < count; i++) {
      const at = i * 4
      if (!reuseVisibility) {
        normal.fromArray(atlas.normals,at)
        const cosine = normal.dot(ray.direction)
        // A thin opaque surface can have two different lighting hemispheres.
        // Store the sunlit side so fallback hits on its reverse return zero.
        ray.origin.fromArray(atlas.positions,at).addScaledVector(normal,.001 * Math.sign(cosine))
        visibility[i] = Math.abs(cosine) < .0001 || tree.raycastFirst(ray,DoubleSide,.0001,200) ? 0 : cosine
      }
      const cosine = visibility[i]
      if (!cosine || !sunEnabled) continue
      for (let c = 0; c < 3; c++) radiance[at+c] = atlas.albedo[at+c] * irradiance[c] * Math.abs(cosine) / Math.PI
      radiance[at+3] = Math.sign(cosine)
      lit++
      if (atlas.normals[at+3] === 2) litCarpet++
    }
    return { radiance, lit, litCarpet, ms:performance.now()-start }
  }
  return { atlas, buildMs, conflicts, accounting, bvhMs:geometry.ms, light, updateMaterials, materialRows, dispose: () => geometry.dispose() }
}
