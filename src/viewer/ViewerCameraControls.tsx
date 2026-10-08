import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { getViewerMovement, VIEWER_HEAD_HEIGHT, type ViewerNavigationMode } from './viewerNavigation'

export function ViewerCameraControls({ mode, floorElevation, enabled }: {
  mode: ViewerNavigationMode; floorElevation: number; enabled: boolean
}) {
  const { camera, gl } = useThree()
  const keys = useRef(new Set<string>())
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
      if (event.button !== 0) return
      canvas.focus({ preventScroll: true })
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
      canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return
      camera.rotation.order = 'YXZ'
      camera.rotation.y -= (event.clientX - drag.x) * 0.003
      camera.rotation.x = Math.max(-Math.PI * 0.47, Math.min(Math.PI * 0.47,
        camera.rotation.x - (event.clientY - drag.y) * 0.003))
      camera.rotation.z = 0
      drag.x = event.clientX; drag.y = event.clientY
    }
    const up = () => { if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id); drag = null }
    const keyboard = (event: KeyboardEvent, pressed: boolean) => {
      if (pressed && event.target instanceof Element && event.target.closest('input,textarea,select,button,[contenteditable="true"]')) return
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(event.code)) return
      if (pressed && mode === 'walk' && ['KeyQ', 'KeyE'].includes(event.code)) return
      event.preventDefault()
      if (pressed) keys.current.add(event.code)
      else keys.current.delete(event.code)
    }
    const keyDown = (event: KeyboardEvent) => keyboard(event, true)
    const keyUp = (event: KeyboardEvent) => keyboard(event, false)
    const visibility = () => { if (document.hidden) clear() }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', clear)
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
      canvas.removeEventListener('pointercancel', clear)
      canvas.removeEventListener('lostpointercapture', up)
      document.removeEventListener('keydown', keyDown)
      document.removeEventListener('keyup', keyUp)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', clear)
    }
  }, [camera, enabled, gl, mode])

  useFrame(({ camera: frameCamera }, delta) => {
    if (!enabled) return
    frameCamera.getWorldDirection(forward.current)
    right.current.setFromMatrixColumn(frameCamera.matrixWorld, 0)
    const movement = getViewerMovement(mode, keys.current, forward.current.toArray(), right.current.toArray())
    const speed = (keys.current.has('ShiftLeft') || keys.current.has('ShiftRight')) ? 6 : 2.4
    frameCamera.position.addScaledVector(forward.current.set(...movement as [number, number, number]), speed * Math.min(delta, 0.1))
    if (mode === 'walk') frameCamera.position.y = floorElevation + VIEWER_HEAD_HEIGHT
  })
  return null
}
