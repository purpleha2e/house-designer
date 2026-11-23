import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Triangle, Vector3 } from 'three'
import { CENTER, MeshBVH } from 'three-mesh-bvh'
import { sampleReferenceSurface, type ReferenceLight, type ReferenceRGB, type ReferenceSceneData } from './diffuseSceneMaterials.ts'
import { createIndirectSegmentQuery } from './indirectSegmentQuery.ts'
import { indirectSHIrradianceBasis } from './indirectSH.ts'
import { projectSixRayRadiance, sixRayDirections, type SixRayMode, type SixRayTarget } from './sixRaySampling.ts'

export type SixRayOpening = {
  id: string; center: number[]; normal: number[]; u: number[]; v: number[]; width: number; height: number
}
export type SixRayLighting = Pick<ReferenceSceneData, 'sunDirection' | 'sunIrradiance' | 'skyBase' | 'skyMode' | 'skySun' | 'daylightGain' | 'lights'>
export type SixRayOptions = { mode: SixRayMode; primary: 6 | 12 | 24; secondary: 0 | 4 | 8 }
export const SIX_RAY_VOLUME_RESOLUTION = { volumeSpacing: .6, floorSpacing: 1, maskSize: 192 }
type TriangleHit = NonNullable<ReturnType<MeshBVH['raycastFirst']>>
type Surface = ReturnType<typeof sampleReferenceSurface> & {
  point: Vector3; origin: Vector3; normal: Vector3; triangle: number; material: number; uv: number[];
  sun?: { key: string; visible: boolean }
  lamps?: { key: string; irradiance: ReferenceRGB }
  sky?: { direction: Vector3; weight: number } | null
}
type Opening = Omit<SixRayOpening, 'center' | 'normal' | 'u' | 'v'> & {
  center: Vector3; normal: Vector3; u: Vector3; v: Vector3; area: number
}
type PreparedLight = ReferenceLight & { point: Vector3; axis?: Vector3; energy: number }
type Path = { surface: Surface | null; secondary: Map<number, { direction: Vector3; hit: Surface | null }[]> }
type Patch = { opening: Opening; surface: Surface; area: number }
type Candidate = SixRayTarget & { point: Vector3; distance: number; visible?: boolean; opening?: Opening }
type ProbeCache = { key: string; paths: Map<string, Path> }
const zero = (): ReferenceRGB => [0, 0, 0]
const luminance = (rgb: ReferenceRGB) => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
const skyRange = 160
const epsilon = .001
const axisY = new Vector3(0, 1, 0), axisX = new Vector3(1, 0, 0)
const add = (a: ReferenceRGB, b: ReferenceRGB, scale = 1) => {
  for (let c = 0; c < 3; c++) a[c] += b[c] * scale
}
function attenuation(light: PreparedLight, direction: Vector3, distance: number) {
  if (distance <= epsilon || (light.distance > 0 && distance >= light.distance)) return 0
  let value = 1 / Math.max(.01, distance ** light.decay)
  if (light.distance > 0) value *= (1 - (distance / light.distance) ** 4) ** 2
  if (light.axis) {
    const cone = -direction.dot(light.axis)
    const t = Math.max(0, Math.min(1, (cone - light.cone!) / Math.max(1e-12, light.penumbra! - light.cone!)))
    value *= t * t * (3 - 2 * t)
  }
  return value
}

function emptyStats() {
  return { primaryRays: 0, secondaryRays: 0, shadowRays: 0, candidateRays: 0,
    primaryMs: 0, secondaryMs: 0, shadowMs: 0, candidateMs: 0, materialMs: 0, projectionMs: 0, solveMs: 0,
    primaryCacheHits: 0, secondaryCacheHits: 0 }
}

export type SixRayInspection = ReturnType<ReturnType<typeof createSixRaySolver>['inspect']>

/** Geometry, material and intersection caches are owned by one immutable
 * snapshot. Exact origins/directions distinguish paths within that snapshot. */
