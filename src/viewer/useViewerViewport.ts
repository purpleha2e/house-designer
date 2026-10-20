import { useEffect, type RefObject } from 'react'

/** Follow the visible phone viewport, including Safari's late startup sizing. */
export function useViewerViewport(target: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport
    const update = () => {
      const element = target.current
      if (!element || (viewport && viewport.scale !== 1)) return
      const height = document.fullscreenElement === element ? window.innerHeight : viewport?.height ?? window.innerHeight
      if (height > 0) element.style.setProperty('--viewer-height', `${height}px`)
    }
    update()
    const frame = requestAnimationFrame(update)
    // Home Screen launches can finish laying out browser/system bars after
    // React mounts without a window resize. These are bounded startup checks.
    const early = setTimeout(update, 250), settled = setTimeout(update, 1000)
    window.addEventListener('pageshow', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    viewport?.addEventListener('resize', update)
    document.addEventListener('fullscreenchange', update)
    return () => {
      cancelAnimationFrame(frame); clearTimeout(early); clearTimeout(settled)
      window.removeEventListener('pageshow', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      viewport?.removeEventListener('resize', update)
      document.removeEventListener('fullscreenchange', update)
    }
  }, [target])
}
