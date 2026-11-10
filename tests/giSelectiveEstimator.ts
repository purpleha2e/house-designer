import {BufferAttribute,BufferGeometry,DataUtils,DoubleSide,Ray,Vector3} from 'three'
import {MeshBVH,SAH} from 'three-mesh-bvh'
import type {ReferenceSceneData,ReferenceReceiver} from './sceneLightingReference.ts'
import {indirectSHIrradianceBasis,indirectSHRadianceBasis} from '../src/indirectSH.ts'

/** One local cosine-hemisphere ray, then a completed-field terminal estimate.
 * Replaces receiver indirect irradiance; never adds it to an already complete
 * GI result. Direct sun/lamps at the receiver remain the display's job. */
export function createSelectiveEstimator(data:ReferenceSceneData,terminal:(p:Vector3,n:Vector3)=>number[]){
  const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(data.positions,3)).setAttribute('uv',new BufferAttribute(data.uvs,2)),tree=data.positions.length?new MeshBVH(geometry,{strategy:SAH,targetLeafSize:4}):null,ray=new Ray(),direction=new Vector3(),point=new Vector3(),normal=new Vector3(),lightDirection=new Vector3(),sun=new Vector3().fromArray(data.sunDirection).normalize()
  let rays=0,shadowRays=0,terminalCalls=0
  const cast=(p:Vector3,d:Vector3,far=80)=>{rays++;ray.set(p,d);return tree?.raycastFirst(ray,DoubleSide,.0001,far)??null}
  const texel=(id:number,u:number,v:number)=>{
    const m=data.materials[id],t=data.textures[m.map],rgb=[1,1,1];if(!t)return rgb
    const matrix=m.matrix,x=matrix[0]*u+matrix[3]*v+matrix[6],y=matrix[1]*u+matrix[4]*v+matrix[7]
    const wrap=(v:number,mode:number)=>mode===1001?Math.max(0,Math.min(1,v)):mode===1002?(Math.abs(Math.floor(v))%2?1-(v-Math.floor(v)):v-Math.floor(v)):v-Math.floor(v)
    const px=wrap(x,m.wrapS)*t.width-.5,py=wrap(y,m.wrapT)*t.height-.5
    const pixel=(i:number,count:number,mode:number)=>mode===1001?Math.max(0,Math.min(count-1,i)):Math.min(count-1,Math.floor(wrap((i+.5)/count,mode)*count))
    rgb.fill(0)
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const ix=pixel(Math.floor(px)+dx,t.width,m.wrapS),iy=pixel(Math.floor(py)+dy,t.height,m.wrapT),w=(dx?px-Math.floor(px):1-px+Math.floor(px))*(dy?py-Math.floor(py):1-py+Math.floor(py));for(let c=0;c<3;c++)rgb[c]+=DataUtils.fromHalfFloat(t.pixels[(iy*t.width+ix)*4+c])*w}
    return rgb
  }
  function incidentDirect(p:Vector3,n:Vector3){
    const rgb=[0,0,0],cosine=Math.max(0,n.dot(sun));if(cosine>0){shadowRays++;if(!cast(p,sun))for(let c=0;c<3;c++)rgb[c]=data.sunIrradiance[c]*cosine*data.daylightGain}
    for(const l of data.lights){lightDirection.fromArray(l.position).sub(p);const distance=lightDirection.length();if(distance<.0001)continue;lightDirection.divideScalar(distance);let weight=Math.max(0,n.dot(lightDirection))/Math.max(.01,distance**l.decay);if(l.distance>0)weight*=Math.max(0,1-(distance/l.distance)**4)**2;if(l.direction){const cone=-lightDirection.dot(new Vector3().fromArray(l.direction)),v=Math.max(0,Math.min(1,(cone-l.cone!)/Math.max(1e-12,l.penumbra!-l.cone!)));weight*=v*v*(3-2*v)}if(weight>0){shadowRays++;if(!cast(p,lightDirection,distance-.0001))for(let c=0;c<3;c++)rgb[c]+=l.color[c]*l.intensity*weight}}
    return rgb
  }
  return{
    select(receiver:ReferenceReceiver,offset:number,probeVisible:number,probeBlocked:number,disagreement:number,face:number){
      const p=new Vector3().fromArray(receiver.position),gn=new Vector3().fromArray(receiver.geometricNormal).normalize(),sn=new Vector3().fromArray(receiver.normal).normalize(),start=p.clone().addScaledVector(gn,.0002)
      const crossed=cast(start,sn,offset),nearby=cast(start,gn,.1),reasons=[]
      if(crossed)reasons.push('offset-crosses-geometry')
      if(probeVisible<=2&&probeBlocked>=4&&nearby)reasons.push('fragile-support-near-geometry')
      if(disagreement>.15&&nearby)reasons.push('local-gradient-disagreement')
      if(face===1049||face===151)reasons.push('known-diagnostic-face')
      return{selected:reasons.length>0,reasons,crossedDistance:crossed?.distance??null,nearbyDistance:nearby?.distance??null}
    },
    evaluate(receiver:ReferenceReceiver,budget:number,seed:number,controlCoefficients?:number[][]){
      const n=new Vector3().fromArray(receiver.normal).normalize(),gn=new Vector3().fromArray(receiver.geometricNormal).normalize(),origin=new Vector3().fromArray(receiver.position).addScaledVector(gn,.0002),tangent=new Vector3().crossVectors(Math.abs(n.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0),n).normalize(),bitangent=new Vector3().crossVectors(n,tangent),sum=[0,0,0],controlSum=[0,0,0]
      let state=seed>>>0;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)+.5)/4294967296
      for(let i=0;i<budget;i++){
        const u=random(),phi=2*Math.PI*random(),radius=Math.sqrt(u);direction.copy(n).multiplyScalar(Math.sqrt(1-u)).addScaledVector(tangent,radius*Math.cos(phi)).addScaledVector(bitangent,radius*Math.sin(phi))
        if(controlCoefficients){const basis=indirectSHRadianceBasis(direction,1);for(let c=0;c<3;c++)for(let k=0;k<4;k++)controlSum[c]+=controlCoefficients[c][k]*basis[k]}
        const h=cast(origin,direction)
        if(!h){for(let c=0;c<3;c++)sum[c]+=direction.y>=0?data.skyBase[c]*(data.skyMode==='overcast'?.5+direction.y:.6+.8*direction.y):.2*(data.skyBase[c]*(data.skyMode==='overcast'?7/6:17/15)+data.skySun[c]/Math.PI);continue}
        const id=data.materialIndices[Math.floor(h.face!.a/3)],m=data.materials[id],color=texel(id,h.uv?.x??0,h.uv?.y??0)
        normal.copy(h.face!.normal);if(normal.dot(direction)>0)normal.negate();point.copy(h.point).addScaledVector(normal,.0002)
        const direct=incidentDirect(point,normal),indirect=terminal(point,normal);terminalCalls++
        for(let c=0;c<3;c++)sum[c]+=m.color[c]*color[c]*(1-m.metalness)*(direct[c]+indirect[c])/Math.PI
      }
      const raw=sum.map(v=>Math.PI*v/budget),basis=indirectSHIrradianceBasis(n,1),control=controlCoefficients?raw.map((v,c)=>v+controlCoefficients[c].reduce((s,v,k)=>s+v*basis[k],0)-Math.PI*controlSum[c]/budget):raw
      return{replace:raw,control:control.map(v=>Math.max(0,v)),unclampedControl:control}
    },stats(){return{rays,shadowRays,terminalCalls}},dispose(){geometry.dispose()}
  }
}
