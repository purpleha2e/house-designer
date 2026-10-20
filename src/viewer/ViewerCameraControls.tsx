import { useContext, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { getViewerMovement, VIEWER_HEAD_HEIGHT, type ViewerNavigationMode } from './viewerNavigation'
import { CameraInputTiming, markViewportNavigation } from '../viewportScheduling'
import { ViewerTouchContext } from './viewerTouchInput'

export function ViewerCameraControls({ mode, floorElevation, enabled }: {
  mode: ViewerNavigationMode; floorElevation: number; enabled: boolean
}) {
  const { camera, gl } = useThree()
  const touch = useContext(ViewerTouchContext)
  const keys = useRef(new Set<string>())
  const inputTiming = useRef(new CameraInputTiming())
  const resyncLook = useRef(false)
  const forward = useRef(new Vector3())
  const right = useRef(new Vector3())

  useEffect(() => {
    const canvas = gl.domElement
    let drag: { id: number; x: number; y: number } | null = null
    const clear = () => {
      keys.current.clear()
      if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id)
      drag = null
    }
    if (!enabled) { clear(); return }
    const down = (event: PointerEvent) => {
      if (drag || gl.xr.isPresenting || event.button !== 0) return
      // A slow phone frame must not discard the start of a finger gesture.
      // Starting a drag only records its position; it cannot catch up movement.
      if (event.pointerType !== 'touch' && !inputTiming.current.accepts(event.timeStamp)) return
      const box = canvas.getBoundingClientRect()
      if (event.pointerType === 'touch' && event.clientX < box.left + box.width / 2) return
      markViewportNavigation()
      if (event.pointerType !== 'touch') canvas.focus({ preventScroll: true })
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
      canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return
      const stale = event.pointerType === 'touch'
        ? performance.now() - event.timeStamp > 150
        : resyncLook.current || !inputTiming.current.accepts(event.timeStamp)
      if (stale) {
        resyncLook.current = false; drag.x = event.clientX; drag.y = event.clientY; return
      }
      resyncLook.current = false
      markViewportNavigation()
      camera.rotation.order = 'YXZ'
      const lookSensitivity = event.pointerType === 'touch' ? 0.006 : 0.003
      camera.rotation.y -= (event.clientX - drag.x) * lookSensitivity
      camera.rotation.x = Math.max(-Math.PI * 0.47, Math.min(Math.PI * 0.47,
        camera.rotation.x - (event.clientY - drag.y) * lookSensitivity))
      camera.rotation.z = 0
      drag.x = event.clientX; drag.y = event.clientY
    }
    const up = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return
      const id = drag.id; drag = null
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id)
    }
    const keyboard = (event: KeyboardEvent, pressed: boolean) => {
      if (pressed && !inputTiming.current.accepts(event.timeStamp)) return
      if (pressed && event.target instanceof Element && event.target.closest('input,textarea,select,button,[contenteditable="true"]')) return
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(event.code)) return
      if (pressed && mode === 'walk' && ['KeyQ', 'KeyE'].includes(event.code)) return
      event.preventDefault()
      if (pressed) { keys.current.add(event.code); markViewportNavigation() }
      else keys.current.delete(event.code)
    }
    const keyDown = (event: KeyboardEvent) => keyboard(event, true)
    const keyUp = (event: KeyboardEvent) => keyboard(event, false)
    const visibility = () => { if (document.hidden) clear() }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('lostpointercapture', up)
    document.addEventListener('keydown', keyDown)
    document.addEventListener('keyup', keyUp)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', clear)
    return () => {
      clear()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('lostpointercapture', up)
      document.removeEventListener('keydown', keyDown)
      document.removeEventListener('keyup', keyUp)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', clear)
    }
  }, [camera, enabled, gl, mode])

  useFrame(({ camera: frameCamera }, delta) => {
    const timedDelta = inputTiming.current.frame(delta)
    // Thumb input is current held state, not a queued motion event. Keep it
    // usable below 10 FPS while limiting each step and skipping long pauses.
    const movementDelta = touch && (touch.get().x || touch.get().y) && delta > 0 && delta < .5
      ? Math.min(delta, .05) : timedDelta
    if (delta > .1) resyncLook.current = true
    if (!enabled || gl.xr.isPresenting || document.hidden) return
    if (keys.current.size || touch?.get().x || touch?.get().y) markViewportNavigation()
    frameCamera.getWorldDirection(forward.current)
    right.current.setFromMatrixColumn(frameCamera.matrixWorld, 0)
    const movement = getViewerMovement(mode, keys.current, forward.current.toArray(), right.current.toArray(), touch?.get())
    const speed = (keys.current.has('ShiftLeft') || keys.current.has('ShiftRight')) ? 6 : 2.4
    frameCamera.position.addScaledVector(forward.current.set(...movement as [number, number, number]), speed * movementDelta)
    if (mode === 'walk') frameCamera.position.y = floorElevation + VIEWER_HEAD_HEIGHT
  }, -1)
  return null
}
