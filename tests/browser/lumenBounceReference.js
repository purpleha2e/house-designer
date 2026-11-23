import {BufferAttribute,BufferGeometry,DoubleSide,Ray,Triangle,Vector3,WebGLRenderer} from 'three'
import {MeshBVH,SAH} from 'three-mesh-bvh'
import {snapshotReferenceScene} from '../../src/diffuseSceneSnapshot.ts'
import {sampleReferenceSurface} from '../../src/diffuseSceneMaterials.ts'
import {createSceneLightingReference} from '../sceneLightingReference.ts'
import {bounceGridDefinitions} from './lumenBounceProbe.js'
import {createReferenceGlazing} from './lumenReferenceGlazing.ts'

const tau=2*Math.PI,pi=Math.PI
const zero=()=>[0,0,0]
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0)
const mult=(a,b)=>a.map((x,i)=>x*b[i])
const scale=(a,s)=>a.map(x=>x*s)
const add=(a,b)=>a.map((x,i)=>x+b[i])
const fract=x=>x-Math.floor(x)
const norm=[0,-1,0]

const places=[
  ['Left near window','left',[-.95,1.35,2.20]],['Left mid wall','left',[-.95,1.,3.70]],
  ['Left low corner','left',[-.95,.32,1.29]],['Back beside patio','back',[1.04,1.,1]],
  ['Back dark corner','back',[-.67,1.45,1]],['Back high wall','back',[.43,2.1,1]],
  ['Ceiling above patio','ceiling',[2.15,2.38,1.58]],['Ceiling centre','ceiling',[1.1,2.38,2.32]],
  ['Ceiling near left wall','ceiling',[-.65,2.38,2.18]],['Ceiling toward camera','ceiling',[2.55,2.38,4.43]],
  ['Floor by patio','floor',[2.3,0,1.4]],['Floor centre','floor',[1.7,0,3.3]],['Dark floor corner','floor',[-.63,0,1.35]],
]

