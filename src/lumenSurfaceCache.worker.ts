import { buildLumenCache, createLumenGeometry } from './lumenSurfaceCache'
import { buildLumenDistanceField } from './lumenDistanceField'
import { lumenGridSpacing } from './lumenRegion'
import type { ReferenceSceneData } from './diffuseSceneMaterials'

export type CacheRequest = { id: number; direction: number[]; irradiance: number[]; gpuSun?:boolean;viewProjection?:number[]; distanceField?: boolean } & (
  {kind:'region';center:number[];aligned?:boolean} | { kind: 'scene'; aligned?:boolean; data: ReferenceSceneData; center: number[]; fullAtlas?:boolean } | { kind: 'sun' })

let cache: ReturnType<typeof buildLumenCache> | undefined
let center:number[]=[]
let source:ReferenceSceneData|undefined
let geometry:ReturnType<typeof createLumenGeometry>|undefined
const regions=new Map<ReturnType<typeof buildLumenCache>,number[]>()
const maxResidentRegions=3
self.onmessage = ({ data: request }: MessageEvent<CacheRequest>) => {
  try {
    let rebuilt = false
    let bvhBuilt=false
    let cacheHit=false
    if(request.kind==='scene' || request.kind==='region'){
      const changed=request.kind==='scene' && !cache?.updateMaterials(request.data)
      if(request.kind==='scene'){
        source=request.data
        // Any authored edit may affect cached lighting in an adjoining room.
        regions.clear()
      }
      if(!source)throw Error('Missing source for cache region')
      if(changed || !geometry){geometry?.dispose();geometry=createLumenGeometry(source);bvhBuilt=true}
      if(request.kind==='region'){
        for(const [resident,anchor] of Array.from(regions).reverse()){
          if(anchor.every((v,i)=>Math.abs(v-request.center[i])<=(i===1?1.5:2.5))){
            cache=resident;center=anchor;cacheHit=true;break
          }
        }
      }
      if(!cacheHit && (request.kind==='region' || changed || !cache || request.center.some((v,i)=>v!==center[i]))){
        cache=buildLumenCache(source,request.center,lumenGridSpacing,request.aligned!==false,geometry,request.viewProjection)
        center=request.center;rebuilt=true
      }
      if(cache){regions.delete(cache);regions.set(cache,center)}
      while(regions.size>maxResidentRegions)regions.delete(regions.keys().next().value!)
    }
    if (!cache) throw Error('No surface atlas for this sunlight update')
    const atlas = cache.atlas
    if (request.distanceField && !atlas.distanceField && geometry) {
      atlas.distanceField = buildLumenDistanceField(geometry.tree, atlas.origin, atlas.dimensions, atlas.spacing)
    }
    const lighting = request.gpuSun ? undefined : cache.light(request.direction,request.irradiance)
    // The worker retains geometry and static texels for fast sun edits. Only
    // the newly computed lighting buffer is transferred on subsequent updates.
    const full=rebuilt || cacheHit || (request.kind==='scene' && request.fullAtlas)
    let retainedBytes=0
    for(const {atlas} of regions.keys())retainedBytes+=atlas.cells.byteLength+atlas.positions.byteLength+atlas.normals.byteLength+
      atlas.albedo.byteLength+(atlas.boundsLo?.byteLength??0)+(atlas.boundsHi?.byteLength??0)+(atlas.distanceField?.values.byteLength??0)
    self.postMessage({ id:request.id, kind:request.kind, rebuilt,bvhBuilt,bvhMs:cache.bvhMs,accounting:cache.accounting, buildMs:cache.buildMs, conflicts:cache.conflicts,
      atlas:full ? cache.atlas : undefined, center,cacheHit,retainedBytes,rows:request.kind==='scene'&&!full ? cache.materialRows():undefined,
      lighting }, { transfer:lighting?[lighting.radiance.buffer]:[] })
  } catch (error) {
    self.postMessage({ id:request.id, error:error instanceof Error ? error.message : String(error) })
  }
}
