import { Mesh, MeshPhysicalMaterial, Vector3, type Scene } from 'three'
import { isLightingGlazing } from './lightingVisibility.ts'
import type { LumenOpening } from './lumenSkyVisibility'

/** Reuse the viewport's authored glass blend for diffuse aperture transport.
 * Project planar pane bounds onto each opening and quadrature-average coverage.
 * The opaque scene still provides the actual frame and reveal intersections. */
export function measureLumenGlazing(scene:Scene,openings:LumenOpening[]):LumenOpening[]{
  type Pane={transmission:number;corners:Vector3[]}
  const panes:Pane[]=[]
  scene.traverseVisible(object=>{
    if(!(object instanceof Mesh) || Array.isArray(object.material))return
    const material=object.material
    if(!material.visible || !isLightingGlazing(material))return
    let transmission=material.transparent?1-material.opacity:1
    if(material instanceof MeshPhysicalMaterial && material.transmission>0){
      const reflection=((material.ior-1)/(material.ior+1))**2
      transmission*=material.transmission*(1-reflection)**2
    }
    if(transmission>=1)return
    if(!object.geometry.boundingBox)object.geometry.computeBoundingBox()
    const bounds=object.geometry.boundingBox
    if(!bounds || bounds.isEmpty())return
    object.updateWorldMatrix(true,false)
    const corners:Vector3[]=[]
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])
      corners.push(new Vector3(x,y,z).applyMatrix4(object.matrixWorld))
    panes.push({transmission:Math.max(0,transmission),corners})
  })
  return openings.map(opening=>{
    const center=new Vector3().fromArray(opening.center),axis=new Vector3().fromArray(opening.u)
    const normal=new Vector3(-axis.z,0,axis.x),offset=opening.exteriorOffset??0
    const factor=new Float32Array(16).fill(1)
    for(const pane of panes){
      let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity,near=Infinity,far=-Infinity
      for(const corner of pane.corners){
        const u=corner.dot(axis)-center.dot(axis),v=corner.y-center.y,d=corner.dot(normal)-center.dot(normal)
        left=Math.min(left,u);right=Math.max(right,u);bottom=Math.min(bottom,v);top=Math.max(top,v);near=Math.min(near,d);far=Math.max(far,d)
      }
      if(far-near>.18 || near>Math.max(0,offset)+.12 || far<Math.min(0,offset)-.12)continue
      for(let row=0;row<4;row++)for(let column=0;column<4;column++){
        const u=((column+.5)/4-.5)*opening.width,v=((row+.5)/4-.5)*opening.height,index=row*4+column
        if(u>=left && u<=right && v>=bottom && v<=top)factor[index]=Math.min(factor[index],pane.transmission)
      }
    }
    return {...opening,transmission:factor.reduce((sum,n)=>sum+n,0)/factor.length}
  })
}
