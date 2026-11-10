import {Triangle,Vector2,Vector3} from 'three'
import type {IndirectVisibility} from './indirectVisibility.ts'
import type {GatherIdentity,GatherRadiance} from './localSunGather.ts'

type SunUV={matrix:readonly number[];wrapS:number;wrapT:number}
export type SunMaterial=SunUV&{color:readonly number[];metalness:number;map:number;side?:0|1|2;opacity?:number;opaquePipeline?:boolean;alphaTest?:number;alphaMap?:number;metalnessMap?:number;alphaSampling?:SunUV;metalnessSampling?:SunUV;unsupported?:string;transmission?:number;vertexColors?:boolean}
export type SunTexture={width:number;height:number;colorSpace:'linear-srgb'|'srgb'|'none';pixel:(x:number,y:number)=>readonly number[]}
type Hit=NonNullable<ReturnType<IndirectVisibility['hit']>>
export type SunHit={hit:Hit;triangle:number;primitiveTriangle:number;owner:number;materialId:number;barycentric:number[];uv:number[];normal:Vector3;side:number;rho:number[];alpha:number;valid:boolean;reason?:string}
export type SunMetadata={positions:Float32Array;uvs:Float32Array;materialIndices:Uint16Array;owners:Uint32Array;materials:SunMaterial[];textures:SunTexture[];triangleMap?:Int32Array;legacyOpaqueDoubleSide?:boolean}
export const srgbToLinear=(x:number)=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4
const wrap=(x:number,mode:number)=>mode===1001?Math.max(0,Math.min(1,x)):mode===1002?(Math.abs(Math.floor(x))%2?1-(x-Math.floor(x)):x-Math.floor(x)):x-Math.floor(x)
export function sampleSunTexture(texture:SunTexture,uv:readonly number[],material:Pick<SunMaterial,'matrix'|'wrapS'|'wrapT'>,colour=true){
  const m=material.matrix,u=m[0]*uv[0]+m[3]*uv[1]+m[6],v=m[1]*uv[0]+m[4]*uv[1]+m[7],x=wrap(u,material.wrapS)*texture.width-.5,y=wrap(v,material.wrapT)*texture.height-.5,result=[0,0,0,0]
  const index=(i:number,n:number,mode:number)=>mode===1001?Math.max(0,Math.min(n-1,i)):Math.min(n-1,Math.floor(wrap((i+.5)/n,mode)*n))
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const pixel=texture.pixel(index(Math.floor(x)+dx,texture.width,material.wrapS),index(Math.floor(y)+dy,texture.height,material.wrapT)),weight=(dx?x-Math.floor(x):1-x+Math.floor(x))*(dy?y-Math.floor(y):1-y+Math.floor(y))
    for(let c=0;c<4;c++)result[c]+=weight*(colour&&c<3&&texture.colorSpace==='srgb'?srgbToLinear(pixel[c]):pixel[c])
  }
  return result
}

/** Maps the existing BVH's original vertex index back to diagnostic metadata.
 * Its reordered faceIndex is never used as a material index. */
export function createSunHitMaterials(data:SunMetadata){
  const triangle=new Triangle(),bary=new Vector3(),uv=new Vector2()
  const timings={resolved:0,identificationMs:0,barycentricUVms:0,textureMs:0,responseMs:0}
  const resolve=(hit:Hit,direction:Vector3):SunHit=>{
    const identificationAt=performance.now();timings.resolved++
    const primitive=Math.floor(hit.face!.a/3),source=data.triangleMap?data.triangleMap[primitive]:primitive,materialId=data.materialIndices[source],material=data.materials[materialId],normal=hit.face!.normal.clone(),side=normal.dot(direction)<0?1:-1
    const result:SunHit={hit,triangle:source,primitiveTriangle:primitive,owner:data.owners[primitive],materialId,barycentric:[],uv:[],normal,side,rho:[0,0,0],alpha:1,valid:false}
    if(!material||source<0||source>=data.materialIndices.length||data.owners[primitive]===undefined)return{...result,reason:'missing-hit-metadata'}
    if(material.unsupported||material.transmission||material.vertexColors)return{...result,reason:material.unsupported??'unsupported-material-feature'}
    if(!data.legacyOpaqueDoubleSide&&(material.side===undefined||material.opacity===undefined))return{...result,reason:'missing-side-or-opacity'}
    timings.identificationMs+=performance.now()-identificationAt
    const uvAt=performance.now()
    triangle.a.fromArray(data.positions,source*9);triangle.b.fromArray(data.positions,source*9+3);triangle.c.fromArray(data.positions,source*9+6)
    if(!triangle.getBarycoord(hit.point,bary))return{...result,reason:'degenerate-triangle'}
    uv.set(0,0);for(let i=0;i<3;i++){const weight=bary.getComponent(i);uv.x+=data.uvs[source*6+i*2]*weight;uv.y+=data.uvs[source*6+i*2+1]*weight}
    result.barycentric=bary.toArray();result.uv=uv.toArray()
    timings.barycentricUVms+=performance.now()-uvAt
    if(!result.uv.every(Number.isFinite))return{...result,reason:'missing-uv'}
    const map=material.map>=0?data.textures[material.map]:undefined
    if(material.map>=0&&!map)return{...result,reason:'missing-base-colour-texture'}
    const textureAt=performance.now(),texel=map?sampleSunTexture(map,result.uv,material):[1,1,1,1]
    const ignoresAlpha=data.legacyOpaqueDoubleSide||(material.opaquePipeline&&!material.alphaTest)
    let alpha=ignoresAlpha?1:(material.opacity??1)*texel[3],metalness=material.metalness
    if(!ignoresAlpha&&material.alphaMap!==undefined&&material.alphaMap>=0){const texture=data.textures[material.alphaMap];if(!texture)return{...result,reason:'missing-alpha-map'};alpha*=sampleSunTexture(texture,result.uv,material.alphaSampling??material,false)[1]}
    if(material.metalnessMap!==undefined&&material.metalnessMap>=0){const texture=data.textures[material.metalnessMap];if(!texture)return{...result,reason:'missing-metalness-map'};metalness*=sampleSunTexture(texture,result.uv,material.metalnessSampling??material,false)[2]}
    timings.textureMs+=performance.now()-textureAt
    const responseAt=performance.now()
    const mode=material.side??2
    if((mode===0&&side<0)||(mode===1&&side>0)||alpha<(material.alphaTest??0)||alpha===0)return{...result,reason:'discarded-side-or-alpha'}
    if(alpha<1-1e-6&&!material.alphaTest)return{...result,reason:'unsupported-blended-opacity'}
    result.alpha=alpha;result.rho=material.color.map((c,i)=>c*texel[i]*(1-metalness))
    if(result.rho.length!==3||!result.rho.every(v=>Number.isFinite(v)&&v>=0))return{...result,reason:'invalid-diffuse-reflectance'}
    if(side<0)normal.negate();result.valid=true;timings.responseMs+=performance.now()-responseAt;return result
  }
  return Object.assign(resolve,{timings})
}

