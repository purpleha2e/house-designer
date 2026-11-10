import type { PlacedModel } from './types'
import type { HandleBounds } from './objectHandles'
import type { ModelAssetBounds } from './modelAssetBounds'

/** The plan and properties use the same asset-space dimensions on every floor. */
export function getModelTransformBounds(definition: {
  width: number; depth: number; sourceUrl?: string; normalizeToDimensions?: boolean
  wallMount?: string; roofMount?: string
}, asset?: ModelAssetBounds): HandleBounds {
  const nativeDepth = definition.wallMount === 'window' && asset
    ? Math.max(asset.maxZ - asset.minZ, 0.0001) : asset?.depth ?? definition.depth
  const scaleX = definition.sourceUrl && definition.normalizeToDimensions
    ? definition.width / Math.max(asset?.width ?? definition.width, 0.0001) : 1
  const scaleZ = definition.sourceUrl && definition.normalizeToDimensions
    ? definition.depth / Math.max(nativeDepth, 0.0001) : 1
  return {
    minX: definition.sourceUrl && asset ? asset.minX * scaleX : -definition.width / 2,
    maxX: definition.sourceUrl && asset ? asset.maxX * scaleX : definition.width / 2,
    minZ: definition.sourceUrl && asset ? asset.minZ * scaleZ : definition.roofMount === 'dormer' ? -definition.depth : -definition.depth / 2,
    maxZ: definition.sourceUrl && asset ? asset.maxZ * scaleZ : definition.roofMount === 'dormer' ? 0 : definition.depth / 2,
  }
}

export type ModelTransformField = 'width' | 'height' | 'length' | 'scaleX' | 'scaleY' | 'scaleZ' | 'rotation'

export function getModelTransformValues(model: PlacedModel, bounds: HandleBounds, baseHeight = 1) {
  const scaleY = model.scale ?? 1
  const scaleX = scaleY * (model.widthScale ?? 1)
  const scaleZ = scaleY * (model.depthScale ?? 1)
  return {
    width: Math.max(bounds.maxX - bounds.minX, 0.1) * scaleX,
    length: Math.max(bounds.maxZ - bounds.minZ, 0.1) * scaleZ,
    height: baseHeight * scaleY,
    scaleX, scaleY, scaleZ, rotation: model.rotation * 180 / Math.PI,
  }
}

export function updateModelTransformField(model: PlacedModel, bounds: HandleBounds,
  field: ModelTransformField, value: number, baseHeight = 1): Partial<PlacedModel> {
  if (!Number.isFinite(value) || (field !== 'rotation' && value <= 0)) {
    throw new Error(field === 'rotation' ? 'Enter a valid angle.' : 'Enter a value greater than zero.')
  }
  const values = getModelTransformValues(model, bounds, baseHeight)
  let { scaleX, scaleY, scaleZ } = values
  let rotation = model.rotation
  switch (field) {
    case 'width': scaleX *= value / values.width; break
    case 'length': scaleZ *= value / values.length; break
    case 'height': scaleY *= value / values.height; break
    case 'scaleX': scaleX = value; break
    case 'scaleY': scaleY = value; break
    case 'scaleZ': scaleZ = value; break
    case 'rotation': rotation = value * Math.PI / 180; break
  }
  const centerX = (bounds.minX + bounds.maxX) / 2 *
    (model.flipped ? -1 : 1) * (model.mirrored ? -1 : 1)
  const centerZ = (bounds.minZ + bounds.maxZ) / 2 * (model.flipped ? -1 : 1)
  const cos = Math.cos(model.rotation), sin = Math.sin(model.rotation)
  const nextCos = Math.cos(rotation), nextSin = Math.sin(rotation)
  return {
    scale: scaleY, widthScale: scaleX / scaleY, depthScale: scaleZ / scaleY, rotation,
    position: {
      x: model.position.x + cos * centerX * values.scaleX - sin * centerZ * values.scaleZ -
        nextCos * centerX * scaleX + nextSin * centerZ * scaleZ,
      y: model.position.y + sin * centerX * values.scaleX + cos * centerZ * values.scaleZ -
        nextSin * centerX * scaleX - nextCos * centerZ * scaleZ,
    },
  }
}
