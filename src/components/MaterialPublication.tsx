import { useState, type FormEvent } from 'react'
import { portalRequest } from '../assetPortalClient'
import { createPublicMaterialUpload, getPublicMaterialChoices, getPublicMaterialDetails, matchPublicMaterialDetails,
  type PublicMaterialDetails } from '../materials/materialTransfer'
import { materialCategoryLabel, normalizeMaterialLabel } from '../materials/materialCatalogueMetadata'
import type { SurfaceMaterialProduct } from '../types'

// Catalogue labels are trimmed, so this value can represent an empty collection.
const noSelection = ' '

function CatalogueSelect({ label, options, value, onChange, disabled, emptyLabel }: {
  label: string; options: string[]; value: string; onChange: (value: string) => void; disabled: boolean; emptyLabel?: string
}) {
  const [adding, setAdding] = useState(false)
  const current = normalizeMaterialLabel(value)
  const existing = options.find(option => option.toLowerCase() === current.toLowerCase())
  const showInput = adding || (!current && !emptyLabel)
  const selected = showInput ? '' : existing ?? (current || noSelection)
  return <>
    <label>{label}<select disabled={disabled} value={selected} onChange={event => {
      const selection = event.currentTarget.value
      setAdding(selection === '')
      onChange(selection.trim())
    }}>
      {emptyLabel && <option value={noSelection}>{emptyLabel}</option>}
      {!showInput && current && !existing && <option value={current}>{current}</option>}
      {options.map(option => <option key={option} value={option}>{option}</option>)}
      <option value="">Add new {label.toLowerCase()}…</option>
    </select></label>
    {showInput && <label>New {label.toLowerCase()}<input autoFocus={adding} required maxLength={100} disabled={disabled}
      value={value} onChange={event => onChange(event.currentTarget.value)} /></label>}
  </>
}

export function MaterialCatalogueFields({ details, choices, onChange, disabled }: {
  details: PublicMaterialDetails; choices: ReturnType<typeof getPublicMaterialChoices>;
  onChange: (changes: Partial<PublicMaterialDetails>) => void; disabled: boolean
}) {
  return <>
    <CatalogueSelect label="Brand" options={choices.brand} value={details.brand} onChange={brand => onChange({ brand })} disabled={disabled} />
    <CatalogueSelect label="Collection" options={choices.collection} value={details.collection} emptyLabel="No collection"
      onChange={collection => onChange({ collection })} disabled={disabled} />
    <CatalogueSelect label="Category" options={choices.category} value={details.category} onChange={category => onChange({ category })} disabled={disabled} />
    <CatalogueSelect label="Material type" options={choices.materialType} value={details.materialType} onChange={materialType => onChange({ materialType })} disabled={disabled} />
  </>
}

export function MaterialPublication({ token, material, materials, busy, onBusyChange, onPublished, onCancel, folder }: {
  token: string
  material: SurfaceMaterialProduct; busy: boolean; onBusyChange: (busy: boolean) => void
  materials: SurfaceMaterialProduct[]
  onPublished: () => Promise<void>; onCancel: () => void
  folder: string
}) {
  const category = materialCategoryLabel(material)
  const initial = { ...getPublicMaterialDetails(material), category, materialType: normalizeMaterialLabel(material.materialType) || category }
  const [details, setDetails] = useState(() => matchPublicMaterialDetails(initial, getPublicMaterialChoices(materials, initial, initial.brand)))
  const choices = getPublicMaterialChoices(materials, initial, details.brand)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    onBusyChange(true)
    setError('')
    try {
      const body = await createPublicMaterialUpload(material, matchPublicMaterialDetails(details, choices))
      body.set('catalogueFolder', folder)
      await portalRequest('/api/portal/materials/publish', { method: 'POST', token, body })
      await onPublished()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not publish the material.') }
    finally { onBusyChange(false) }
  }

  return <form className="material-publication" aria-label="Publish material" onSubmit={event => void submit(event)}>
    <h2>Publish a new material</h2>
    <div className="material-folder-location"><strong>Publish to</strong><span>Catalogue{folder ? ` / ${folder.replaceAll('/', ' / ')}` : ''}</span></div>
    <label>Name<input value={details.name} disabled={busy} maxLength={100} required onChange={event => {
      const name = event.currentTarget.value
      setDetails(value => ({ ...value, name }))
    }} /></label>
    <MaterialCatalogueFields details={details} choices={choices} disabled={busy}
      onChange={changes => setDetails(value => ({ ...value, ...changes }))} />
    <button type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish new material'}</button>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={onCancel}>Cancel publishing</button>
  </form>
}
