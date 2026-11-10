import type { IndirectField } from './indirectLighting.ts'

export type SoftFloorGISnapshot = { field: IndirectField; generation: number; ready: boolean; geometryKey: string }
export function softFloorGISource(snapshot: SoftFloorGISnapshot) {
  const { field, generation, geometryKey } = snapshot
  return { field, generation, geometryKey, texture: field.floorLayer.texture, version: field.floorLayer.texture.version }
}
export type SoftFloorGISource = ReturnType<typeof softFloorGISource>

/** Texture versions restart at one for replacements. Identity is part of the
 * publication fence, alongside geometry and bake generation. */
export function softFloorGISourceMatches(source: SoftFloorGISource | undefined, now: SoftFloorGISnapshot) {
  return !!source && source.field === now.field && source.generation === now.generation &&
    source.geometryKey === now.geometryKey && source.texture === now.field.floorLayer.texture &&
    source.version === now.field.floorLayer.texture.version
}
