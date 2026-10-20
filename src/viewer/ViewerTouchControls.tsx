import { useEffect, useRef, type PointerEvent } from 'react'
import type { createViewerTouchInput } from './viewerTouchInput'

/** DOM-only input: moving a thumb never rebuilds the house or updates React state. */
export function ViewerTouchControls({ input, resetKey, suspended }: {
  input: ReturnType<typeof createViewerTouchInput>; resetKey: unknown; suspended: boolean
}) {
  const pad = useRef<HTMLButtonElement>(null)
  const thumb = useRef<HTMLSpanElement>(null)
  const pointer = useRef<number | null>(null)
  const reset = () => {
    const id = pointer.current
    pointer.current = null
    input.clear()
    if (thumb.current) thumb.current.style.transform = 'translate(0px, 0px)'
    if (id !== null && pad.current?.hasPointerCapture(id)) pad.current.releasePointerCapture(id)
  }
  useEffect(() => {
    const clear = () => {
      pointer.current = null
      input.clear()
      if (thumb.current) thumb.current.style.transform = 'translate(0px, 0px)'
    }
    clear()
    window.addEventListener('blur', clear)
    window.addEventListener('resize', clear)
    document.addEventListener('visibilitychange', clear)
    return () => {
      clear()
      window.removeEventListener('blur', clear)
      window.removeEventListener('resize', clear)
      document.removeEventListener('visibilitychange', clear)
    }
  }, [input, resetKey, suspended])
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (suspended || pointer.current !== event.pointerId) return
    event.preventDefault()
    const box = event.currentTarget.getBoundingClientRect()
    const radius = box.width * 0.32
    const x = (event.clientX - box.left - box.width / 2) / radius
    const y = (event.clientY - box.top - box.height / 2) / radius
    const scale = Math.max(1, Math.hypot(x, y))
    input.set(x / scale, y / scale)
    if (thumb.current) thumb.current.style.transform = `translate(${x / scale * radius}px, ${y / scale * radius}px)`
  }
  return <div className="viewer-touch-controls">
    <button ref={pad} type="button" className="viewer-joystick" disabled={suspended}
      aria-label="Movement joystick: drag to walk, or use arrow keys" onContextMenu={event => event.preventDefault()}
      onPointerDown={event => {
        if (pointer.current !== null || event.button !== 0 || suspended) return
        pointer.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId)
        move(event)
      }} onPointerMove={move}
      onPointerUp={event => { if (pointer.current === event.pointerId) reset() }}
      onPointerCancel={event => { if (pointer.current === event.pointerId) reset() }}
      onLostPointerCapture={event => { if (pointer.current === event.pointerId) reset() }}
      onBlur={reset}
      onKeyDown={event => {
        const axis = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key]
        if (axis) { event.preventDefault(); input.set(axis[0], axis[1]) }
      }} onKeyUp={event => { if (event.key.startsWith('Arrow')) reset() }}>
      <span className="viewer-joystick-arrows" aria-hidden="true">↕<br />↔</span>
      <span ref={thumb} className="viewer-joystick-thumb" aria-hidden="true" />
    </button>
    <span className="viewer-touch-hint">Left thumb to move · Drag right side to look</span>
  </div>
}
