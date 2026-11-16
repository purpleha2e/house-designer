import { useEffect, useRef } from 'react'

/** Keep the decision visible in the editor after the native file picker closes. */
export function ProjectLoadConfirmation({ fileName, onDecision }: {
  fileName: string; onDecision: (discard: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} className="project-load-dialog" aria-labelledby="project-load-title"
    onCancel={event => { event.preventDefault(); onDecision(false) }}>
    <h2 id="project-load-title">Unsaved changes</h2>
    <p>Opening {fileName} will discard changes to the current model.</p>
    <p>Cancel to keep your model open and save it first.</p>
    <div className="project-load-actions">
      <button type="button" autoFocus onClick={() => onDecision(false)}>Cancel</button>
      <button type="button" onClick={() => onDecision(true)}>Discard changes and open</button>
    </div>
  </dialog>
}
