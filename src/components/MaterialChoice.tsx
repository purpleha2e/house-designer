import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SurfaceMaterialProduct } from '../types'
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

/** Show the effective finish even when it comes from the authored model. */
export function MaterialChoice({ label, value, materials, original, onChange }: {
  label: string; value: string; materials: SurfaceMaterialProduct[]
  original?: { materialId?: string; color?: string; label?: string }
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const originalMaterial = materials.find(material => material.id === original?.materialId)
  const material = value ? materials.find(material => material.id === value) : originalMaterial
  const originalLabel = originalMaterial?.productName ?? original?.label ?? (original?.color ? `Original · ${original.color}` : 'Original model material')
  const name = material?.productName ?? (value ? 'Unavailable material' : originalLabel)
  return <>
    <button type="button" className="context-material-choice" aria-label={`${label} material`} aria-haspopup="dialog"
      title={material ? `${material.manufacturer} · ${material.productName}` : value || originalLabel} onClick={() => setOpen(true)}>
      <MaterialSwatch colour={material?.pbr.baseColor ?? original?.color} url={material?.pbr.baseColorTextureUrl} />
      <span><strong>{name}</strong><small>{value ? 'Choose material…' : 'Model finish · Choose…'}</small></span>
    </button>
    {open && <MaterialChooser label={label} value={value || original?.materialId || ''} materials={materials} originalLabel={originalLabel}
      onClose={() => setOpen(false)} onChoose={id => { onChange(id); setOpen(false) }} />}
  </>
}
