import { useEffect, useId, useRef, type ReactNode } from 'react'
import './ObjectBuilder.css'

export function BuilderDialog({ title, onClose, expanded, busy, children }: {
  title: string
  onClose: () => void
  expanded?: boolean
  busy?: boolean
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  return <dialog ref={dialog} className={`object-builder${expanded ? ' object-builder-expanded' : ''}`}
    aria-labelledby={titleId} onCancel={event => {
      event.preventDefault()
      if (!busy) onClose()
    }} onKeyDown={event => event.stopPropagation()}>
    <header className="object-builder-header">
      <h2 id={titleId}>{title}</h2>
      <button type="button" aria-label={`Close ${title.toLowerCase()}`} disabled={busy} onClick={onClose}>×</button>
    </header>
    {children}
  </dialog>
}
