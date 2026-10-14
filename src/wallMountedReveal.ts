import type { ModelDefinition } from './models/modelLibrary'

export const WALL_MOUNT_FRAME_DEPTH_METERS = 0.08
export const WINDOW_WALL_FACE_INSET_METERS = 0.02

export function getWallMountedRevealDepth(
  definition: ModelDefinition,
  depthScale = 1,
) {
  const scaledDepth = Math.max(definition.depth * depthScale, 0)

  // Imported open doors include the swung leaf in their bounds. Only the
  // fixed frame belongs in the wall reveal and its lighting-side partition.
  return definition.sourceUrl &&
    (definition.wallMount === 'window' ||
      definition.wallMount === 'exterior-door' ||
      definition.wallMount === 'patio-door' ||
      definition.wallMount === 'interior-door')
    ? Math.min(scaledDepth, WALL_MOUNT_FRAME_DEPTH_METERS * depthScale)
    : scaledDepth
}
