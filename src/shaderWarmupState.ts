import type { Material, Object3D, Texture } from 'three'

const listeners = new WeakMap<Object3D, Set<() => void>>()
export function subscribeShaderWarmup(scene: Object3D, listener: () => void) {
  let subscriptions = listeners.get(scene)
  if (!subscriptions) listeners.set(scene, subscriptions = new Set())
  subscriptions.add(listener)
  return () => { subscriptions.delete(listener) }
}

export const shaderWarmupGeneration = (scene: Object3D): number => scene.userData.shaderWarmupGeneration ?? 0

/** Publish the display gate before changing a live program feature. Async scans
 * and compile callbacks may only release the generation they actually prepared. */
export function requestShaderWarmup(scene: Object3D) {
  scene.userData.shaderWarmupGeneration = shaderWarmupGeneration(scene) + 1
  scene.userData.shaderWarmupPending = true
  delete scene.userData.shaderWarmupFailure
  listeners.get(scene)?.forEach(listener => listener())
}

export function completeShaderWarmup(scene: Object3D, generation: number) {
  if (generation !== shaderWarmupGeneration(scene)) return false
  if (scene.userData.shaderWarmupFailure?.generation === generation) return false
  scene.userData.shaderWarmupPending = false
  return true
}

/** An upload may stop because lighting changed its texture version while it
 * yielded. That needs a new scan, whereas a recorded GPU error stays failed.
 * A completion queued before a newer request must publish neither result. */
export function finishShaderWarmup(scene: Object3D, generation: number, succeeded: boolean, cancelled = false) {
  if (cancelled || generation !== shaderWarmupGeneration(scene)) return 'obsolete'
  if (scene.userData.shaderWarmupFailure?.generation === generation) return 'failed'
  if (!succeeded) { requestShaderWarmup(scene); return 'retry' }
  return completeShaderWarmup(scene, generation) ? 'ready' : 'obsolete'
}

/** A failed GPU link must never release the existing prepared display. */
export function failShaderWarmup(scene: Object3D, generation: number, error: unknown, cancelled = false) {
  if (cancelled || generation !== shaderWarmupGeneration(scene)) return false
  scene.userData.shaderWarmupPending = true
  scene.userData.shaderWarmupFailure = {
    generation, message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : typeof error,
    stack: error instanceof Error ? error.stack : undefined,
    projectGeneration: scene.userData.projectGeneration,
    stage: scene.userData.viewportPreparation?.message,
  }
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
