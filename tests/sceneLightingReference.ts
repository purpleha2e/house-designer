import { BufferAttribute, BufferGeometry, DataUtils, DoubleSide, Ray, Vector3 } from 'three'
import { MeshBVH, SAH } from 'three-mesh-bvh'

export type ReferenceRGB = [number, number, number]
export type ReferenceTexture = { width: number; height: number; pixels: Uint16Array }
export type ReferenceMaterial = { color: ReferenceRGB; metalness: number; map: number; matrix: number[]; wrapS: number; wrapT: number }
export type ReferenceLight = { position: number[]; color: ReferenceRGB; intensity: number; distance: number; decay: number;
  direction?: number[]; cone?: number; penumbra?: number }
export type ReferenceSceneData = { positions: Float32Array; uvs: Float32Array;
  materialIndices: Uint16Array; materials: ReferenceMaterial[]; textures: ReferenceTexture[];
  skyBase: ReferenceRGB; skySun: ReferenceRGB; skyMode: 'clear' | 'overcast';
  sunDirection: number[]; sunIrradiance: ReferenceRGB; daylightGain: number; lights: ReferenceLight[];
  /** Diagnostic source attribution: 1 duvet, 2 selected walls; geometry stays opaque. */
  sourceCategories?: Uint8Array }
export type ReferenceReceiver = { name: string; position: number[]; normal: number[]; geometricNormal: number[] }

/** Independent diffuse transport over the actual scene. Shares neither probe
 * integration, interpolation, SH nor capture/replay code with the GI solver.
 * BVH acceleration is only a triangle-intersection implementation. */
