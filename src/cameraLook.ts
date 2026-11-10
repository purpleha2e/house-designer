import type { Camera } from 'three'

/** Saved views use quaternions. Convert their Euler representation without
 * changing the orientation before applying navigation deltas. Assigning order
 * directly reinterprets the old angles and can flip the first look downward. */
export function applyCameraLook(camera: Camera, yawDelta: number, pitchDelta: number, maxPitch: number) {
  if (!yawDelta && !pitchDelta) return
  camera.rotation.reorder('YXZ')
  camera.rotation.y += yawDelta
  camera.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, camera.rotation.x + pitchDelta))
  camera.rotation.z = 0
}
