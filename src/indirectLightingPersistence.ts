import { CubeUVReflectionMapping, DataTexture, HalfFloatType, LinearFilter, LinearSRGBColorSpace, RGBAFormat } from 'three'
import { INDIRECT_ATLAS_SIZE, INDIRECT_MASK_SIZE, restoreIndirectField, serializeIndirectField,
  type IndirectField, type IndirectFieldData } from './indirectLighting.ts'
import type { FloorLevel, SunPosition, SurfaceMaterialAssignment } from './types.ts'
import { normalizeDiffuseProbeResolution, type DiffuseProbeResolution } from './indirectProbeResolution.ts'
import { INDIRECT_FLOOR_LAYER_VERSION, indirectFloorSize } from './indirectFloorLighting.ts'
import { pack, unpack } from './indirectBufferCodecClient.ts'
import type { PackedBuffer } from './indirectBufferCodec.ts'
import { nightAmbientTerm } from './ambientLighting.ts'
import { DAYLIGHT_TRANSPORT_VERSION, type DaylightSkyMode } from './daylightSky.ts'
import { indirectSHCoefficientCount, type IndirectSHOrder } from './indirectSH.ts'
import { normalizeSunStrength } from './sunStrength.ts'

// Visibility must include source meshes hidden by render batching. Older bakes
// may miss doors/stairs; retain their display while preparing the corrected bake.
export const INDIRECT_CACHE_VERSION = 9
export const INDIRECT_L2_CACHE_VERSION = 10
// Older captures could omit navigation-hidden faces or sky on exterior roofs
// above occupied floor-plan cells. Retain their display during upgrade, but
// never reuse those incomplete direct baselines in new transport.
export const INDIRECT_CAPTURE_VISIBILITY_VERSION = 2
export type IndirectLightingSettings = {
  daylight: boolean; lights: boolean; shadows: boolean; lightShadows: boolean
  hideRoofs: boolean; floorSlabs: boolean; ambientTerm: number
  nightAmbientTerm?: number
  softAmbientShading: boolean; softAmbientStrength: number; groundPlane: boolean
  /** Legacy input only. Current models use nightAmbientTerm directly. */
  nightFill?: boolean
  diffuseProbeResolution?: DiffuseProbeResolution
  daylightBounceStrength?: number
  skyMode?: DaylightSkyMode
  /** Independent sky-source scale for controlled calibration; defaults to 1. */
  skyStrength?: number
  diffuseBounces?: number
  shOrder?: IndirectSHOrder
  spatialInterpolation?: 'occluder-local'
  contactLighting?: boolean
  contactLightingVersion?:number
}
export type SavedIndirectLighting = {
  captureVisibilityVersion?: number
  version: number; projectKey: string; assetKey: string; geometryKey: string; settings: IndirectLightingSettings
  layout: Omit<IndirectFieldData, 'maskData' | 'positionData' | 'distanceData'>
  mask: PackedBuffer; positions: PackedBuffer; coefficients: PackedBuffer[]; volume: PackedBuffer
  directCoefficients?: PackedBuffer[]
  skyCoefficients?: PackedBuffer[]
  floorLayer?: { version: 1 | 2; n: number; data: PackedBuffer }
  reflections: { room: number; width: number; height: number; pixels: PackedBuffer }[]
}

