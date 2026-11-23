import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { Point } from '../types'

export function ViewportContextMenu({ position, onDismiss, children }: {
  position: Point
  onDismiss: () => void
  children: ReactNode
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const menu = menuRef.current
    const host = menu?.parentElement
    if (!menu || !host) return

    const place = () => {
      menu.style.left = `${Math.max(0, Math.min(position.x + 2, host.clientWidth - menu.offsetWidth - 2))}px`
      menu.style.top = `${Math.max(0, Math.min(position.y + 2, host.clientHeight - menu.offsetHeight - 2))}px`
    }
    place()
    menu.querySelector('button')?.focus({ preventScroll: true })

    const handlePointerDown = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) onDismiss()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
      }
    }
    const resize = new ResizeObserver(place)
    resize.observe(host)
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      resize.disconnect()
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onDismiss, position])

  return <div ref={menuRef} className="canvas-context-menu" role="group" aria-label="Selection actions"
    onContextMenu={event => event.preventDefault()}>
    {children}
  </div>
}