function groundIntegrator(data,glass,openings){
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new BufferAttribute(data.positions,3))
  geometry.setAttribute('uv',new BufferAttribute(data.uvs,2))
  const bvh=new MeshBVH(geometry,{indirect:true,strategy:SAH,targetLeafSize:4})
  const sun=new Vector3().fromArray(data.sunDirection).normalize(),ray=new Ray(),up=new Vector3(0,1,0)
  const start=new Vector3(),target=new Vector3(),direction=new Vector3(),groundStart=new Vector3()
  const tri=new Triangle(),bary=new Vector3(),delta=new Vector3(),offset=new Vector3()
  const portal=openings.map(o=>{
    const centre=new Vector3().fromArray(o.center),axis=new Vector3().fromArray(o.axis)
    return {...o,centre,axis,planeNormal:new Vector3()}
  })
  for(const p of portal)p.planeNormal.crossVectors(p.axis,up)
  const cast=(origin,d,far=80)=>bvh.raycastFirst(ray.set(origin,d),DoubleSide,.0001,far)
  const directions=new Map()
  const above=(count,phase)=>{
    const key=count+'-'+phase
    if(directions.has(key))return directions.get(key)
    const sky=Array.from({length:count},(_,i)=>{
      const u=(i+.5)/count,phi=tau*fract((i+.5)*.61803398875+phase)
      const d=new Vector3(Math.sqrt(u)*Math.cos(phi),Math.sqrt(1-u),Math.sqrt(u)*Math.sin(phi))
      return {d,factor:data.skyMode==='overcast'?.5+d.y:.6+.8*d.y}
    })
    directions.set(key,sky)
    return sky
  }
  function otherPortal(p,distance){
    for(const earlier of portal){
      if(earlier===p)continue
      const denom=direction.dot(earlier.planeNormal)
      if(Math.abs(denom)<1e-6)continue
      delta.copy(earlier.centre).sub(start)
      const t=delta.dot(earlier.planeNormal)/denom
      if(t<=.001||t>=distance-.003)continue
      offset.copy(direction).multiplyScalar(t).sub(delta)
      if(Math.abs(offset.y)<earlier.height*.5&&Math.abs(offset.dot(earlier.axis))<earlier.width*.5)return true
    }
    return false
  }
  function measure(receiver,tiles,skySamples,phase,shift){
    const {position,rho}=receiver
    start.fromArray(position).addScaledVector(up,-.0002)
    let irradianceSky=zero(),irradianceSun=zero()
    const aperture=[]
    for(const [id,p] of portal.entries()){
      // The rectangular integral covers the actual finite aperture. Reject
      // occluded paths with exact triangles and sample glass along the path.
      const projectedArea=p.width*p.height/(tiles*tiles)
      let solidAngle=0,cosineFactor=0,rays=0,visible=0,through=0,weight=0,skySeen=0
      let reflectedSky=zero(),reflectedSun=zero(),terrainAlbedo=zero(),terrainHit=zero(),terrainSky=zero(),terrainSun=zero()
      for(let j=0;j<tiles;j++)for(let k=0;k<tiles;k++){
        const u=(j+shift[0])/tiles-.5,v=(k+shift[1])/tiles-.5
        target.copy(p.centre).addScaledVector(p.axis,u*p.width).addScaledVector(up,v*p.height)
        direction.copy(target).sub(start)
        const distance=direction.length()
        if(distance<.02)continue
        direction.multiplyScalar(1/distance)
        if(direction.y>=0||otherPortal(p,distance))continue
        const omega=projectedArea*Math.abs(direction.dot(p.planeNormal))/(distance*distance)
        const q=-direction.y*omega/pi
        solidAngle+=omega
        cosineFactor+=q
        rays++
        const hit=cast(start,direction)
        if(!hit||hit.distance<distance-.006)continue
        const triangle=Math.floor(hit.face.a/3)
        if(data.sourceCategories[triangle]!==3)continue
        const transmission=glass.transmit(start,direction,hit.distance)
        if(transmission<=0)continue
        visible++
        through+=transmission
        const material=data.materials[data.materialIndices[triangle]]
        if(material?.metalnessTexture||material?.emissionTexture){
          tri.a.fromArray(data.positions,triangle*9)
          tri.b.fromArray(data.positions,triangle*9+3)
          tri.c.fromArray(data.positions,triangle*9+6)
          tri.getBarycoord(hit.point,bary)
        }
        const surface=sampleReferenceSurface(data,triangle,hit.uv?.x??0,hit.uv?.y??0,bary).rho
        groundStart.copy(hit.point).addScaledVector(up,.0002)
        let daylight=0,unblocked=0
        // Phase the sky samples by stratum, using the same sequence at
        // neighboring receiver points to expose real spatial gradients.
        const sky=above(skySamples,fract(phase+.307*id+.61803398875*((j*tiles+k)%7)))
        for(const {d,factor} of sky){
          if(cast(groundStart,d))continue
          daylight+=factor*glass.transmit(groundStart,d,80)
          unblocked++
        }
        const skyAtTerrain=scale(data.skyBase,pi*daylight/skySamples)
        const solarAtTerrain=sun.y>0&&!cast(groundStart,sun)?scale(data.sunIrradiance,sun.y*data.daylightGain*glass.transmit(groundStart,sun,80)):zero()
        const w=q*transmission
        weight+=w
        skySeen+=w*unblocked/skySamples
        reflectedSky=add(reflectedSky,scale(mult(surface,skyAtTerrain),w))
        reflectedSun=add(reflectedSun,scale(mult(surface,solarAtTerrain),w))
        terrainSky=add(terrainSky,scale(skyAtTerrain,w))
        terrainSun=add(terrainSun,scale(solarAtTerrain,w))
        terrainHit=add(terrainHit,scale(hit.point.toArray(),w))
        terrainAlbedo=add(terrainAlbedo,scale(surface,w))
      }
      irradianceSky=add(irradianceSky,reflectedSky)
      irradianceSun=add(irradianceSun,reflectedSun)
      if(rays&&weight>0)aperture.push({id,solidAngle,cosineFactor,rays,visible,integrationWeight:weight,transmission:through/visible,
        visibility:visible/rays,terrainSkyVisibility:skySeen/weight,terrainIntersection:scale(terrainHit,1/weight),
        terrainAlbedo:scale(terrainAlbedo,1/weight),skyAtTerrain:scale(terrainSky,1/weight),sunAtTerrain:scale(terrainSun,1/weight),
        reflectedSky:scale(reflectedSky,1/(weight*pi)),reflectedSun:scale(reflectedSun,1/(weight*pi)),
        receiverSky:scale(mult(rho,reflectedSky),1/pi),receiverSun:scale(mult(rho,reflectedSun),1/pi)})
    }
    const sky=scale(mult(rho,irradianceSky),1/pi),solar=scale(mult(rho,irradianceSun),1/pi)
    return {position,rho,sky,solar,ground:add(sky,solar),irradianceSky,irradianceSun,aperture}
  }
  return {measure,dispose:()=>geometry.dispose()}
}

function meanGround(ground,receiver,tiles,skySamples,convergence){
  const offsets=convergence?[[.21,.74],[.71,.24]]:[[.125,.375],[.375,.875],[.625,.125],[.875,.625]]
  const runs=offsets.map((shift,i)=>ground.measure(receiver,tiles,skySamples,fract(i*.618+(convergence?.29:0)),shift))
  const average=(values,weights)=>values[0].map((_,i)=>values.reduce((s,v,j)=>s+v[i]*weights[j],0))
  const weights=runs.map(()=>1/runs.length)
  const vector=key=>average(runs.map(r=>r[key]),weights)
  const ids=new Set(runs.flatMap(r=>r.aperture.map(a=>a.id)))
  const aperture=[...ids].map(id=>{
    const group=runs.flatMap(r=>r.aperture.filter(a=>a.id===id))
    const total=group.reduce((n,a)=>n+a.integrationWeight,0)
    return Object.fromEntries(Object.keys(group[0]).map(key=>{
      const values=group.map(r=>r[key])
      if(key==='id')return [key,id]
      if(key.startsWith('receiver'))return [key,average(values,group.map(()=>1/runs.length))]
      if(Array.isArray(values[0]))return [key,average(values,group.map(a=>a.integrationWeight/total))]
      if(key==='rays'||key==='visible')return [key,values.reduce((a,b)=>a+b,0)]
      return [key,values.reduce((a,b)=>a+b,0)/group.length]
    }))
  })
  return {position:receiver.position,rho:receiver.rho,sky:vector('sky'),solar:vector('solar'),ground:vector('ground'),
    irradianceSky:vector('irradianceSky'),irradianceSun:vector('irradianceSun'),aperture}
}

