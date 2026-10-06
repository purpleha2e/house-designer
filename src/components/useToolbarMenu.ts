import { useEffect, type RefObject } from 'react'

export function useToolbarMenu(open: boolean, setOpen: (open: boolean) => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const pane = ref.current?.closest('.editor-pane')
    const updateHeight = () => {
      if (pane) ref.current?.style.setProperty('--toolbar-menu-max-height', `${Math.max(120, pane.clientHeight - 56)}px`)
    }
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    if (pane) observer.observe(pane)
    const pointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false)
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      ref.current?.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus()
    }
    document.addEventListener('pointerdown', pointerDown)
    document.addEventListener('keydown', keyDown)
    return () => {
      observer.disconnect()
      document.removeEventListener('pointerdown', pointerDown)
      document.removeEventListener('keydown', keyDown)
    }
  }, [open, setOpen, ref])
}
