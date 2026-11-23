import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Triangle, Vector3 } from 'three'
import { MeshBVH, SAH } from 'three-mesh-bvh'

import { sampleReferenceSurface, type ReferenceRGB, type ReferenceSceneData } from '../src/diffuseSceneMaterials.ts'
export type { ReferenceRGB, ReferenceTexture, ReferenceMaterial, ReferenceSampler, ReferenceLight, ReferenceSceneData } from '../src/diffuseSceneMaterials.ts'

export type ReferenceReceiver = { name: string; position: number[]; normal: number[]; geometricNormal: number[] }

/** Independent diffuse transport over the actual scene. Shares neither probe
 * integration, interpolation, SH nor capture/replay code with the GI solver.
 * BVH acceleration is only a triangle-intersection implementation. */
export function createSceneLightingReference(data: ReferenceSceneData,
  transmit?: (origin: Vector3, direction: Vector3, distance: number) => number) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(data.uvs, 2))
  const tree = data.positions.length ? new MeshBVH(geometry, { strategy: SAH, targetLeafSize: 4 }) : null
  const ray = new Ray(), direction = new Vector3(), toLight = new Vector3(), sun = new Vector3().fromArray(data.sunDirection).normalize()
  const triangle = new Triangle(), bary = new Vector3()
  const surface = (hit: NonNullable<ReturnType<MeshBVH['raycastFirst']>>) => {
    const i = Math.floor(hit.face!.a / 3)
    const material = data.materials[data.materialIndices[i]]
    if (material.metalnessTexture || material.emissionTexture) {
      triangle.a.fromArray(data.positions, i * 9)
      triangle.b.fromArray(data.positions, i * 9 + 3)
      triangle.c.fromArray(data.positions, i * 9 + 6)
      triangle.getBarycoord(hit.point, bary)
    }
    return sampleReferenceSurface(data, i, hit.uv?.x ?? 0, hit.uv?.y ?? 0, bary)
  }
  const cast = (origin: Vector3, d: Vector3, far = 80) => {
    ray.set(origin, d)
    return tree?.raycastFirst(ray, DoubleSide, .0001, far) ?? null
  }
  const direct = (point: Vector3, normal: Vector3, gain: number, sunOnly=false): ReferenceRGB => {
    const rgb: ReferenceRGB = [0, 0, 0], cosine = Math.max(0, normal.dot(sun))
    if (cosine > 0 && !cast(point, sun)) {
      const visibility=transmit?.(point,sun,80)??1
      for (let c = 0; c < 3; c++) rgb[c] = data.sunIrradiance[c] * cosine * gain * visibility
    }
    if(sunOnly)return rgb
    for (const light of data.lights) {
      toLight.fromArray(light.position).sub(point)
      const distance = toLight.length()
      if (distance < .0001) continue
      toLight.multiplyScalar(1 / distance)
      let weight = Math.max(0, normal.dot(toLight)) / Math.max(.01, distance ** light.decay)
      if (light.distance > 0) weight *= Math.max(0, 1 - (distance / light.distance) ** 4) ** 2
      if (light.direction) {
        const cone = -(toLight.x * light.direction[0] + toLight.y * light.direction[1] + toLight.z * light.direction[2])
        const t = Math.max(0, Math.min(1, (cone - light.cone!) / Math.max(1e-12, light.penumbra! - light.cone!)))
        weight *= t * t * (3 - 2 * t)
      }
      if (weight > 0 && !cast(point, toLight, Math.max(.0001, distance - .0001))) {
        weight*=transmit?.(point,toLight,distance)??1
        for (let c = 0; c < 3; c++) rgb[c] += light.color[c] * light.intensity * weight
      }
    }
    return rgb
  }
  const environment = (d: Vector3): ReferenceRGB => data.skyBase.map((value, c) => d.y >= 0
    ? value * (data.skyMode === 'overcast' ? .5 + d.y : .6 + .8 * d.y)
    : .2 * (value * (data.skyMode === 'overcast' ? 7 / 6 : 17 / 15) + data.skySun[c] / Math.PI)) as ReferenceRGB
  return {
    visibleReceiver(camera: number[], estimate: number[]) {
      const eye = new Vector3().fromArray(camera), point = new Vector3().fromArray(estimate)
      const sight = point.clone().sub(eye).normalize(), hit = cast(eye, sight)
      if (!hit) return null
      const normal = hit.face!.normal.clone()
      if (normal.dot(sight) > 0) normal.negate()
      return { position: hit.point.toArray(), normal: normal.toArray(), rho: surface(hit).rho,
        material: data.materialIndices[Math.floor(hit.face!.a / 3)], distanceToEstimate: hit.point.distanceTo(point) }
    },
    /** Independent directional samples for spatial/angular error attribution.
     * A uniform-sphere quadrature can project these same paths to L1 and L2,
     * or integrate their cosine-weighted irradiance without either SH order. */
    incoming(position: number[], directions: number[][], samples = 8, depth = 6, seed = 1234, breakdown = false, maxEncounters = depth + 1) {
      let state=seed>>>0
      const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296}
      const point=new Vector3(),normal=new Vector3(),tangent=new Vector3(),bitangent=new Vector3()
      return directions.map(d=>{
        const radiance:ReferenceRGB=[0,0,0],sky:ReferenceRGB=[0,0,0]
        const components=breakdown?{sky:Array.from({length:depth+1},()=>[0,0,0]),direct:Array.from({length:depth},()=>[0,0,0])}:undefined
        point.fromArray(position);direction.fromArray(d).normalize()
        const firstHit=cast(point,direction),firstPass:ReferenceRGB=[0,0,0]
        if(!firstHit){const value=environment(direction);for(let c=0;c<3;c++)firstPass[c]=value[c]}
        else{
          const { rho, emission } = surface(firstHit)
          normal.copy(firstHit.face!.normal);if(normal.dot(direction)>0)normal.negate()
          point.copy(firstHit.point).addScaledVector(normal,.0002)
          const illumination=direct(point,normal,data.daylightGain)
          for(let c=0;c<3;c++)firstPass[c]=rho[c]*illumination[c]/Math.PI+(emission?.[c]??0)
        }
        for(let sample=0;sample<samples;sample++){
          point.fromArray(position);direction.fromArray(d).normalize()
          const throughput:ReferenceRGB=[1,1,1]
          for(let bounce=0;bounce<=depth&&bounce<maxEncounters;bounce++){
            const hit=cast(point,direction)
            // Snapshot skyBase/skySun already include the authored source gain.
            if(!hit){const value=environment(direction);for(let c=0;c<3;c++){radiance[c]+=throughput[c]*value[c]/samples;if(!bounce)sky[c]+=value[c]/samples;if(components)components.sky[bounce][c]+=throughput[c]*value[c]/samples}break}
            if(bounce===depth)break
            const { rho, emission } = surface(hit)
            normal.copy(hit.face!.normal);if(normal.dot(direction)>0)normal.negate()
            point.copy(hit.point).addScaledVector(normal,.0002)
            const illumination=direct(point,normal,data.daylightGain)
            for(let c=0;c<3;c++){radiance[c]+=throughput[c]*(emission?.[c]??0)/samples;throughput[c]*=rho[c];const value=throughput[c]*illumination[c]/Math.PI/samples;radiance[c]+=value;if(components)components.direct[bounce][c]+=value}
            if(Math.max(...throughput)<1e-10)break
            tangent.crossVectors(Math.abs(normal.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0),normal).normalize();bitangent.crossVectors(normal,tangent)
            const u=random(),angle=2*Math.PI*random(),radius=Math.sqrt(u)
            direction.copy(normal).multiplyScalar(Math.sqrt(1-u)).addScaledVector(tangent,radius*Math.cos(angle)).addScaledVector(bitangent,radius*Math.sin(angle))
          }
        }
        return{radiance,sky,firstPass,...(components?{components,firstHit:firstHit?{distance:firstHit.distance,point:firstHit.point.toArray(),normal:firstHit.face!.normal.toArray(),triangle:Math.floor(firstHit.face!.a/3),material:data.materialIndices[Math.floor(firstHit.face!.a/3)]}:null}:{})}
      })
    },
    evaluate(receiver: ReferenceReceiver, samples = 16384, depth = 6, seed = 1234, maxEncounters = depth + 1, taggedSun=false, breakdown=false) {
      let state = seed >>> 0, rays = 0
      const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state + .5) / 4294967296 }
      const original = new Vector3().fromArray(receiver.position), originalNormal = new Vector3().fromArray(receiver.normal).normalize()
      const start = original.clone().addScaledVector(new Vector3().fromArray(receiver.geometricNormal).normalize(), .0002)
      const directRGB = direct(start, originalNormal, 1), sky: ReferenceRGB = [0, 0, 0], reflected: ReferenceRGB = [0, 0, 0]
      const skySquare: ReferenceRGB = [0, 0, 0], reflectedSquare: ReferenceRGB = [0, 0, 0]
      const bank=()=>Array.from({length:3},()=>Array.from({length:maxEncounters},()=>[0,0,0])),tagged=taggedSun?bank():undefined,taggedSquare=taggedSun?bank():undefined
      const point = new Vector3(), normal = new Vector3(), tangent = new Vector3(), bitangent = new Vector3()
      const byOrder=breakdown?Array.from({length:depth+1},()=>({sky:[0,0,0],solar:[0,0,0],exteriorGround:[0,0,0]})):undefined
      for (let sample = 0; sample < samples; sample++) {
        point.copy(start); normal.copy(originalNormal)
        const throughput: ReferenceRGB = [Math.PI, Math.PI, Math.PI], sampleSky: ReferenceRGB = [0, 0, 0], sampleReflected: ReferenceRGB = [0, 0, 0]
        const sampleTagged=taggedSun?bank():undefined
        let firstHitGround=false
        for (let bounce = 0; bounce <= depth && bounce < maxEncounters; bounce++) {
          const u = random(), angle = 2 * Math.PI * random(), radius = Math.sqrt(u)
          tangent.crossVectors(Math.abs(normal.y) < .9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0), normal).normalize()
          bitangent.crossVectors(normal, tangent)
          direction.copy(normal).multiplyScalar(Math.sqrt(1 - u)).addScaledVector(tangent, radius * Math.cos(angle)).addScaledVector(bitangent, radius * Math.sin(angle))
          const hit = cast(point, direction); rays++
          if(transmit){
            const through=transmit(point,direction,hit?.distance??80)
            for(let c=0;c<3;c++)throughput[c]*=through
          }
          if (!hit) {
            const value = environment(direction), target = bounce === 0 ? sampleSky : sampleReflected
            for (let c = 0; c < 3; c++) {
              const energy=throughput[c]*value[c]
              target[c]+=energy
              if(byOrder){byOrder[bounce].sky[c]+=energy;if(firstHitGround)byOrder[bounce].exteriorGround[c]+=energy}
            }
            break
          }
          if (bounce === depth) break
          const sourceTriangle = Math.floor(hit.face!.a / 3), { rho, emission } = surface(hit)
          if(bounce===0)firstHitGround=data.sourceCategories?.[sourceTriangle]===3
          normal.copy(hit.face!.normal)
          if (normal.dot(direction) > 0) normal.negate()
          point.copy(hit.point).addScaledVector(normal, .0002)
          const incident = direct(point, normal, data.daylightGain)
          if(sampleTagged){const solar=direct(point,normal,data.daylightGain,true),category=data.sourceCategories?.[sourceTriangle]??0
            for(let c=0;c<3;c++){const value=throughput[c]*rho[c]/Math.PI*solar[c];sampleTagged[0][bounce][c]+=value;if(category===1||category===2)sampleTagged[category][bounce][c]+=value}}
          for (let c = 0; c < 3; c++) {
            const light=throughput[c]*(rho[c]/Math.PI*incident[c]+(emission?.[c]??0))
            sampleReflected[c]+=light
            if(byOrder){byOrder[bounce+1].solar[c]+=light;if(firstHitGround)byOrder[bounce+1].exteriorGround[c]+=light}
            throughput[c] *= rho[c]
          }
          if (Math.max(...throughput) < 1e-10) break
        }
        for (let c = 0; c < 3; c++) {
          sky[c] += sampleSky[c]; skySquare[c] += sampleSky[c] ** 2
          reflected[c] += sampleReflected[c]; reflectedSquare[c] += sampleReflected[c] ** 2
        }
        if(sampleTagged)for(let group=0;group<3;group++)for(let c=0;c<3;c++){let cumulative=0;for(let pass=0;pass<maxEncounters;pass++){cumulative+=sampleTagged[group][pass][c];tagged![group][pass][c]+=cumulative;taggedSquare![group][pass][c]+=cumulative**2}}
      }
      const mean = (sum: ReferenceRGB) => sum.map(value => value / samples)
      const stderr = (sum: ReferenceRGB, square: ReferenceRGB) => sum.map((value, c) => Math.sqrt(Math.max(0, square[c] / samples - (value / samples) ** 2) / samples))
      return { name: receiver.name, direct: directRGB, sky: mean(sky), reflected: mean(reflected),
        ...(byOrder?{byOrder:byOrder.map(row=>({sky:mean(row.sky),solar:mean(row.solar),exteriorGround:mean(row.exteriorGround)}))}:{}),
        ...(tagged?{solarContributions:['allSurfaceSun','duvet','wall'].map((name,g)=>({name,cumulative:tagged[g].map(a=>a.map(v=>v/samples)),standardError:tagged[g].map((a,p)=>a.map((v,c)=>Math.sqrt(Math.max(0,taggedSquare![g][p][c]/samples-(v/samples)**2)/samples)))}))}:{}),
        skyStandardError: stderr(sky, skySquare), reflectedStandardError: stderr(reflected, reflectedSquare), samples, depth, maxEncounters, rays,
        method: 'independent scene-triangle diffuse path integration; no SH, probes, volume or capture replay',
        limitations: ['Secondary paths use geometric face normals and diffuse albedo, including base-colour textures; they exclude specular transport and secondary normal-map perturbation.',
          'Explicit point and spot lamps are included. Mesh emission is included when present in the snapshot.',
          'Sun and lamps use exact hard visibility, rather than the display shadow-map filter. Authored daylight gain is applied once to transported daylight.'] }
    },
    dispose() { geometry.dispose() },
  }
}
