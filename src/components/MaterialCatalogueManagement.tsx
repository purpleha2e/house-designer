import { useId, useState, type FormEvent } from 'react'
import type { SurfaceMaterialProduct } from '../types'
import { normalizeMaterialFolder } from '../materials/materialFolderPath'
import type { MaterialCatalogueChange } from '../materials/materialCatalogueLayout'

type Props = {
  folder: string
  material?: SurfaceMaterialProduct
  removed: boolean
  showRemoved: boolean
  folders: string[]
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onUpdate: (change: MaterialCatalogueChange) => Promise<void>
  onShowRemoved: (value: boolean) => void
  onImport: () => void
}

export function MaterialCatalogueManagement(props: Props) {
  return <section className="material-publication" aria-label="Catalogue management">
    <h2>Manage catalogue</h2>
    <button type="button" disabled={props.busy} onClick={props.onImport}>Import &amp; publish</button>
    <label className="material-checkbox"><input type="checkbox" checked={props.showRemoved} disabled={props.busy}
      onChange={event => props.onShowRemoved(event.currentTarget.checked)} />Show removed materials</label>
    {(props.material || props.folder) && <CatalogueEditControls key={props.material?.id ?? `folder:${props.folder}`} {...props} />}
  </section>
}

type Operation = 'move-folder' | 'delete-folder' | 'move-material' | 'remove-material' | 'restore-material'

const labels: Record<Operation, string> = {
  'move-folder': 'Move or rename folder', 'delete-folder': 'Delete folder',
  'move-material': 'Move material', 'remove-material': 'Remove material', 'restore-material': 'Restore material',
}

function CatalogueEditControls({ folder, material, removed, folders, busy, onBusyChange, onUpdate }: Props) {
  const [operation, setOperation] = useState<Operation | null>(null)
  const [destination, setDestination] = useState('')
  const [error, setError] = useState('')
  const suggestions = useId()
  const needsPath = operation === 'move-folder' || operation === 'move-material'
  const actions: Operation[] = material ? ['move-material', removed ? 'restore-material' : 'remove-material']
    : ['move-folder', 'delete-folder']

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !operation) return
    onBusyChange(true)
    setError('')
    try {
      const path = needsPath ? normalizeMaterialFolder(destination) : ''
      let change: MaterialCatalogueChange
      switch (operation) {
        case 'move-folder': change = { action: operation, from: folder, to: path }; break
        case 'delete-folder': change = { action: operation, path: folder }; break
        case 'move-material': change = { action: operation, id: material!.id, folder: path }; break
        default: change = { action: 'set-removed', id: material!.id, removed: operation === 'remove-material' }
      }
      await onUpdate(change)
      setOperation(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update the catalogue.') }
    finally { onBusyChange(false) }
  }

  return <form className="material-catalogue-controls" onSubmit={event => void apply(event)}>
    {material && <strong>{material.productName}</strong>}
    {!operation ? actions.map(action => <button key={action} type="button" disabled={busy} onClick={() => {
      setOperation(action); setDestination(folder); setError('')
    }}>{labels[action]}</button>) : <>
      {needsPath ? <label>Destination folder path
        <input list={suggestions} disabled={busy} required={operation !== 'move-material'} maxLength={512}
          placeholder={operation === 'move-material' ? 'Leave blank for Catalogue root' : undefined}
          value={destination} onChange={event => setDestination(event.currentTarget.value)} />
      </label> : <p>{operation === 'delete-folder' ? 'Delete this empty folder?' : operation === 'remove-material'
        ? 'Remove this material from the catalogue? Houses using it keep the finish.' : 'Make this material available in the catalogue again?'}</p>}
      <datalist id={suggestions}>{folders.map(path => <option key={path} value={path} />)}</datalist>
      <button type="submit" disabled={busy}>{needsPath ? 'Save catalogue change' : `Confirm ${labels[operation].toLowerCase()}`}</button>
      <button type="button" disabled={busy} onClick={() => { setOperation(null); setError('') }}>Cancel change</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </form>
}
