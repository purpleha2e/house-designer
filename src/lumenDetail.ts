import { MeshoptSimplifier } from 'meshoptimizer/simplifier'

/** All inputs are in mesh-local coordinates. The caller converts the world
 * error allowance using the largest instance scale. Each call covers one
 * opaque material group, so an aperture or material edge remains a border. */
export type DetailGeometry = {
  positions:Float32Array; index?:Uint32Array | Uint16Array | Uint8Array
  uvChannels:Float32Array[]
}
export type DetailRange = {start:number; count:number; error:number}
export type DetailInput = DetailGeometry & DetailRange
const weldedPositions=new WeakMap<Float32Array,Uint32Array>()

export async function simplifyLightingDetail(input:DetailInput):Promise<Uint32Array|null>{
  if(input.count<768 || !MeshoptSimplifier.supported)return null
  await MeshoptSimplifier.ready
  const {positions,index,uvChannels,start,count,error}=input
  // Nonindexed triangle soup and duplicated UV seam vertices are common in
  // imported models. Only weld coincident vertices with identical UVs.
  let remap=weldedPositions.get(positions)
  if(!remap){
    remap=MeshoptSimplifier.generatePositionRemap(positions,3)
    weldedPositions.set(positions,remap)
  }
  const elements=new Uint32Array(count)
  for(let i=0;i<count;i++){
    const vertex=index?.[start+i]??start+i, other=remap[vertex]
    const sameUV=uvChannels.every(uv=>uv[vertex*2]===uv[other*2] && uv[vertex*2+1]===uv[other*2+1])
    elements[i]=sameUV?other:vertex
  }
  const target=Math.max(36,Math.floor(count/24)*3)
  const [reduced]=MeshoptSimplifier.simplify(elements,positions,3,target,error,['Sparse','LockBorder','ErrorAbsolute'])
  return reduced.length>=3 && reduced.length<count*.8 ? reduced : null
}
