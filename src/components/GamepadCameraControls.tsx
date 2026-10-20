import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { createGamepadNavigation, pollNavigationGamepad } from '../gamepadNavigation'
import { markViewportNavigation } from '../viewportScheduling'

export function GamepadCameraControls({ enabled, walk, headHeight, speed, transforming }: {
  enabled: boolean; walk: boolean; headHeight: number; speed: number
  transforming?: RefObject<boolean>
}) {
  const navigate = useRef(createGamepadNavigation())
  useFrame(({ camera, gl }, delta) => {
    if (!enabled || transforming?.current || gl.xr.isPresenting || document.hidden || !document.hasFocus()) return
    if (document.activeElement?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"],dialog[open]')) return
    const input = pollNavigationGamepad()
    if (!input) return
    markViewportNavigation()
    navigate.current(camera, input, delta, { walk, headHeight, speed })
  }, -1)
  return null
}
