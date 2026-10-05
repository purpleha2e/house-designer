export type ResizeHandle = { x: -1 | 0 | 1; z: -1 | 0 | 1 }
export type HandleBounds = { minX: number; maxX: number; minZ: number; maxZ: number }

export const resizeHandles: ResizeHandle[] = [
  { x: -1, z: -1 }, { x: 0, z: -1 }, { x: 1, z: -1 },
  { x: -1, z: 0 }, { x: 1, z: 0 },
  { x: -1, z: 1 }, { x: 0, z: 1 }, { x: 1, z: 1 },
]

// Resize in the object's axes, keeping the opposite edge/corner stationary.
// Bounds need not be centred on the origin (imported furniture often isn't).
export function resizeObjectFromHandle({ bounds, handle, rotation, scaleX, scaleZ, deltaX, deltaZ, minimumScale = 0.2, scaleStep = 0, keepRatio = false }: {
  bounds: HandleBounds; handle: ResizeHandle; rotation: number
  scaleX: number; scaleZ: number; deltaX: number; deltaZ: number; minimumScale?: number; scaleStep?: number; keepRatio?: boolean
}) {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const localX = cos * deltaX - sin * deltaZ
  const localZ = sin * deltaX + cos * deltaZ
  const constrainScale = (value: number) => Math.max(minimumScale,
    scaleStep > 0 ? Math.round(value / scaleStep) * scaleStep : value)
  let nextX = handle.x === 0 ? scaleX : constrainScale(
    scaleX + handle.x * localX / Math.max(bounds.maxX - bounds.minX, 0.001))
  let nextZ = handle.z === 0 ? scaleZ : constrainScale(
    scaleZ + handle.z * localZ / Math.max(bounds.maxZ - bounds.minZ, 0.001))
  if (keepRatio && handle.x && handle.z) {
    const width = (bounds.maxX - bounds.minX) * scaleX
    const depth = (bounds.maxZ - bounds.minZ) * scaleZ
    const factor = Math.max(minimumScale / scaleX, minimumScale / scaleZ,
      1 + (handle.x * localX * width + handle.z * localZ * depth) / Math.max(width * width + depth * depth, 0.000001))
    nextX = scaleX * factor
    nextZ = scaleZ * factor
  }
  const anchorX = handle.x < 0 ? bounds.maxX : bounds.minX
  const anchorZ = handle.z < 0 ? bounds.maxZ : bounds.minZ
  const shiftX = (scaleX - nextX) * anchorX
  const shiftZ = (scaleZ - nextZ) * anchorZ
  return { scaleX: nextX, scaleZ: nextZ,
    offsetX: cos * shiftX + sin * shiftZ,
    offsetZ: -sin * shiftX + cos * shiftZ }
}