export function createSceneLightingReference(data: ReferenceSceneData) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(data.uvs, 2))
  const tree = data.positions.length ? new MeshBVH(geometry, { strategy: SAH, targetLeafSize: 4 }) : null
  const ray = new Ray(), direction = new Vector3(), toLight = new Vector3(), sun = new Vector3().fromArray(data.sunDirection).normalize()
  const sampleTexture = (index: number, u: number, v: number, material: ReferenceMaterial) => {
    const texture = data.textures[index], matrix = material.matrix
    const tx = matrix[0] * u + matrix[3] * v + matrix[6], ty = matrix[1] * u + matrix[4] * v + matrix[7]
    // Three constants: Repeat=1000, ClampToEdge=1001, MirroredRepeat=1002.
    const wrap = (x: number, mode: number) => mode === 1001 ? Math.max(0, Math.min(1, x)) :
      mode === 1002 ? (Math.abs(Math.floor(x)) % 2 ? 1 - (x - Math.floor(x)) : x - Math.floor(x)) : x - Math.floor(x)
    const x = wrap(tx, material.wrapS) * texture.width - .5, y = wrap(ty, material.wrapT) * texture.height - .5
    const rgb: ReferenceRGB = [0, 0, 0]
    const pixel = (i: number, count: number, mode: number) => mode === 1001 ? Math.max(0, Math.min(count - 1, i)) :
      Math.min(count - 1, Math.floor(wrap((i + .5) / count, mode) * count))
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const ix = pixel(Math.floor(x) + dx, texture.width, material.wrapS), iy = pixel(Math.floor(y) + dy, texture.height, material.wrapT)
      const weight = (dx ? x - Math.floor(x) : 1 - x + Math.floor(x)) * (dy ? y - Math.floor(y) : 1 - y + Math.floor(y))
      for (let c = 0; c < 3; c++) rgb[c] += DataUtils.fromHalfFloat(texture.pixels[(iy * texture.width + ix) * 4 + c]) * weight
    }
    return rgb
  }
  const cast = (origin: Vector3, d: Vector3, far = 80) => {
    ray.set(origin, d)
    return tree?.raycastFirst(ray, DoubleSide, .0001, far) ?? null
  }
  const direct = (point: Vector3, normal: Vector3, gain: number, sunOnly=false): ReferenceRGB => {
    const rgb: ReferenceRGB = [0, 0, 0], cosine = Math.max(0, normal.dot(sun))
    if (cosine > 0 && !cast(point, sun)) for (let c = 0; c < 3; c++) rgb[c] = data.sunIrradiance[c] * cosine * gain
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
      if (weight > 0 && !cast(point, toLight, Math.max(.0001, distance - .0001)))
        for (let c = 0; c < 3; c++) rgb[c] += light.color[c] * light.intensity * weight
    }
    return rgb
  }
  const environment = (d: Vector3): ReferenceRGB => data.skyBase.map((value, c) => d.y >= 0
    ? value * (data.skyMode === 'overcast' ? .5 + d.y : .6 + .8 * d.y)
    : .2 * (value * (data.skyMode === 'overcast' ? 7 / 6 : 17 / 15) + data.skySun[c] / Math.PI)) as ReferenceRGB
  return {
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
          const material=data.materials[data.materialIndices[Math.floor(firstHit.face!.a/3)]],map=material.map>=0?sampleTexture(material.map,firstHit.uv?.x??0,firstHit.uv?.y??0,material):[1,1,1]
          normal.copy(firstHit.face!.normal);if(normal.dot(direction)>0)normal.negate()
          point.copy(firstHit.point).addScaledVector(normal,.0002)
          const illumination=direct(point,normal,data.daylightGain)
          for(let c=0;c<3;c++)firstPass[c]=material.color[c]*map[c]*(1-material.metalness)*illumination[c]/Math.PI
        }
        for(let sample=0;sample<samples;sample++){
          point.fromArray(position);direction.fromArray(d).normalize()
          const throughput:ReferenceRGB=[1,1,1]
          for(let bounce=0;bounce<=depth&&bounce<maxEncounters;bounce++){
            const hit=cast(point,direction)
            // Snapshot skyBase/skySun already include the authored source gain.
            if(!hit){const value=environment(direction);for(let c=0;c<3;c++){radiance[c]+=throughput[c]*value[c]/samples;if(!bounce)sky[c]+=value[c]/samples;if(components)components.sky[bounce][c]+=throughput[c]*value[c]/samples}break}
            if(bounce===depth)break
            const material=data.materials[data.materialIndices[Math.floor(hit.face!.a/3)]]
            const map=material.map>=0?sampleTexture(material.map,hit.uv?.x??0,hit.uv?.y??0,material):[1,1,1]
            normal.copy(hit.face!.normal);if(normal.dot(direction)>0)normal.negate()
            point.copy(hit.point).addScaledVector(normal,.0002)
            const illumination=direct(point,normal,data.daylightGain)
            for(let c=0;c<3;c++){const rho=material.color[c]*map[c]*(1-material.metalness);throughput[c]*=rho;const value=throughput[c]*illumination[c]/Math.PI/samples;radiance[c]+=value;if(components)components.direct[bounce][c]+=value}
            if(Math.max(...throughput)<1e-10)break
            tangent.crossVectors(Math.abs(normal.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0),normal).normalize();bitangent.crossVectors(normal,tangent)
            const u=random(),angle=2*Math.PI*random(),radius=Math.sqrt(u)
            direction.copy(normal).multiplyScalar(Math.sqrt(1-u)).addScaledVector(tangent,radius*Math.cos(angle)).addScaledVector(bitangent,radius*Math.sin(angle))
          }
        }
        return{radiance,sky,firstPass,...(components?{components,firstHit:firstHit?{distance:firstHit.distance,point:firstHit.point.toArray(),normal:firstHit.face!.normal.toArray(),triangle:Math.floor(firstHit.face!.a/3),material:data.materialIndices[Math.floor(firstHit.face!.a/3)]}:null}:{})}
      })
    },
    evaluate(receiver: ReferenceReceiver, samples = 16384, depth = 6, seed = 1234, maxEncounters = depth + 1, taggedSun=false) {
      let state = seed >>> 0, rays = 0
      const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state + .5) / 4294967296 }
      const original = new Vector3().fromArray(receiver.position), originalNormal = new Vector3().fromArray(receiver.normal).normalize()
      const start = original.clone().addScaledVector(new Vector3().fromArray(receiver.geometricNormal).normalize(), .0002)
      const directRGB = direct(start, originalNormal, 1), sky: ReferenceRGB = [0, 0, 0], reflected: ReferenceRGB = [0, 0, 0]
      const skySquare: ReferenceRGB = [0, 0, 0], reflectedSquare: ReferenceRGB = [0, 0, 0]
      const bank=()=>Array.from({length:3},()=>Array.from({length:maxEncounters},()=>[0,0,0])),tagged=taggedSun?bank():undefined,taggedSquare=taggedSun?bank():undefined
      const point = new Vector3(), normal = new Vector3(), tangent = new Vector3(), bitangent = new Vector3()
      for (let sample = 0; sample < samples; sample++) {
        point.copy(start); normal.copy(originalNormal)
        const throughput: ReferenceRGB = [Math.PI, Math.PI, Math.PI], sampleSky: ReferenceRGB = [0, 0, 0], sampleReflected: ReferenceRGB = [0, 0, 0]
        const sampleTagged=taggedSun?bank():undefined
        for (let bounce = 0; bounce <= depth && bounce < maxEncounters; bounce++) {
          const u = random(), angle = 2 * Math.PI * random(), radius = Math.sqrt(u)
          tangent.crossVectors(Math.abs(normal.y) < .9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0), normal).normalize()
          bitangent.crossVectors(normal, tangent)
          direction.copy(normal).multiplyScalar(Math.sqrt(1 - u)).addScaledVector(tangent, radius * Math.cos(angle)).addScaledVector(bitangent, radius * Math.sin(angle))
          const hit = cast(point, direction); rays++
          if (!hit) {
            const value = environment(direction), target = bounce === 0 ? sampleSky : sampleReflected
            for (let c = 0; c < 3; c++) target[c] += throughput[c] * value[c]
            break
          }
          if (bounce === depth) break
          const sourceTriangle = Math.floor(hit.face!.a / 3), material = data.materials[data.materialIndices[sourceTriangle]]
          const map = material.map >= 0 ? sampleTexture(material.map, hit.uv?.x ?? 0, hit.uv?.y ?? 0, material) : [1, 1, 1]
          const rho = material.color.map((value, c) => value * map[c] * (1 - material.metalness))
          normal.copy(hit.face!.normal)
          if (normal.dot(direction) > 0) normal.negate()
          point.copy(hit.point).addScaledVector(normal, .0002)
          const incident = direct(point, normal, data.daylightGain)
          if(sampleTagged){const solar=direct(point,normal,data.daylightGain,true),category=data.sourceCategories?.[sourceTriangle]??0
            for(let c=0;c<3;c++){const value=throughput[c]*rho[c]/Math.PI*solar[c];sampleTagged[0][bounce][c]+=value;if(category===1||category===2)sampleTagged[category][bounce][c]+=value}}
          for (let c = 0; c < 3; c++) {
            sampleReflected[c] += throughput[c] * rho[c] / Math.PI * incident[c]
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
        ...(tagged?{solarContributions:['allSurfaceSun','duvet','wall'].map((name,g)=>({name,cumulative:tagged[g].map(a=>a.map(v=>v/samples)),standardError:tagged[g].map((a,p)=>a.map((v,c)=>Math.sqrt(Math.max(0,taggedSquare![g][p][c]/samples-(v/samples)**2)/samples)))}))}:{}),
        skyStandardError: stderr(sky, skySquare), reflectedStandardError: stderr(reflected, reflectedSquare), samples, depth, maxEncounters, rays,
        method: 'independent scene-triangle diffuse path integration; no SH, probes, volume or capture replay',
        limitations: ['Secondary paths use geometric face normals and diffuse albedo, including base-colour textures; they exclude specular transport and secondary normal-map perturbation.',
          'Mesh-material emission is excluded; explicit point/spot lamps are included.',
          'Sun and lamps use exact hard visibility, rather than the display shadow-map filter. Authored daylight gain is applied once to transported daylight.'] }
    },
    dispose() { geometry.dispose() },
  }
}