export async function runBounceReference(s,pass){
  const reader=new WebGLRenderer()
  let snapshot
  try{
    snapshot=await snapshotReferenceScene({scene:s.scene,gl:reader},
      m=>m.userData.houseDesignerRole==='ground-plane'?3:0,{diffusePbr:true})
  }finally{reader.dispose();reader.forceContextLoss()}
  const panes=createReferenceGlazing(s.scene,s.camera),data=snapshot.data
  const reference=createSceneLightingReference(data,panes.transmit)
  const u=pass.traceMaterial.uniforms
  const openings=Array.from({length:u.openingCount.value},(_,i)=>{
    const center=u.openingCenter.value[i].toArray(),axis=u.openingAxis.value[i].toArray()
    return {center,axis,width:axis[3],height:center[3]}
  })
  const ground=groundIntegrator(data,panes,openings),grids=bounceGridDefinitions(pass)
  const pause=()=>new Promise(r=>setTimeout(r,0))
  const receiver=(p,n)=>{
    const hit=reference.visibleReceiver(p.map((x,i)=>x+n[i]*.035),p.map((x,i)=>x-n[i]*.005))
    return hit&&hit.distanceToEstimate<.011&&dot(hit.normal,n)>.995?hit:null
  }
  try{
    const anchors=[]
    for(const [label,plane,estimate] of places){
      const grid=grids.find(g=>g.name===plane),n=grid.normal
      if(plane==='floor')estimate[1]=grid.points[0][1]
      const nearest=grid.points.map(p=>[p,Math.hypot(...p.map((x,i)=>x-estimate[i]))]).sort((a,b)=>a[1]-b[1])
      const p=nearest.slice(0,12).map(([p])=>[p,receiver(p,n)]).find(([,hit])=>hit)
      if(!p)continue
      const [requested,hit]=p
      const measure=(samples,seed)=>{
        const value=reference.evaluate({name:label,position:hit.position,normal:n,geometricNormal:n},samples,6,seed,7,false,true)
        const radiance=v=>scale(mult(hit.rho,v),1/pi)
        return {samples,depth:6,irradiance:{directSun:value.direct,orders:value.byOrder},
          radiance:{directSun:radiance(value.direct),orders:value.byOrder.map(o=>({sky:radiance(o.sky),solar:radiance(o.solar),terrain:radiance(o.exteriorGround)}))},
          skyStandardError:radiance(value.skyStandardError),reflectedStandardError:radiance(value.reflectedStandardError)}
      }
      const runs=[measure(8192,18331),measure(32768,70429)]
      anchors.push({label,plane,requested,position:hit.position,n,rho:hit.rho,runs})
      await pause()
    }
    const results=[]
    let progress=0
    for(const grid of grids.filter(g=>g.name.startsWith('ceiling'))){
      const fine=grid.step===.05,tiles=fine?10:8,skySamples=fine?40:24,points=[]
      for(const [i,p] of grid.points.entries()){
        const hit=receiver(p,norm)
        if(!hit){points.push(null);continue}
        const value=meanGround(ground,hit,tiles,skySamples,false)
        const check=i%Math.max(1,Math.floor(grid.width/4))===0&&Math.floor(i/grid.width)%7===0
        points.push({...value,...(check&&{convergence:meanGround(ground,hit,22,72,true)})})
        if(++progress%12===0){window.bounceReferenceProgress=progress;await pause()}
      }
      results.push({...grid,points,tiles,skySamples,quadratures:4,convergenceTiles:22,convergenceSkySamples:72,convergenceQuadratures:2})
    }
    const metadata={triangles:snapshot.triangles,materialCount:snapshot.materials,textures:snapshot.textures,
      textureBytes:snapshot.textureBytes,materialsReady:s.scene.userData.progressiveStartup?.phase==='full',panes:panes.count,
      inputs:{sun:data.sunIrradiance,direction:data.sunDirection,sky:data.skyBase,skyMode:data.skyMode,gain:data.daylightGain,lights:data.lights},
      camera:s.camera.matrixWorld.toArray(),projection:s.camera.projectionMatrix.toArray(),exposure:s.gl.toneMappingExposure,
      method:'Exact opaque triangles on both ground legs, authored glazing, area quadrature of each aperture, independent cosine samples of sky at each terrain hit. Independent full path integration supplies each bounce order and separate convergence checks.'}
    return {metadata,anchors,ground:results}
  }finally{ground.dispose();reference.dispose();panes.dispose()}
}
