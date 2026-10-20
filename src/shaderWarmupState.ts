import type { Material, Object3D, Texture } from 'three'

export const shaderWarmupGeneration = (scene: Object3D): number => scene.userData.shaderWarmupGeneration ?? 0

/** Publish the display gate before changing a live program feature. Async scans
 * and compile callbacks may only release the generation they actually prepared. */
export function requestShaderWarmup(scene: Object3D) {
  scene.userData.shaderWarmupGeneration = shaderWarmupGeneration(scene) + 1
  scene.userData.shaderWarmupPending = true
}

export function completeShaderWarmup(scene: Object3D, generation: number) {
  if (generation !== shaderWarmupGeneration(scene)) return false
  scene.userData.shaderWarmupPending = false
  return true
}

/** CubeUV atlas size is compiled into Three's reflection shader. Replacements
 * of the same layout only change a sampler; both assignment and restore must
 * hold the retained display when the layout changes. */
export function setViewportEnvironmentMap(scene: Object3D, material: Material & { envMap: Texture | null }, texture: Texture | null) {
  const previous = material.envMap
  if (previous === texture) return
  const height = (value: Texture | null) => (value?.image as { height?: number } | undefined)?.height
  if (!!previous !== !!texture || previous?.mapping !== texture?.mapping || height(previous) !== height(texture)) {
    requestShaderWarmup(scene)
  }
  material.envMap = texture
  material.needsUpdate = true
}
