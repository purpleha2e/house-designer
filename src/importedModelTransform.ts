import { Box3, Vector3 } from 'three'

/** Resize a mounted asset by its fixed frame, preserving its moving parts. */
export function getImportedModelTransform(bounds: Box3, target: Vector3,
  normalizeToDimensions: boolean, frameBounds?: Box3) {
  const reference = frameBounds ?? bounds
  const sourceSize = reference.getSize(new Vector3())
  const scale = normalizeToDimensions
    ? new Vector3(target.x / Math.max(sourceSize.x, .0001),
      target.y / Math.max(sourceSize.y, .0001), target.z / Math.max(sourceSize.z, .0001))
    : new Vector3(1, 1, 1)
  const offset = frameBounds && normalizeToDimensions
    ? reference.getCenter(new Vector3()).multiply(scale).negate().setY(-reference.min.y * scale.y)
    : new Vector3()
  const placementBounds = reference.clone()
  placementBounds.min.multiply(scale).add(offset)
  placementBounds.max.multiply(scale).add(offset)
  return {
    scale, offset, placementBounds,
    center: bounds.getCenter(new Vector3()).multiply(scale).add(offset),
    size: bounds.getSize(new Vector3()).multiply(scale),
  }
}
