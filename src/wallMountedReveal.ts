import type { ModelDefinition } from './models/modelLibrary'

export const WALL_MOUNT_FRAME_DEPTH_METERS = 0.08

export function getWallMountedRevealDepth(
  definition: ModelDefinition,
  depthScale = 1,
) {
  const scaledDepth = Math.max(definition.depth * depthScale, 0)

  return definition.sourceUrl &&
    (definition.wallMount === 'window' ||
      definition.wallMount === 'exterior-door' ||
      definition.wallMount === 'patio-door')
    ? Math.min(scaledDepth, WALL_MOUNT_FRAME_DEPTH_METERS * depthScale)
    : scaledDepth
}
