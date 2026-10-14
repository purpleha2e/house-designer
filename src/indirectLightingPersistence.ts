import { CubeUVReflectionMapping, DataTexture, HalfFloatType, LinearFilter, LinearSRGBColorSpace, RGBAFormat } from 'three'
import { INDIRECT_ATLAS_SIZE, INDIRECT_MASK_SIZE, restoreIndirectField, serializeIndirectField,
  type IndirectField, type IndirectFieldData } from './indirectLighting.ts'
import type { FloorLevel, SunPosition, SurfaceMaterialAssignment } from './types.ts'
import { normalizeDiffuseProbeResolution, type DiffuseProbeResolution } from './indirectProbeResolution.ts'
import { INDIRECT_FLOOR_LAYER_VERSION, indirectFloorSize } from './indirectFloorLighting.ts'

// Room enclosure now includes passive roofs; older bakes retain obsolete roof
// strips and their headroom/occlusion masks even when the project is unchanged.
export const INDIRECT_CACHE_VERSION = 2
export type IndirectLightingSettings = {
  daylight: boolean; lights: boolean; shadows: boolean; lightShadows: boolean
  hideRoofs: boolean; floorSlabs: boolean; ambientTerm: number
  softAmbientShading: boolean; softAmbientStrength: number; nightFill: boolean; groundPlane: boolean
  diffuseProbeResolution?: DiffuseProbeResolution
}
type PackedBuffer = { encoding: 'gzip-base64' | 'base64'; data: string }
export type SavedIndirectLighting = {
  version: number; projectKey: string; assetKey: string; geometryKey: string; settings: IndirectLightingSettings
  layout: Omit<IndirectFieldData, 'maskData' | 'positionData' | 'distanceData'>
  mask: PackedBuffer; positions: PackedBuffer; coefficients: PackedBuffer[]; volume: PackedBuffer
  directCoefficients?: PackedBuffer[]
  floorLayer?: { version: 1 | 2; n: number; data: PackedBuffer }
  reflections: { room: number; width: number; height: number; pixels: PackedBuffer }[]
}

/** Order-independent, portable key; navigation and background plan images are not lighting edits. */
export function indirectProjectKey(project: { floors: FloorLevel[]; sunPosition?: SunPosition; surfaceAssignments?: SurfaceMaterialAssignment[] }) {
  return indirectContentKey({ floors: [...project.floors].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(floor => Object.fromEntries(Object.entries(floor).filter(([key]) => !['groundImage', 'name'].includes(key)))),
  sun: project.sunPosition ?? { azimuth: Math.atan2(6, 4), elevation: .78 },
  assignments: project.surfaceAssignments ?? [] })
}

