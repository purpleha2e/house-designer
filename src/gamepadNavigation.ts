import { Vector3, type Camera } from 'three'
import { applyCameraLook } from './cameraLook.ts'

export type NavigationGamepad = Pick<Gamepad, 'connected' | 'mapping' | 'axes'>
export type GamepadNavigationInput = { moveX: number; moveY: number; lookX: number; lookY: number }
const DEAD_ZONE = 0.18
const LOOK_SPEED = 1.8 // radians per second at full deflection
const MAX_PITCH = Math.PI / 2 - 0.05

function stick(x = 0, y = 0): [number, number] {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [0, 0]
  const length = Math.hypot(x, y)
  if (length <= DEAD_ZONE) return [0, 0]
  const scale = (Math.min(1, length) - DEAD_ZONE) / ((1 - DEAD_ZONE) * length)
  return [x * scale, y * scale]
}

/** Standard mapping: left stick axes 0/1, right stick axes 2/3.
 * Poll fresh snapshots every frame, including sparse slots after disconnects.
 * XR and unrecognised mappings must not drive the desktop camera. */
export function getGamepadNavigationInput(gamepads: readonly (NavigationGamepad | null)[]): GamepadNavigationInput | null {
  for (const pad of gamepads) {
    if (!pad?.connected || pad.mapping !== 'standard' || pad.axes.length < 4) continue
    const [moveX, moveY] = stick(pad.axes[0], pad.axes[1])
    const [lookX, lookY] = stick(pad.axes[2], pad.axes[3])
    if (moveX || moveY || lookX || lookY) return { moveX, moveY, lookX, lookY }
  }
  return null
}

export function pollNavigationGamepad(): GamepadNavigationInput | null {
  try {
    return typeof navigator.getGamepads === 'function' ? getGamepadNavigationInput(navigator.getGamepads()) : null
  } catch {
    // Unsupported contexts or a restrictive embedding policy can deny access.
    return null
  }
}

/** Shared by designer and tour, with independent scratch vectors per camera. */
export function createGamepadNavigation() {
  const forward = new Vector3(), right = new Vector3(), movement = new Vector3()
  return (camera: Camera, input: GamepadNavigationInput, delta: number,
    options: { walk: boolean; headHeight: number; speed: number }) => {
    // Never catch up navigation after a stalled or background frame.
    if (!Number.isFinite(delta) || delta <= 0 || delta > 0.1) return
    const dt = Math.min(delta, 0.05)
    applyCameraLook(camera, -input.lookX * LOOK_SPEED * dt, -input.lookY * LOOK_SPEED * dt, MAX_PITCH)
    camera.getWorldDirection(forward)
    right.setFromMatrixColumn(camera.matrixWorld, 0)
    if (options.walk) { forward.y = 0; right.y = 0 }
    forward.normalize(); right.normalize()
    movement.copy(forward).multiplyScalar(-input.moveY).addScaledVector(right, input.moveX)
    if (movement.lengthSq() > 1) movement.normalize()
    camera.position.addScaledVector(movement, options.speed * dt)
    if (options.walk) camera.position.y = options.headHeight
  }
}