export function createSixRaySolver(data: ReferenceSceneData, apertureData: SixRayOpening[]) {
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(data.positions, 3))
    .setAttribute('uv', new BufferAttribute(data.uvs, 2))
  const tree = data.positions.length ? new MeshBVH(geometry, { strategy: CENTER, targetLeafSize: 8 }) : null
  const blocked = createIndirectSegmentQuery(tree)
  const ray = new Ray(), triangle = new Triangle(), bary = new Vector3(), toLight = new Vector3()
  const openings: Opening[] = apertureData.filter(a => a.width > 0 && a.height > 0).map(a => ({ ...a,
    center: new Vector3().fromArray(a.center), normal: new Vector3().fromArray(a.normal).normalize(),
    u: new Vector3().fromArray(a.u), v: new Vector3().fromArray(a.v), area: a.width * a.height }))
  const caches = new Map<SixRayMode, Map<number, ProbeCache>>()
  const visibleOpenings = new Map<string, Candidate[]>()
  const visibleLamps = new Map<string, Candidate[]>()
  const fixed = new Map([6, 12, 24].map(count => [count, sixRayDirections('six-fixed', [], count)]))
  let candidateLampKey = ''
  let patchKey = '', patches: Patch[] = []
  let stats = emptyStats()

  function cast(origin: Vector3, direction: Vector3, type: 'primary' | 'secondary' | 'candidate', max = skyRange) {
    const start = performance.now()
    const hit = tree?.raycastFirst(ray.set(origin, direction), DoubleSide, epsilon, max) ?? null
    stats[`${type}Rays`]++
    if (type !== 'candidate') stats[`${type}Ms`] += performance.now() - start
    return hit
  }
  function surface(hit: TriangleHit | null, direction: Vector3): Surface | null {
    if (!hit?.face) return null
    const start = performance.now(), i = Math.floor(hit.face.a / 3), material = data.materialIndices[i]
    const entry = data.materials[material], u = hit.uv?.x ?? 0, v = hit.uv?.y ?? 0
    if (entry.metalnessTexture || entry.emissionTexture) {
      triangle.a.fromArray(data.positions, i * 9)
      triangle.b.fromArray(data.positions, i * 9 + 3)
      triangle.c.fromArray(data.positions, i * 9 + 6)
      triangle.getBarycoord(hit.point, bary)
    }
    const { rho, emission } = sampleReferenceSurface(data, i, u, v, bary)
    const normal = hit.face.normal
    if (normal.dot(direction) > 0) normal.negate()
    const result = { rho, emission, triangle: i, material, uv: [u, v], normal, point: hit.point,
      origin: hit.point.clone().addScaledVector(normal, epsilon) }
    stats.materialMs += performance.now() - start
    return result
  }
  function occluded(origin: Vector3, direction: Vector3, far: number, type: 'candidate' | 'shadow') {
    const start = performance.now()
    const hit = blocked(origin, direction, far, epsilon)
    if (type === 'shadow') { stats.shadowRays++; stats.shadowMs += performance.now() - start }
    else stats.candidateRays++
    return hit
  }
  function sources(lighting: SixRayLighting) {
    const sun = new Vector3().fromArray(lighting.sunDirection).normalize()
    const sunKey = sun.toArray().join(',')
    const solar = lighting.sunIrradiance.map(c => c * lighting.daylightGain) as ReferenceRGB
    const solarEnergy = sun.y > 0 ? luminance(solar) : 0
    const skyEnergy = luminance(lighting.skyBase)
    const lights: PreparedLight[] = lighting.lights.filter(l => l.intensity > 0).map(l => ({ ...l,
      point: new Vector3().fromArray(l.position), axis: l.direction ? new Vector3().fromArray(l.direction) : undefined,
      energy: l.intensity * luminance(l.color) }))
    const lampKey = JSON.stringify(lighting.lights)
    const sky = (direction: Vector3) => lighting.skyBase.map((c, i) => direction.y >= 0
      ? c * (lighting.skyMode === 'overcast' ? .5 + direction.y : .6 + .8 * direction.y)
      : .2 * (c * (lighting.skyMode === 'overcast' ? 7 / 6 : 17 / 15) + lighting.skySun[i] / Math.PI)) as ReferenceRGB
    return { sun, sunKey, solar, solarEnergy, skyEnergy, lights, lampKey, sky }
  }
  type Sources = ReturnType<typeof sources>

  function openingCandidate(probe: Vector3, opening: Opening, point = opening.center): Candidate | undefined {
    const direction = point.clone().sub(probe), distance = direction.length()
    if (distance < .02 || distance > 18) return
    direction.multiplyScalar(1 / distance)
    const solidAngle = Math.min(2 * Math.PI, opening.area * Math.abs(opening.normal.dot(direction)) / (distance * distance))
    if (solidAngle < .001) return
    return { kind: 'opening', id: opening.id, point, distance, score: solidAngle, solidAngle, direction, opening }
  }

  function preparePatches(light: Sources) {
    if (!light.solarEnergy || light.sunKey === patchKey) return
    const down = light.sun.clone().negate()
    const next: Patch[] = []
    for (const opening of openings) {
      const projected = Math.abs(opening.normal.dot(light.sun)) * opening.area
      if (projected < .005) continue
      const points = [[0, 0], [-.28, -.25], [.28, -.25], [-.28, .25], [.28, .25]]
      for (const [u, v] of points) {
        const point = opening.center.clone().addScaledVector(opening.u, u * opening.width).addScaledVector(opening.v, v * opening.height)
        if (occluded(point, light.sun, skyRange, 'candidate')) continue
        const hit = surface(cast(point, down, 'candidate', 14), down)
        if (!hit) continue
        const cosine = hit.normal.dot(light.sun)
        if (cosine > .05 && hit.point.distanceTo(point) > .12) next.push({ opening, surface: hit, area: projected / cosine })
      }
    }
    patches = next
    patchKey = light.sunKey
  }

  function rank(probe: Vector3, light: Sources, diagnostic: boolean) {
    const start = performance.now()
    const key = probe.toArray().join(',')
    let apertures = visibleOpenings.get(key)
    if (light.skyEnergy > 0 && !apertures) {
      apertures = openings.flatMap(opening => openingCandidate(probe, opening) ?? [])
        .sort((a, b) => b.solidAngle - a.solidAngle).slice(0, 8)
      for (const candidate of apertures) {
        // Actual mullions and reveals can block the centre of a cutout.
        // Keep one representative clear direction from the small shortlist.
        const opening = candidate.opening!
        for (const offset of [0, -.24, .24]) {
          const sample = offset ? openingCandidate(probe, opening,
            opening.center.clone().addScaledVector(opening.u, offset * opening.width)) : candidate
          if (sample && !occluded(probe, sample.direction, sample.distance + .18, 'candidate')) {
            Object.assign(candidate, sample, { visible: true })
            break
          }
        }
      }
      visibleOpenings.set(key, apertures)
    }
    const windows = light.skyEnergy > 0 ? (apertures ?? []).map(candidate => ({ ...candidate,
      score: candidate.solidAngle * luminance(light.sky(candidate.direction)) *
        (1 + .25 * Math.abs(candidate.opening!.normal.dot(light.sun)) * Math.min(1, light.solarEnergy)) })) : []
    if (candidateLampKey !== light.lampKey) { visibleLamps.clear(); candidateLampKey = light.lampKey }
    let lamps = visibleLamps.get(key)
    if (!lamps) {
      lamps = []
      for (const [i, lamp] of light.lights.entries()) {
        const direction = lamp.point.clone().sub(probe), distance = direction.length()
        if (distance <= epsilon) continue
        direction.multiplyScalar(1 / distance)
        const score = lamp.energy * attenuation(lamp, direction, distance)
        if (score > .001) lamps.push({ kind: 'lamp', id: 'Lamp ' + (i + 1),
          direction, point: lamp.point, distance, score, solidAngle: .15 })
      }
      lamps = lamps.sort((a, b) => b.score - a.score).slice(0, 4)
      for (const lamp of lamps) lamp.visible = !occluded(probe, lamp.direction, lamp.distance - .025, 'candidate')
      visibleLamps.set(key, lamps)
    }
    const solar: Candidate[] = []
    if (light.solarEnergy > 0) for (const patch of patches) {
      const hit = patch.surface, direction = hit.point.clone().sub(probe), distance = direction.length()
      if (distance < .05 || distance > 12) continue
      direction.multiplyScalar(1 / distance)
      const solidAngle = Math.min(Math.PI, patch.area * Math.max(0, -hit.normal.dot(direction)) / (distance * distance))
      const score = solidAngle * luminance(hit.rho) * light.solarEnergy * hit.normal.dot(light.sun) / Math.PI
      if (score > .001) solar.push({ kind: 'sunlit surface', id: patch.opening.id, direction, point: hit.point, distance, score, solidAngle })
    }
    const bestPatches = solar.sort((a, b) => b.score - a.score).slice(0, 6)
    for (const patch of bestPatches) patch.visible = !occluded(probe, patch.direction, patch.distance - .005, 'candidate')
    const ranked = [...windows, ...lamps, ...bestPatches].sort((a, b) => b.score - a.score)
    stats.candidateMs += performance.now() - start
    return { selected: ranked.filter(candidate => candidate.visible), details: diagnostic ? ranked : undefined }
  }

  function direct(hit: Surface, light: Sources) {
    if (hit.lamps?.key !== light.lampKey) {
      const received = zero()
      for (const lamp of light.lights) {
        toLight.subVectors(lamp.point, hit.origin)
        const distance = toLight.length()
        if (distance < epsilon) continue
        toLight.multiplyScalar(1 / distance)
        const weight = hit.normal.dot(toLight) * attenuation(lamp, toLight, distance)
        if (weight * lamp.energy < .0005 || occluded(hit.origin, toLight, distance - epsilon, 'shadow')) continue
        add(received, lamp.color, lamp.intensity * weight)
      }
      hit.lamps = { key: light.lampKey, irradiance: received }
    }
    const irradiance = [...hit.lamps.irradiance] as ReferenceRGB
    const cosine = hit.normal.dot(light.sun)
    let solarVisible = false
    if (cosine > 0 && light.solarEnergy > 0) {
      if (hit.sun?.key !== light.sunKey) hit.sun = { key: light.sunKey,
        visible: !occluded(hit.origin, light.sun, skyRange, 'shadow') }
      solarVisible = hit.sun.visible
      if (solarVisible) add(irradiance, light.solar, cosine)
    }
    return { irradiance, solarVisible }
  }

  // Terminal diffuse sky estimate through a single aperture. This represents
  // sky at the last surface only. Primary escapes are integrated by the
  // hemisphere samples when those are enabled.
  function terminalSky(hit: Surface, light: Sources) {
    const rgb = zero()
    if (!light.skyEnergy) return rgb
    if (hit.sky !== undefined) {
      if (hit.sky) add(rgb, light.sky(hit.sky.direction), hit.sky.weight)
      return rgb
    }
    let best: Opening | undefined, weight = 0
    const direction = new Vector3()
    for (const opening of openings) {
      direction.subVectors(opening.center, hit.origin)
      const d2 = direction.lengthSq()
      if (d2 < .01 || d2 > 100) continue
      direction.multiplyScalar(1 / Math.sqrt(d2))
      const estimate = Math.min(Math.PI, opening.area * Math.abs(opening.normal.dot(direction)) / d2) * hit.normal.dot(direction)
      if (estimate > weight) { best = opening; weight = estimate }
    }
    hit.sky = null
    if (best && weight > .001) {
      direction.subVectors(best.center, hit.origin).normalize()
      if (!occluded(hit.origin, direction, skyRange, 'shadow')) {
        hit.sky = { direction, weight }
        add(rgb, light.sky(direction), weight)
      }
    }
    return rgb
  }
  const describe = (hit: Surface | null) => hit && ({
    point: hit.point.toArray(), normal: hit.normal.toArray(), triangle: hit.triangle,
    material: hit.material, uv: hit.uv, reflectance: hit.rho,
  })

  function bouncePaths(hit: Surface, index: number, count: number) {
    const tangent = new Vector3().crossVectors(Math.abs(hit.normal.y) < .9 ? axisY : axisX, hit.normal).normalize()
    const bitangent = new Vector3().crossVectors(hit.normal, tangent)
    // Equal strata in projected disk area. Their PDF is cosine / pi, so
    // cosine / (N * PDF) is pi / N and the Lambert factor cancels.
    const phase = ((index * .61803398875 + hit.triangle * .3806) % 1) * Math.PI * 2
    return Array.from({ length: count }, (_, i) => {
      const u = (i + .5) / count, phi = phase + i * Math.PI * (3 - Math.sqrt(5))
      const direction = hit.normal.clone().multiplyScalar(Math.sqrt(1 - u))
        .addScaledVector(tangent, Math.sqrt(u) * Math.cos(phi)).addScaledVector(bitangent, Math.sqrt(u) * Math.sin(phi))
      return { direction, hit: surface(cast(hit.origin, direction, 'secondary'), direction) }
    })
  }

  function evaluate(index: number, probe: Vector3, options: SixRayOptions, light: Sources, diagnostic = false) {
    const { mode, primary, secondary } = options
    const ranked = mode === 'six-fixed' && !diagnostic ? { selected: [], details: undefined } : rank(probe, light, diagnostic)
    const samples = mode === 'six-fixed' ? fixed.get(primary)! : sixRayDirections(mode, ranked.selected, primary)
    let bank = caches.get(mode)
    if (!bank) { bank = new Map(); caches.set(mode, bank) }
    const originKey = probe.toArray().join(',')
    const previous = bank.get(index), paths = new Map<string, Path>()
    type SecondaryTrace = { direction: number[]; hit: ReturnType<typeof describe>; radiance: ReferenceRGB }
    const traces: { direction: number[]; target?: Pick<SixRayTarget, 'id' | 'kind' | 'score'>;
      hit: ReturnType<typeof describe>; solarVisible: boolean; first: ReferenceRGB; second: ReferenceRGB; secondary: SecondaryTrace[] }[] = []
    const radiance = samples.map(({ direction, target }) => {
      const key = direction.toArray().join(',')
      let path = previous?.key === originKey ? previous.paths.get(key) : undefined
      if (path) stats.primaryCacheHits++
      else path = { surface: surface(cast(probe, direction, 'primary'), direction), secondary: new Map() }
      paths.set(key, path)
      const hit = path.surface, first = zero(), second = zero(), secondaryRays: SecondaryTrace[] = []
      let solarVisible = false
      if (!hit) add(first, light.sky(direction))
      else {
        const directLight = direct(hit, light)
        solarVisible = directLight.solarVisible
        if (secondary === 0) add(directLight.irradiance, terminalSky(hit, light))
        for (let c = 0; c < 3; c++) first[c] = (hit.emission?.[c] ?? 0) + hit.rho[c] * directLight.irradiance[c] / Math.PI
        let bounces = path.secondary.get(secondary)
        if (bounces) stats.secondaryCacheHits += bounces.length
        else {
          bounces = secondary ? bouncePaths(hit, index, secondary) : []
          path.secondary.set(secondary, bounces)
        }
        for (const { direction: d, hit: other } of bounces) {
          const incoming = other ? direct(other, light).irradiance : light.sky(d)
          if (other) {
            add(incoming, terminalSky(other, light))
            for (let c = 0; c < 3; c++) incoming[c] = (other.emission?.[c] ?? 0) + other.rho[c] * incoming[c] / Math.PI
          }
          const bounce = other ? second : first
          for (let c = 0; c < 3; c++) bounce[c] += hit.rho[c] * incoming[c] / secondary
          if (diagnostic) secondaryRays.push({ direction: d.toArray(), hit: describe(other), radiance: incoming })
        }
      }
      if (diagnostic) traces.push({ direction: direction.toArray(), target: target && { id: target.id, kind: target.kind, score: target.score },
        hit: describe(hit), solarVisible, first, second, secondary: secondaryRays })
      return first.map((value, c) => value + second[c]) as ReferenceRGB
    })
    bank.set(index, { key: originKey, paths })
    const start = performance.now()
    const coefficients = projectSixRayRadiance(mode, samples, radiance)
    stats.projectionMs += performance.now() - start
    return { traces, coefficients, candidates: ranked.details?.map(({ id, kind, score, solidAngle, visible, point }) =>
      ({ id, kind, score, solidAngle, visible: !!visible, point: point.toArray() })) ?? [] }
  }

  return {
    visibility: { occluded: blocked, hit(origin: Vector3, direction: Vector3, max = skyRange, near = epsilon) {
      return tree?.raycastFirst(ray.set(origin, direction), DoubleSide, near, max) ?? null
    } },
    solve(probes: readonly { index: number; position: Vector3 }[], options: SixRayOptions, lighting: SixRayLighting) {
      stats = emptyStats()
      const start = performance.now(), light = sources(lighting)
      if (options.mode !== 'six-fixed') {
        const ranking = performance.now()
        preparePatches(light)
        stats.candidateMs += performance.now() - ranking
      }
      const coefficients = new Float32Array(probes.length * 12)
      probes.forEach((probe, i) => coefficients.set(evaluate(probe.index, probe.position, options, light).coefficients, i * 12))
      stats.solveMs = performance.now() - start
      return { coefficients, stats }
    },
    inspect(probe: { index: number; position: Vector3 }, normal: Vector3, options: SixRayOptions, lighting: SixRayLighting) {
      const light = sources(lighting)
      preparePatches(light)
      const { traces, coefficients, candidates } = evaluate(probe.index, probe.position, options, light, true)
      const basis = indirectSHIrradianceBasis(normal)
      const irradiance = [0, 1, 2].map(c => Math.max(0, basis.reduce((sum, value, i) => sum + value * coefficients[i * 3 + c], 0)))
      return { probe: probe.index, origin: probe.position.toArray(), mode: options.mode,
        traces, coefficients: Array.from(coefficients), candidates, irradiance }
    },
    dispose() { geometry.dispose() },
  }
}
