import {DataUtils,Matrix4,Vector3} from 'three'
import {restoreIndirectVisibility} from './indirectVisibility.ts'
import {createDirectSunRadiance,createSunHitMaterials,createSunSurfaceQuery} from './localSunTransport.ts'
import {gatherLocalIndirect} from './localSunGather.ts'
import type {LocalSunPreviewCamera,LocalSunPreviewData} from './localSunPreview.ts'
import {traceLocalSunPrimary} from './localSunPreview.ts'
import {filterLocalSunPreview} from './localSunPreviewFilter.ts'

let query:ReturnType<typeof createSunSurfaceQuery>|undefined,shadowQuery:ReturnType<typeof createSunSurfaceQuery>|undefined,visibility:ReturnType<typeof restoreIndirectVisibility>|undefined,data:LocalSunPreviewData|undefined,generation=0
const pause=()=>new Promise(resolve=>setTimeout(resolve,0))
self.onmessage=async(e:MessageEvent<{kind:'prepare';data:LocalSunPreviewData}|{kind:'render';id:number;camera:LocalSunPreviewCamera}|{kind:'cancel'}>)=>{
  const message=e.data
  if(message.kind==='cancel'){generation++;return}
  if(message.kind==='prepare'){
    try{
      generation++;visibility?.dispose();data=message.data
      visibility=restoreIndirectVisibility({positions:data.positions,tree:null})
      const textures=data.textures.map(t=>({width:t.width,height:t.height,colorSpace:'linear-srgb' as const,pixel:(x:number,y:number)=>[0,1,2,3].map(c=>DataUtils.fromHalfFloat(t.pixels[(y*t.width+x)*4+c]))}))
      query=createSunSurfaceQuery(visibility,createSunHitMaterials({...data,textures}))
      shadowQuery=createSunSurfaceQuery(visibility,createSunHitMaterials({...data,textures,materials:data.materials.map(m=>({...m,side:m.shadowSide??m.side}))}))
      self.postMessage({kind:'prepared',triangles:data.materialIndices.length,textureBytes:data.textures.reduce((n,t)=>n+t.pixels.byteLength,0)})
    }catch(error){self.postMessage({kind:'error',error:String(error)})}return
  }
  if(!query||!data)return
  const id=message.id,version=++generation,camera=message.camera,started=performance.now(),world=new Matrix4().fromArray(camera.world),inverseProjection=new Matrix4().fromArray(camera.projectionInverse),view=world.clone().invert()
  const image=new Float32Array(camera.width*camera.height*4),normals=new Float32Array(image.length),positions=new Float32Array(camera.width*camera.height*3),origin=new Vector3().setFromMatrixPosition(world),direction=new Vector3(),identity={geometry:1,lighting:1,source:'surface-sun',bounces:1}
  let unsupported=0,receivers=0;const reasons:Record<string,number>={}
  try{
    for(let y=0;y<camera.height;y++){
      if(version!==generation)return
      for(let x=0;x<camera.width;x++){
        direction.set((x+.5)/camera.width*2-1,(y+.5)/camera.height*2-1,.5).applyMatrix4(inverseProjection).applyMatrix4(world).sub(origin).normalize()
        const hit=traceLocalSunPrimary(query,origin,direction,camera.visibleTriangles);if(!hit)continue
        const surface=query.material(hit,direction),offset=(y*camera.width+x)*4
        image[offset+3]=-hit.point.clone().applyMatrix4(view).z
        hit.point.toArray(positions,(y*camera.width+x)*3)
        if(!surface.valid){unsupported++;reasons[surface.reason??'unknown']=(reasons[surface.reason??'unknown']??0)+1;continue}receivers++
        const shadingNormal=surface.normal.clone()
        if(!data.materials[surface.materialId].flatShading){
          const interpolated=new Vector3(),vertex=new Vector3()
          for(let i=0;i<3;i++)interpolated.addScaledVector(vertex.fromArray(data.normals,surface.triangle*9+i*3),surface.barycentric[i])
          if(interpolated.lengthSq()>1e-12){shadingNormal.copy(interpolated).normalize();if(surface.side<0)shadingNormal.negate()}
        }
        shadingNormal.toArray(normals,offset)
        const sun=createDirectSunRadiance({query,shadowQuery,sunDirection:data.sunDirection,sunIrradiance:data.sunIrradiance,daylightGain:data.daylightGain,identity})
        const receiver={position:hit.point.toArray(),normal:shadingNormal.toArray(),geometricNormal:surface.normal.toArray()}
        const result=gatherLocalIndirect({enabled:true,receiver,rays:camera.rays,seed:20261106+Math.imul(y*camera.width+x,2654435761),identity,visibility:query,lookup:sun.lookup})
        if(result.state!=='ready'){unsupported++;for(const [reason,count]of Object.entries(result.reasons??{}))reasons[reason]=(reasons[reason]??0)+count;continue}
        image.set(result.irradiance!,offset);normals[offset+3]=1
      }
      self.postMessage({kind:'progress',id,percent:Math.round((y+1)/camera.height*100)});await pause()
    }
    if(version===generation){
      const filtered=filterLocalSunPreview(image,normals,positions,camera.width,camera.height)
      let supportedPixels=0;for(let i=3;i<normals.length;i+=4)if(normals[i]>.5)supportedPixels++
      self.postMessage({kind:'image',id,image:filtered,normals,width:camera.width,height:camera.height,rays:camera.rays,unsupported,receivers,supportedPixels,reasons,denoised:true,ms:performance.now()-started},[filtered.buffer,normals.buffer])
    }
  }catch(error){if(version===generation)self.postMessage({kind:'error',id,error:String(error)})}
}
