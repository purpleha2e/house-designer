import { useEffect, useState, type RefObject } from 'react'

export function ViewerFullscreenButton({ target }: { target: RefObject<HTMLElement | null> }) {
  const [active, setActive] = useState(false)
  const [message, setMessage] = useState('')
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  useEffect(() => {
    const update = () => setActive(document.fullscreenElement === target.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [target])
  const toggle = async () => {
    setMessage('')
    if (!target.current?.requestFullscreen || !document.fullscreenEnabled) {
      setMessage('On iPhone: tap Safari’s Share button, then Add to Home Screen. Leave Open as Web App enabled if shown, then open the new icon for a tour without Safari’s toolbars.')
      return
    }
    try {
      if (document.fullscreenElement === target.current) await document.exitFullscreen()
      else await target.current.requestFullscreen()
    } catch {
      setMessage('This browser could not enter full screen. On iPhone, use Share → Add to Home Screen and open the new icon.')
    }
  }
  return <>
    <button type="button" aria-pressed={active || standalone} disabled={standalone}
      onClick={event => { event.currentTarget.blur(); void toggle() }}>
      {standalone ? 'Full screen active' : active ? 'Exit full screen' : 'Full screen'}
    </button>
    {message && <div className="viewer-fullscreen-help" role="status">
      <span>{message}</span>
      <button type="button" aria-label="Dismiss full-screen instructions" onClick={() => setMessage('')}>Dismiss</button>
    </div>}
  </>
}
