import { DataUtils, type Vector3 } from 'three'

export type ReferenceRGB = [number, number, number]
export type ReferenceTexture = { width: number; height: number; pixels: Uint16Array }
export type ReferenceSampler = { map: number; matrix: number[]; wrapS: number; wrapT: number }
export type ReferenceMaterial = ReferenceSampler & { color: ReferenceRGB; metalness: number;
  metalnessTexture?: ReferenceSampler; emission?: ReferenceRGB; emissionTexture?: ReferenceSampler }
export type ReferenceLight = { position: number[]; color: ReferenceRGB; intensity: number; distance: number; decay: number;
  direction?: number[]; cone?: number; penumbra?: number }
export type ReferenceSceneData = { positions: Float32Array; uvs: Float32Array;
  materialIndices: Uint16Array; materials: ReferenceMaterial[]; textures: ReferenceTexture[];
  metalnessUVs?: Float32Array; emissionUVs?: Float32Array;
  skyBase: ReferenceRGB; skySun: ReferenceRGB; skyMode: 'clear' | 'overcast';
  sunDirection: number[]; sunIrradiance: ReferenceRGB; daylightGain: number; lights: ReferenceLight[];
  /** Optional per-triangle tags supplied by the snapshot caller. */
  sourceIds?:Uint32Array; sourceNames?:string[]; sourceCategories?: Uint8Array }

function sampleReferenceTexture(data: ReferenceSceneData, index: number, u: number, v: number, material: ReferenceSampler) {
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

export function sampleReferenceSurface(data: ReferenceSceneData, triangle: number, u: number, v: number, bary?: Vector3) {
  const m = data.materials[data.materialIndices[triangle]]
  const base = m.map >= 0 ? sampleReferenceTexture(data, m.map, u, v, m) : [1, 1, 1]
  const additional = (sampler: ReferenceSampler, coordinates: Float32Array) => {
    const i = triangle * 6
    return sampleReferenceTexture(data, sampler.map,
      bary!.x * coordinates[i] + bary!.y * coordinates[i + 2] + bary!.z * coordinates[i + 4],
      bary!.x * coordinates[i + 1] + bary!.y * coordinates[i + 3] + bary!.z * coordinates[i + 5], sampler)
  }
  const metalness = m.metalness * (m.metalnessTexture ? additional(m.metalnessTexture, data.metalnessUVs!)[2] : 1)
  const emissionMap = m.emissionTexture ? additional(m.emissionTexture, data.emissionUVs!) : [1, 1, 1]
  const rho = m.color.map((c, i) => c * base[i] * (1 - metalness)) as ReferenceRGB
  const emission = m.emission?.map((c, i) => c * emissionMap[i]) as ReferenceRGB | undefined
  return { rho, emission }
}
