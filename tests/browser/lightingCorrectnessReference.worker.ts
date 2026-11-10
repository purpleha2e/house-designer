import {BufferAttribute,BufferGeometry,DoubleSide,Ray,Vector3} from 'three'
import {MeshBVH,SAH} from 'three-mesh-bvh'
import {createSceneLightingReference,type ReferenceSceneData,type ReferenceReceiver} from '../sceneLightingReference'

self.onmessage=({data}:{data:{scene:ReferenceSceneData;points:ReferenceReceiver[];samples:number}})=>{
  const began=performance.now(),reference=createSceneLightingReference(data.scene)
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(data.scene.positions,3))
  const tree=new MeshBVH(geometry,{strategy:SAH,targetLeafSize:4}),sun=new Vector3().fromArray(data.scene.sunDirection).normalize(),ray=new Ray()
  try{
    const results=data.points.map((point,index)=>{
      self.postMessage({progress:{index,total:data.points.length,name:point.name}})
      const normal=new Vector3().fromArray(point.geometricNormal),origin=new Vector3().fromArray(point.position).addScaledVector(normal,.004)
      ray.set(origin,sun)
      const hit=tree.raycastFirst(ray,DoubleSide,.0001,100),local=data.scene.lights.map(light=>{
        const delta=new Vector3().fromArray(light.position).sub(origin),distance=delta.length();ray.set(origin,delta.normalize())
        return {position:light.position,visible:!tree.raycastFirst(ray,DoubleSide,.0001,Math.max(.0001,distance-.0001))}
      })
      // Half-float position buffers quantise coordinates; expose this uncertainty.
      const visibilityOffsets=[.0002,.004,.01].map(offset=>{ray.set(new Vector3().fromArray(point.position).addScaledVector(normal,offset),sun);return{offset,visible:!tree.raycastFirst(ray,DoubleSide,.0001,100)}})
      return{...point,reference:reference.evaluate(point,data.samples,6,1234+index*1009),bvhSunVisibility:hit?0:1,firstOccluderDistance:hit?.distance??null,localVisibility:local,visibilityOffsets}
    })
    self.postMessage({ok:true,results,elapsedMs:performance.now()-began,samples:data.samples,depth:6})
  }catch(error){self.postMessage({ok:false,error:String(error)})}finally{reference.dispose();geometry.dispose()}
}
