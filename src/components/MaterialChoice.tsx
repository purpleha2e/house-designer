import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MaterialTextureTransform, SurfaceMaterialProduct } from '../types'
import { MIN_OBJECT_TEXTURE_SCALE, normalizeTextureRotation } from '../modelMaterialOverrides'
import { useMaterialFolders } from '../materials/useMaterialFolders'
import { MaterialLibraryTree, MaterialSwatch } from './MaterialLibraryTree'

function MaterialChooser({ label, value, materials, originalLabel, onChoose, onClose }: {
  label: string; value: string; materials: SurfaceMaterialProduct[]; originalLabel: string
  onChoose: (id: string) => void; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const folders = useMaterialFolders()
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close() }
  }, [])
  return createPortal(<dialog ref={dialog} className="context-material-chooser" aria-label={`${label} material chooser`}
    onCancel={onClose} onClose={() => { if (!dialog.current?.open) onClose() }}>
    <header><h2>{label}</h2><button type="button" aria-label="Close material chooser" onClick={onClose}>×</button></header>
    <MaterialLibraryTree materials={materials} folders={folders} selectedId={value} onSelect={material => onChoose(material.id)} />
    <button type="button" className="context-material-reset" onClick={() => onChoose('')}>Use original finish</button>
    <small>{originalLabel}</small>
  </dialog>, document.body)
}

const textureFields = [
  { field: 'textureScale', title: 'Scale (×)', name: 'scale', fallback: 1 },
  { field: 'textureRotation', title: 'Rotation (°)', name: 'rotation', fallback: 0 },
] as const

/** Show the effective finish even when it comes from the authored model. */
export function MaterialChoice({ label, value, materials, original, onChange, textureTransform, onTextureChange }: {
  label: string; value: string; materials: SurfaceMaterialProduct[]
  original?: { materialId?: string; color?: string; label?: string; textureScale?: number }
  onChange: (id: string) => void
  textureTransform?: MaterialTextureTransform
  onTextureChange?: (field: keyof MaterialTextureTransform, value: number) => void
}) {
  const [open, setOpen] = useState(false)
  const originalMaterial = materials.find(material => material.id === original?.materialId)
  const material = value ? materials.find(material => material.id === value) : originalMaterial
  const originalLabel = originalMaterial?.productName ?? original?.label ?? (original?.color ? `Original · ${original.color}` : 'Original model material')
  const name = material?.productName ?? (value ? 'Unavailable material' : originalLabel)
  const pbr = material?.pbr
  const textured = pbr?.baseColorTextureUrl || pbr?.normalTextureUrl || pbr?.roughnessTextureUrl ||
    pbr?.metalnessTextureUrl || pbr?.ambientOcclusionTextureUrl
  return <>
    <button type="button" className="context-material-choice" aria-label={`${label} material`} aria-haspopup="dialog"
      title={material ? `${material.manufacturer} · ${material.productName}` : value || originalLabel} onClick={() => setOpen(true)}>
      <MaterialSwatch colour={material?.pbr.baseColor ?? original?.color} url={material?.pbr.baseColorTextureUrl} />
      <span><strong>{name}</strong><small>{value ? 'Choose material…' : 'Model finish · Choose…'}</small></span>
    </button>
    {textured && onTextureChange && <div className="context-material-mapping" role="group" aria-label={`${label} texture mapping`}>
      {textureFields.map(({ field, title, name, fallback }) => {
        const scale = field === 'textureScale'
        const current = textureTransform?.[field] ?? (scale ? original?.textureScale : undefined) ?? fallback
        return <label key={field}>
          <span>{title}</span>
          <input key={current} type="number" step="any" min={scale ? MIN_OBJECT_TEXTURE_SCALE : undefined}
            aria-label={`${label} texture ${name}`} defaultValue={current}
            onBlur={event => {
              const input = event.currentTarget
              const next = input.valueAsNumber
              if (!Number.isFinite(next) || (scale && next < MIN_OBJECT_TEXTURE_SCALE)) {
                input.value = String(current)
                return
              }
              const normalized = scale ? next : normalizeTextureRotation(next)
              input.value = String(normalized)
              if (normalized !== current) onTextureChange(field, normalized)
            }}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== 'Escape') return
              event.stopPropagation()
              event.preventDefault()
              if (event.key === 'Escape') event.currentTarget.value = String(current)
              event.currentTarget.blur()
            }} />
        </label>
      })}
    </div>}
    {open && <MaterialChooser label={label} value={value || original?.materialId || ''} materials={materials} originalLabel={originalLabel}
      onClose={() => setOpen(false)} onChoose={id => { onChange(id); setOpen(false) }} />}
  </>
}