/** Alpha/side filtering adds no geometry or ray engine: continue the same
 * production nearest-hit query past rejected faces. Unknown blockers stay unknown. */
export function createSunSurfaceQuery(visibility:Pick<IndirectVisibility,'hit'>,resolve:ReturnType<typeof createSunHitMaterials>){
  const records=new WeakMap<Hit,SunHit>(),stats={nearestCalls:0,discarded:0,materialMs:0,traceMs:0}
  const hit=(origin:Vector3,direction:Vector3,far=80,near=.0001):Hit|null=>{
    for(let step=0;step<128;step++){
      let at=performance.now();const h=visibility.hit(origin,direction,far,near);stats.traceMs+=performance.now()-at;stats.nearestCalls++;if(!h)return null
      at=performance.now();const material=resolve(h,direction);stats.materialMs+=performance.now()-at;records.set(h,material)
      if(material.reason!=='discarded-side-or-alpha')return h
      stats.discarded++;near=h.distance+.000001
    }
    throw Error('Too many rejected surface layers')
  }
  return{hit,stats,materialTimings:resolve.timings,material:(h:Hit,d:Vector3)=>records.get(h)??resolve(h,d)}
}

export function createDirectSunRadiance({query,shadowQuery=query,sunDirection,sunIrradiance,daylightGain,identity,filter=()=>true}:{query:ReturnType<typeof createSunSurfaceQuery>;shadowQuery?:ReturnType<typeof createSunSurfaceQuery>;sunDirection:readonly number[];sunIrradiance:readonly number[];daylightGain:number;identity:GatherIdentity;filter?:(hit:SunHit)=>boolean}){
  const sun=new Vector3().fromArray(sunDirection).normalize(),stats={validHits:0,unsupportedHits:0,sunVisibleHits:0,sunOccludedHits:0,sunAwayHits:0,filteredHits:0,sunVisibilityMs:0,radianceMs:0},samples:SunHit[]=[]
  const lookup=(hit:Hit,direction:Vector3):GatherRadiance=>{
    const record=query.material(hit,direction);samples.push(record)
    const result:GatherRadiance={valid:record.valid,rgb:[0,0,0],primitive:hit.faceIndex??undefined,side:record.side,identity,reason:record.reason}
    if(!record.valid){stats.unsupportedHits++;return result}
    stats.validHits++;if(!filter(record)){stats.filteredHits++;return result}
    const cosine=Math.max(0,record.normal.dot(sun));if(cosine===0||sunIrradiance.every(v=>v===0)){stats.sunAwayHits++;return result}
    const origin=hit.point.clone().addScaledVector(record.normal,.0002),at=performance.now(),block=shadowQuery.hit(origin,sun,80,.0001);stats.sunVisibilityMs+=performance.now()-at
    if(block){const m=shadowQuery.material(block,sun);if(!m.valid){stats.validHits--;stats.unsupportedHits++;return{...result,valid:false,reason:'unsupported-sun-blocker:'+m.reason}}stats.sunOccludedHits++;return result}
    stats.sunVisibleHits++;const radianceAt=performance.now();result.rgb=record.rho.map((rho,c)=>rho/Math.PI*sunIrradiance[c]*cosine*daylightGain);stats.radianceMs+=performance.now()-radianceAt;return result
  }
  return{lookup,stats,samples}
}
