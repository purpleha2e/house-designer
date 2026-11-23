import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, MeshPhysicalMaterial, Ray, Vector3, type Camera, type Scene } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { snapshotHouseMeshes } from '../../src/lightingLab/houseBridge'

/** Intersect the authored pane triangles independently of the aperture atlas.
 * This is the transmitted diffuse path, with opaque visibility in a separate
 * BVH. The full image path tracer also evaluates scattering and refraction. */
export function createReferenceGlazing(scene:Scene,camera:Camera) {
  const snapshot=snapshotHouseMeshes(scene,camera,{referenceExterior:true})
  const positions:number[]=[],faces:{pane:number;alpha:number;transmission:number;ior:number}[]=[]
  const matrix=new Matrix4(),point=new Vector3()
  let pane=0
  for(const part of snapshot.parts)for(const transform of part.matrices){
    matrix.fromArray(transform)
    for(const range of part.ranges){
      const finish=snapshot.finishes[range.material],material=finish.referenceMaterial
      if(!finish.glazing || !material)continue
      const physical=material instanceof MeshPhysicalMaterial && material.transmission>0
      const optics={pane,alpha:material.transparent?1-material.opacity:1,transmission:physical?material.transmission:1,ior:physical?material.ior:0}
      if(optics.alpha===1 && optics.transmission===1 && !optics.ior)continue
      for(let i=range.start;i+2<range.start+range.count;i+=3){
        faces.push(optics)
        for(let vertex=i;vertex<i+3;vertex++){
          point.fromArray(part.position,(part.index?.[vertex]??vertex)*3).applyMatrix4(matrix)
          positions.push(...point.toArray())
        }
      }
    }
    pane++
  }
  snapshot.finishes.forEach(f=>f.referenceMaterial?.dispose())
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(positions),3))
  const tree=positions.length?new MeshBVH(geometry):null,ray=new Ray(),seen=new Set<number>()
  return { count:new Set(faces.map(face=>face.pane)).size, dispose:()=>geometry.dispose(),
    transmit(origin:Vector3,direction:Vector3,distance:number){
      if(!tree)return 1
      let weight=1;seen.clear()
      for(const hit of tree.raycast(ray.set(origin,direction),DoubleSide,.0001,distance)){
        const pane=faces[Math.floor(hit.face!.a/3)]
        if(seen.has(pane.pane))continue
        seen.add(pane.pane)
        const reflect=pane.ior?((pane.ior-1)/(pane.ior+1))**2:0
        const cosine=Math.abs(hit.face!.normal.dot(direction))
        const transmit=pane.ior?(1-reflect-(1-reflect)*(1-cosine)**5)**2:1
        weight*=pane.alpha*pane.transmission*transmit
      }
      return weight
    },
  }
}
