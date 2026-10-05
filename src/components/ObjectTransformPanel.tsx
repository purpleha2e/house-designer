import { useRef, useState } from 'react'
import type { ModelTransformField } from '../modelTransformFields'

const fields: { field: ModelTransformField; label: string; unit: string }[] = [
  { field: 'width', label: 'Width', unit: 'm' },
  { field: 'height', label: 'Height', unit: 'm' },
  { field: 'length', label: 'Length', unit: 'm' },
  { field: 'scaleX', label: 'X scale', unit: '×' },
  { field: 'scaleY', label: 'Y scale', unit: '×' },
  { field: 'scaleZ', label: 'Z scale', unit: '×' },
  { field: 'rotation', label: 'Rotation', unit: '°' },
]
const format = (value: number) => Number(value.toFixed(3)).toString()

function TransformField({ field, label, unit, value, disabled, onCommit }: {
  field: ModelTransformField; label: string; unit: string; value: number; disabled: boolean
  onCommit: (field: ModelTransformField, value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState('')
  const cancelRef = useRef(false)
  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false
      setDraft(null)
      setError('')
      return
    }
    if (draft === null || draft === format(value)) { setDraft(null); return }
    const parsed = draft.trim() === '' ? NaN : Number(draft)
    if (!Number.isFinite(parsed) || (field !== 'rotation' && parsed <= 0)) {
      setError(field === 'rotation' ? 'Enter a valid angle.' : 'Enter a positive value.')
      return
    }
    setError('')
    setDraft(null)
    onCommit(field, parsed)
  }
  return <div className="model-transform-field">
    <label>
      <span>{label}</span>
      <span className="model-transform-input">
        <input type="text" inputMode="decimal" aria-label={`Object ${label.toLowerCase()}`}
          aria-invalid={Boolean(error)} disabled={disabled} value={draft ?? format(value)}
          onFocus={event => { setDraft(format(value)); event.currentTarget.select() }}
          onChange={event => { setDraft(event.target.value); setError('') }} onBlur={commit}
          onKeyDown={event => {
            event.stopPropagation()
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
            if (event.key === 'Escape') { cancelRef.current = true; event.currentTarget.blur() }
          }} />
        <span>{unit}</span>
      </span>
    </label>
    {error ? <small role="alert">{error}</small> : null}
  </div>
}

export function ObjectTransformPanel({ values, disabled, side, onCommit, window = false }: {
  values: Record<ModelTransformField, number>; disabled: boolean
  side: 'left' | 'right'
  window?: boolean
  onCommit: (field: ModelTransformField, value: number) => void
}) {
  return <div className={`model-scale-readout${side === 'left' ? ' is-left' : ''}`} role="group" aria-label="Object transform"
    onPointerDown={event => event.stopPropagation()}>
    <strong>Object transform</strong>
    <div className="model-transform-fields">
      {fields.filter(item => window ? ['width', 'height', 'scaleX', 'scaleY'].includes(item.field) : item.field !== 'height').map(item => <TransformField key={item.field} {...item} value={values[item.field]}
        disabled={disabled} onCommit={onCommit} />)}
    </div>
    <small>Enter or leave a field to apply · Esc to cancel</small>
  </div>
}
