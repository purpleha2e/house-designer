import { useEffect, useId, useRef, type ReactNode } from 'react'
import './ObjectBuilder.css'

export type ObjectBuilderType = 'stairs' | 'windows' | 'picture-frame' | 'kitchen-unit'

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

export function ObjectBuilder({ onClose, onChoose }: {
  onClose: () => void
  onChoose: (type: ObjectBuilderType) => void
}) {
  return <BuilderDialog title="Object builder" onClose={onClose}>
    <div className="object-builder-options">
      <button type="button" onClick={() => onChoose('stairs')}>
        <strong>Stairs</strong><span>Choose a layout and set the rise, width and finishes.</span>
      </button>
      <button type="button" onClick={() => onChoose('windows')}>
        <strong>Windows</strong><span>Set the frame dimensions and arrange fixed or opening panes.</span>
      </button>
      <button type="button" onClick={() => onChoose('picture-frame')}>
        <strong>Picture frames</strong><span>Set the picture proportions, moulding and slip.</span>
      </button>
      <button type="button" onClick={() => onChoose('kitchen-unit')}>
        <strong>Kitchen units</strong><span>Build base and wall cabinets with custom doors and drawers.</span>
      </button>
    </div>
  </BuilderDialog>
}