/** Order-independent, portable key; navigation and background plan images are not lighting edits. */
export function indirectProjectKey(project: { floors: FloorLevel[]; sunPosition?: SunPosition; surfaceAssignments?: SurfaceMaterialAssignment[] }) {
  const sun = project.sunPosition ?? { azimuth: Math.atan2(6, 4), elevation: .78 }
  const strength = normalizeSunStrength(sun.strength)
  return indirectContentKey({ floors: [...project.floors].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(floor => Object.fromEntries(Object.entries(floor).filter(([key]) => !['groundImage', 'name'].includes(key)))),
  sun: { ...sun, strength: strength === 1 ? undefined : strength },
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
  if (value && typeof value === 'object') {
    const hashes = (value as { textureSourceHashes?: Record<string, string> }).textureSourceHashes
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['name', 'category', 'previewUrl', 'folder'].includes(key))
      .map(([key, item]) => [key, hashes?.[key] && key.endsWith('TextureUrl')
        ? `local-texture:${hashes[key]}` : indirectAssetIdentity(item)]))
  }
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

export function savedIndirectLightingMatches(cache: SavedIndirectLighting | undefined, projectKey: string, assetKey?: string, settings?: IndirectLightingSettings) {
  return !!cache && validIndirectLightingSettings(cache.settings) && currentSHCache(cache) && cache.projectKey === projectKey &&
    (assetKey === undefined || cache.assetKey === assetKey) &&
    (settings === undefined || indirectLightingSettingsKey(cache.settings) === indirectLightingSettingsKey(settings))
}

function currentSHCache(cache: SavedIndirectLighting) {
  if (cache.captureVisibilityVersion !== INDIRECT_CAPTURE_VISIBILITY_VERSION) return false
  if ((cache.layout?.spatialInterpolation??'legacy')!==(cache.settings?.spatialInterpolation??'legacy')) return false
  if (!!cache.layout?.contactLighting!==!!cache.settings?.contactLighting) return false
  const order = cache.layout?.shOrder ?? 1
  return order === 1 && cache.version === INDIRECT_CACHE_VERSION && (cache.settings?.shOrder ?? 1) === 1 ||
    order === 2 && cache.version === INDIRECT_L2_CACHE_VERSION && cache.settings?.shOrder === 2
}

/** Retain a compatible old bake while the editor upgrades its transport. Tours
 * may display it without silently dropping their saved indoor illumination. */
export function legacyIndirectLightingMatches(cache:SavedIndirectLighting|undefined,projectKey:string,assetKey:string,settings?:IndirectLightingSettings){
  return !!cache&&legacySHCache(cache)&&validIndirectLightingSettings(cache.settings)&&cache.projectKey===projectKey&&cache.assetKey===assetKey&&
    (settings===undefined||indirectLightingSettingsKey(cache.settings)===indirectLightingSettingsKey(settings))
}

function legacySHCache(cache: SavedIndirectLighting) {
  const order = cache.layout?.shOrder ?? 1
  return order === 1 && ([4, 5, 7].includes(cache.version) || cache.version === INDIRECT_CACHE_VERSION && cache.captureVisibilityVersion !== INDIRECT_CAPTURE_VISIBILITY_VERSION) && (cache.settings?.shOrder ?? 1) === 1 ||
    order === 2 && ([6, 8].includes(cache.version) || cache.version === INDIRECT_L2_CACHE_VERSION && cache.captureVisibilityVersion !== INDIRECT_CAPTURE_VISIBILITY_VERSION) && cache.settings?.shOrder === 2
}

/** Local shadow maps affect display only; captures use cached geometry visibility. */
export function indirectLightingSettingsKey(settings?: IndirectLightingSettings) {
  return indirectContentKey(settings && { ...settings, lightShadows: undefined, nightFill: undefined,
    shOrder: settings.shOrder === 2 ? 2 : undefined,
    contactLighting: settings.contactLighting?true:undefined,
    contactLightingVersion:settings.contactLighting?settings.contactLightingVersion:undefined,
    transportVersion: DAYLIGHT_TRANSPORT_VERSION, skyMode: settings.skyMode??'clear',
    skyStrength: settings.skyStrength === 1 ? undefined : settings.skyStrength,
    diffuseBounces: settings.diffuseBounces??6,
    nightAmbientTerm: nightAmbientTerm(settings),
    daylightBounceStrength: settings.daylightBounceStrength ?? 1,
    diffuseProbeResolution: normalizeDiffuseProbeResolution(settings.diffuseProbeResolution) })
}

export function validIndirectLightingSettings(settings?: IndirectLightingSettings) {
  return !!settings && ['daylight', 'lights', 'shadows', 'lightShadows', 'hideRoofs', 'floorSlabs', 'softAmbientShading', 'groundPlane']
    .every(key => typeof settings[key as keyof IndirectLightingSettings] === 'boolean') &&
    (settings.nightFill === undefined || typeof settings.nightFill === 'boolean') &&
    (settings.skyMode===undefined||['clear','overcast'].includes(settings.skyMode)) &&
    (settings.skyStrength===undefined||Number.isFinite(settings.skyStrength)&&settings.skyStrength>=0&&settings.skyStrength<=4) &&
    (settings.shOrder===undefined||settings.shOrder===1||settings.shOrder===2) &&
    (settings.spatialInterpolation===undefined||settings.spatialInterpolation==='occluder-local') &&
    (settings.contactLighting===undefined||typeof settings.contactLighting==='boolean') &&
    (settings.contactLightingVersion===undefined||settings.contactLightingVersion===1) &&
    (settings.diffuseBounces===undefined||Number.isInteger(settings.diffuseBounces)&&settings.diffuseBounces>=2&&settings.diffuseBounces<=8) &&
    Number.isFinite(settings.ambientTerm) && settings.ambientTerm >= 0 && settings.ambientTerm <= .85 &&
    (settings.nightAmbientTerm === undefined || (Number.isFinite(settings.nightAmbientTerm) &&
      settings.nightAmbientTerm >= 0 && settings.nightAmbientTerm <= .85)) &&
    Number.isFinite(settings.softAmbientStrength) && settings.softAmbientStrength >= 0 && settings.softAmbientStrength <= 1.5 &&
    (settings.daylightBounceStrength === undefined || (Number.isFinite(settings.daylightBounceStrength) &&
      settings.daylightBounceStrength >= 0 && settings.daylightBounceStrength <= 4)) &&
    (settings.diffuseProbeResolution === undefined || [4, 8, 16].includes(settings.diffuseProbeResolution))
}

export async function saveIndirectLighting(field: IndirectField, projectKey: string, assetKey: string, geometryKey: string, settings: IndirectLightingSettings,
  reflections: { room: number; width: number; height: number; data: Uint16Array }[], directCoefficients?: Uint16Array[],skyCoefficients?:Uint16Array[]): Promise<SavedIndirectLighting> {
  if (settings.shOrder !== undefined && settings.shOrder !== field.shOrder) throw new Error('GI settings and field SH orders differ')
  if ((settings.spatialInterpolation??'legacy')!==(field.spatialInterpolation??'legacy')) throw new Error('GI settings and field spatial interpolation differ')
  if (!!settings.contactLighting!==field.contactLighting) throw new Error('GI settings and field contact reconstruction differ')
  const snapshot = serializeIndirectField(field), { maskData, positionData } = snapshot
  const layout = Object.fromEntries(Object.entries(snapshot).filter(([key]) => !['maskData', 'positionData', 'distanceData'].includes(key))) as SavedIndirectLighting['layout']
  // Lamp visibility is needed only when baking; the client viewer loads the final diffuse volume.
  layout.distanceColumns = layout.distanceRows = layout.distanceSize = layout.distanceWidth = 1
  const [mask, positions, coefficients, volume, savedReflections, direct, floor, sky] = await Promise.all([
    pack(maskData), pack(positionData), Promise.all(field.coefficients.map(pack)), pack(field.volume.data),
    Promise.all(reflections.map(async reflection => ({ room: reflection.room, width: reflection.width, height: reflection.height, pixels: await pack(reflection.data) }))),
    directCoefficients ? Promise.all(directCoefficients.map(pack)) : undefined,
    field.floorLayer.ready ? pack(field.floorLayer.data) : undefined,
    skyCoefficients?Promise.all(skyCoefficients.map(pack)):undefined,
  ])
  return { version: field.shOrder === 2 ? INDIRECT_L2_CACHE_VERSION : INDIRECT_CACHE_VERSION, captureVisibilityVersion: INDIRECT_CAPTURE_VISIBILITY_VERSION, projectKey, assetKey, geometryKey,
    settings: field.shOrder === 2 ? { ...settings, shOrder: 2 } : settings, layout, mask, positions, coefficients, volume, reflections: savedReflections,
    ...(direct ? { directCoefficients: direct } : {}),
    ...(sky?{skyCoefficients:sky}:{}),
    ...(floor ? { floorLayer: { version: INDIRECT_FLOOR_LAYER_VERSION, n: field.floorLayer.n, data: floor } } : {}) }
}

async function decodeIndirectReflections(cache: SavedIndirectLighting) {
  return Promise.all(cache.reflections.map(async reflection => {
    if (!Number.isInteger(reflection.width) || !Number.isInteger(reflection.height) || reflection.width < 1 || reflection.height < 1 ||
      reflection.width > 1024 || reflection.height > 1024 || !cache.layout.regions.some(region => region.id === reflection.room)) throw new Error('Invalid saved GI reflection')
    return { ...reflection, data: new Uint16Array(await unpack(reflection.pixels, reflection.width * reflection.height * 4 * 2)) }
  }))
}

function createReflectionTextures(reflections: Awaited<ReturnType<typeof decodeIndirectReflections>>) {
  return reflections.map(reflection => {
    const texture = new DataTexture(reflection.data, reflection.width, reflection.height, RGBAFormat, HalfFloatType)
    texture.mapping = CubeUVReflectionMapping; texture.colorSpace = LinearSRGBColorSpace
    texture.minFilter = texture.magFilter = LinearFilter; texture.generateMipmaps = false; texture.flipY = false; texture.needsUpdate = true
    return { room: reflection.room, texture, dispose() { texture.dispose() } }
  })
}

/** Reflection decode is independent of the first diffuse-lit display. */
export async function loadIndirectReflections(cache: SavedIndirectLighting) {
  return createReflectionTextures(await decodeIndirectReflections(cache))
}

export async function loadIndirectLighting(cache: SavedIndirectLighting, options: { reflections?: boolean;allowLegacy?:boolean } = {}) {
  const layout = cache.layout, atlasValues = INDIRECT_ATLAS_SIZE ** 2 * 4
  if ((!currentSHCache(cache) && !(options.allowLegacy&&legacySHCache(cache))) || !validIndirectLightingSettings(cache.settings) || !layout || !Array.isArray(layout.floors) || layout.floors.length < 1 || layout.floors.length > 8 ||
    !Number.isFinite(layout.bounds?.size) || layout.bounds.size <= 0 || !Number.isFinite(layout.bounds.minX) || !Number.isFinite(layout.bounds.minZ) ||
    !Array.isArray(layout.probes) || layout.probes.length > 3968 || !Array.isArray(layout.regions) || layout.regions.length > 254 ||
    cache.coefficients?.length !== 3 || (cache.directCoefficients !== undefined && (!Array.isArray(cache.directCoefficients) || cache.directCoefficients.length !== 3)) ||
    (cache.skyCoefficients!==undefined&&(!Array.isArray(cache.skyCoefficients)||cache.skyCoefficients.length!==3)) ||
    !Array.isArray(cache.reflections) || cache.reflections.length > 254 ||
    layout.probes.some(probe => !Number.isInteger(probe.index) || probe.index < 0 || probe.index >= 3968 || !probe.position.every(Number.isFinite) || !layout.regions.some(region => region.id === probe.regionId))) throw new Error('Invalid saved GI layout')
  const n = Math.max(2, Math.min(128, Math.ceil(layout.bounds.size / .16) + 1)), height = layout.floors.length * 14
  const coefficientCount = indirectSHCoefficientCount(layout.shOrder ?? 1), coefficientBytes = INDIRECT_ATLAS_SIZE ** 2 * coefficientCount * 2
  const floorN = indirectFloorSize(layout.bounds.size)
  if (cache.floorLayer && (![1, INDIRECT_FLOOR_LAYER_VERSION].includes(cache.floorLayer.version) || cache.floorLayer.n !== floorN)) throw new Error('Invalid saved GI floor layer')
  const [mask, positions, coefficients, volume, reflections, direct, floor, sky] = await Promise.all([
    unpack(cache.mask, INDIRECT_MASK_SIZE ** 2 * layout.floors.length * 4), unpack(cache.positions, atlasValues * 4),
    Promise.all(cache.coefficients.map(buffer => unpack(buffer, coefficientBytes))), unpack(cache.volume, n * n * height * coefficientCount * 4 * 2),
    options.reflections === false ? [] : decodeIndirectReflections(cache),
    cache.directCoefficients ? Promise.all(cache.directCoefficients.map(buffer => unpack(buffer, coefficientBytes))) : undefined,
    cache.floorLayer?.version === INDIRECT_FLOOR_LAYER_VERSION ? unpack(cache.floorLayer.data, floorN * floorN * layout.floors.length * coefficientCount * 4 * 2) : undefined,
    cache.skyCoefficients?Promise.all(cache.skyCoefficients.map(buffer=>unpack(buffer,coefficientBytes))):undefined,
  ])
  const field = restoreIndirectField({ ...layout, maskData: new Uint8Array(mask), positionData: new Float32Array(positions),
    distanceData: new Float32Array(1), distanceColumns: 1, distanceRows: 1, distanceSize: 1, distanceWidth: 1 })
  field.coefficients.forEach((data, i) => { data.set(new Uint16Array(coefficients[i])); field.maps[i].needsUpdate = true })
  field.volume.data.set(new Uint16Array(volume)); field.volume.maps[0].needsUpdate = true
  if (floor) { field.floorLayer.data.set(new Uint16Array(floor)); field.floorLayer.ready = true; field.floorLayer.texture.needsUpdate = true }
  return { field, directCoefficients: direct?.map(buffer => new Uint16Array(buffer)),skyCoefficients:sky?.map(buffer=>new Uint16Array(buffer)), reflections: createReflectionTextures(reflections) }
}