export function indirectContentKey(value: unknown): string {
  const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
    if (v && typeof v === 'object') return `{${Object.entries(v).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
    return JSON.stringify(v) ?? 'null'
  }
  const text = canonical(value)
  let first = 2166136261, second = 5381
  for (let i = 0; i < text.length; i++) { first = Math.imul(first ^ text.charCodeAt(i), 16777619); second = Math.imul(second, 33) ^ text.charCodeAt(i) }
  return `${text.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`
}

/** Uploaded paths are rewritten for publishing; built-in assets receive Vite hashes. */
export function indirectAssetIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(indirectAssetIdentity)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['name', 'category', 'previewUrl'].includes(key)).map(([key, item]) => [key, indirectAssetIdentity(item)]))
  if (typeof value !== 'string' || !/\.(glb|gltf|png|jpg|jpeg|webp|ktx2)(?:[?#]|$)/i.test(value)) return value
  let path = value.replaceAll('\\', '/').split(/[?#]/)[0]
  if (path.includes('/published-assets/')) path = path.split('/published-assets/')[1]
  if (path.startsWith('./published-assets/')) path = path.slice('./published-assets/'.length)
  if (/\/assets\/|\/textures\//.test(path)) path = path.split('/').at(-1)!.replace(/-[\w-]{8}(?=\.[^.]+$)/, '')
  return path.replace(/^\//, '')
}

export function indirectProjectAssetKey(project: { floors: FloorLevel[]; surfaceAssignments?: SurfaceMaterialAssignment[] },
  models: ReadonlyMap<string, unknown>, materials: ReadonlyMap<string, unknown>) {
  const modelIds = [...new Set(project.floors.flatMap(floor => floor.models.map(model => model.modelId)))].sort()
  const strings = new Set<string>()
  const collect = (value: unknown) => {
    if (typeof value === 'string') strings.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(project)
  return indirectContentKey(indirectAssetIdentity({ models: modelIds.map(id => models.get(id)),
    materials: [...strings].filter(id => materials.has(id)).sort().map(id => materials.get(id)) }))
}

async function pack(data: ArrayBufferView): Promise<PackedBuffer> {
  let bytes = new Uint8Array(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  const encoding = typeof CompressionStream === 'undefined' ? 'base64' : 'gzip-base64'
  if (encoding === 'gzip-base64') bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { encoding, data: btoa(binary) }
}

async function unpack(buffer: PackedBuffer, byteLength: number) {
  if (!buffer || !['base64', 'gzip-base64'].includes(buffer.encoding) || typeof buffer.data !== 'string' || buffer.data.length > byteLength * 2 + 4096) throw new Error('Invalid GI buffer')
  const binary = atob(buffer.data), bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  if (buffer.encoding === 'base64') { if (bytes.byteLength !== byteLength) throw new Error('Invalid GI buffer length'); return bytes.buffer }
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  const result = new Uint8Array(byteLength)
  let offset = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (offset + chunk.value.length > byteLength) throw new Error('Invalid GI decompressed length')
      result.set(chunk.value, offset); offset += chunk.value.length
    }
  } finally { await reader.cancel() }
  if (offset !== byteLength) throw new Error('Incomplete GI buffer')
  return result.buffer
}

export function savedIndirectLightingMatches(cache: SavedIndirectLighting | undefined, projectKey: string, assetKey?: string, settings?: IndirectLightingSettings) {
  return !!cache && validIndirectLightingSettings(cache.settings) && cache.version === INDIRECT_CACHE_VERSION && cache.projectKey === projectKey &&
    (assetKey === undefined || cache.assetKey === assetKey) &&
    (settings === undefined || indirectContentKey({ ...cache.settings, diffuseProbeResolution: normalizeDiffuseProbeResolution(cache.settings.diffuseProbeResolution) }) ===
      indirectContentKey({ ...settings, diffuseProbeResolution: normalizeDiffuseProbeResolution(settings.diffuseProbeResolution) }))
}

export function validIndirectLightingSettings(settings?: IndirectLightingSettings) {
  return !!settings && ['daylight', 'lights', 'shadows', 'lightShadows', 'hideRoofs', 'floorSlabs', 'softAmbientShading', 'nightFill', 'groundPlane']
    .every(key => typeof settings[key as keyof IndirectLightingSettings] === 'boolean') &&
    Number.isFinite(settings.ambientTerm) && settings.ambientTerm >= 0 && settings.ambientTerm <= .85 &&
    Number.isFinite(settings.softAmbientStrength) && settings.softAmbientStrength >= 0 && settings.softAmbientStrength <= 1.5 &&
    (settings.diffuseProbeResolution === undefined || [4, 8, 16].includes(settings.diffuseProbeResolution))
}

export async function saveIndirectLighting(field: IndirectField, projectKey: string, assetKey: string, geometryKey: string, settings: IndirectLightingSettings,
  reflections: { room: number; width: number; height: number; data: Uint16Array }[], directCoefficients?: Uint16Array[]): Promise<SavedIndirectLighting> {
  const snapshot = serializeIndirectField(field), { maskData, positionData } = snapshot
  const layout = Object.fromEntries(Object.entries(snapshot).filter(([key]) => !['maskData', 'positionData', 'distanceData'].includes(key))) as SavedIndirectLighting['layout']
  // Lamp visibility is needed only when baking; the client viewer loads the final diffuse volume.
  layout.distanceColumns = layout.distanceRows = layout.distanceSize = layout.distanceWidth = 1
  const [mask, positions, coefficients, volume, savedReflections, direct, floor] = await Promise.all([
    pack(maskData), pack(positionData), Promise.all(field.coefficients.map(pack)), pack(field.volume.data),
    Promise.all(reflections.map(async reflection => ({ room: reflection.room, width: reflection.width, height: reflection.height, pixels: await pack(reflection.data) }))),
    directCoefficients ? Promise.all(directCoefficients.map(pack)) : undefined,
    field.floorLayer.ready ? pack(field.floorLayer.data) : undefined,
  ])
  return { version: INDIRECT_CACHE_VERSION, projectKey, assetKey, geometryKey, settings, layout, mask, positions, coefficients, volume, reflections: savedReflections,
    ...(direct ? { directCoefficients: direct } : {}),
    ...(floor ? { floorLayer: { version: INDIRECT_FLOOR_LAYER_VERSION, n: field.floorLayer.n, data: floor } } : {}) }
}

export async function loadIndirectLighting(cache: SavedIndirectLighting) {
  const layout = cache.layout, atlasValues = INDIRECT_ATLAS_SIZE ** 2 * 4
  if (cache.version !== INDIRECT_CACHE_VERSION || !validIndirectLightingSettings(cache.settings) || !layout || !Array.isArray(layout.floors) || layout.floors.length < 1 || layout.floors.length > 8 ||
    !Number.isFinite(layout.bounds?.size) || layout.bounds.size <= 0 || !Number.isFinite(layout.bounds.minX) || !Number.isFinite(layout.bounds.minZ) ||
    !Array.isArray(layout.probes) || layout.probes.length > 3968 || !Array.isArray(layout.regions) || layout.regions.length > 254 ||
    cache.coefficients?.length !== 3 || (cache.directCoefficients !== undefined && (!Array.isArray(cache.directCoefficients) || cache.directCoefficients.length !== 3)) ||
    !Array.isArray(cache.reflections) || cache.reflections.length > 254 ||
    layout.probes.some(probe => !Number.isInteger(probe.index) || probe.index < 0 || probe.index >= 3968 || !probe.position.every(Number.isFinite) || !layout.regions.some(region => region.id === probe.regionId))) throw new Error('Invalid saved GI layout')
  const n = Math.max(2, Math.min(128, Math.ceil(layout.bounds.size / .16) + 1)), height = layout.floors.length * 14
  const floorN = indirectFloorSize(layout.bounds.size)
  if (cache.floorLayer && (![1, INDIRECT_FLOOR_LAYER_VERSION].includes(cache.floorLayer.version) || cache.floorLayer.n !== floorN)) throw new Error('Invalid saved GI floor layer')
  const [mask, positions, coefficients, volume, reflections, direct, floor] = await Promise.all([
    unpack(cache.mask, INDIRECT_MASK_SIZE ** 2 * layout.floors.length * 4), unpack(cache.positions, atlasValues * 4),
    Promise.all(cache.coefficients.map(buffer => unpack(buffer, atlasValues * 2))), unpack(cache.volume, n * n * height * 16 * 2),
    Promise.all(cache.reflections.map(async reflection => {
      if (!Number.isInteger(reflection.width) || !Number.isInteger(reflection.height) || reflection.width < 1 || reflection.height < 1 ||
        reflection.width > 1024 || reflection.height > 1024 || !layout.regions.some(region => region.id === reflection.room)) throw new Error('Invalid saved GI reflection')
      return { ...reflection, data: new Uint16Array(await unpack(reflection.pixels, reflection.width * reflection.height * 4 * 2)) }
    })),
    cache.directCoefficients ? Promise.all(cache.directCoefficients.map(buffer => unpack(buffer, atlasValues * 2))) : undefined,
    cache.floorLayer?.version === INDIRECT_FLOOR_LAYER_VERSION ? unpack(cache.floorLayer.data, floorN * floorN * layout.floors.length * 16 * 2) : undefined,
  ])
  const field = restoreIndirectField({ ...layout, maskData: new Uint8Array(mask), positionData: new Float32Array(positions),
    distanceData: new Float32Array(1), distanceColumns: 1, distanceRows: 1, distanceSize: 1, distanceWidth: 1 })
  field.coefficients.forEach((data, i) => { data.set(new Uint16Array(coefficients[i])); field.maps[i].needsUpdate = true })
  field.volume.data.set(new Uint16Array(volume)); field.volume.maps[0].needsUpdate = true
  if (floor) { field.floorLayer.data.set(new Uint16Array(floor)); field.floorLayer.ready = true; field.floorLayer.texture.needsUpdate = true }
  return { field, directCoefficients: direct?.map(buffer => new Uint16Array(buffer)), reflections: reflections.map(reflection => {
    const texture = new DataTexture(reflection.data, reflection.width, reflection.height, RGBAFormat, HalfFloatType)
    texture.mapping = CubeUVReflectionMapping; texture.colorSpace = LinearSRGBColorSpace
    texture.minFilter = texture.magFilter = LinearFilter; texture.generateMipmaps = false; texture.flipY = false; texture.needsUpdate = true
    return { room: reflection.room, texture, dispose() { texture.dispose() } }
  }) }
}
