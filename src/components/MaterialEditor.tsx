import { useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { SurfaceMaterialPbr, SurfaceMaterialProduct } from '../types'
import { isLocalMaterial, localMaterialPrefix, materialMapSlots, saveMaterialToDevice, validateLocalMaterial, withLocalTextureHashes, type MaterialMapKey } from '../materials/localMaterials'
import { normalizeMaterialFolder } from '../materials/materialFolderPath'
import { createMaterialFolder, useMaterialFolders } from '../materials/useMaterialFolders'
import { MaterialLibraryTree } from './MaterialLibraryTree'
import { MaterialPreview, type MaterialPreviewLighting, type MaterialPreviewShape } from './MaterialPreview'
import { MaterialCatalogueFields, MaterialPublication } from './MaterialPublication'
import { portalRequest } from '../assetPortalClient'
import { MaterialCatalogueManagement } from './MaterialCatalogueManagement'
import { MaterialCatalogueContext } from '../materials/materialCatalogueContext'
import { getCatalogueFolderPaths, getMaterialCatalogueFolder, type MaterialCatalogueChange } from '../materials/materialCatalogueLayout'
import { materialCategoryLabel } from '../materials/materialCatalogueMetadata'
import { createPublicMaterialUpload, embedCatalogueMaterial, getPublicMaterialChoices, getPublicMaterialDetails, matchPublicMaterialDetails } from '../materials/materialTransfer'
import './MaterialEditor.css'

function newMaterial(folder = ''): SurfaceMaterialProduct {
  return { id: `${localMaterialPrefix}${crypto.randomUUID()}`, manufacturer: 'My materials',
    folder,
    productName: 'Untitled material', category: 'wall-covering', collection: 'Local library',
    pbr: { baseColor: '#ffffff', roughness: .7, metalness: 0, normalStrength: 1,
      realWorldWidthMeters: 1, realWorldHeightMeters: 1, imageBasedLighting: true } }
}

type MaterialEditorProps = {
  materials: SurfaceMaterialProduct[]
  onClose: () => void
} & ({
  publicCatalogue?: undefined
  onSave: (material: SurfaceMaterialProduct) => Promise<void>
} | {
  publicCatalogue: {
    token: string
    onPublished: () => Promise<void>
    onSaved: (material: SurfaceMaterialProduct) => void
    onUpdate: (change: MaterialCatalogueChange, token: string) => Promise<void>
  }
  onSave?: undefined
})

export function MaterialEditor({ materials, onSave, publicCatalogue, onClose }: MaterialEditorProps) {
  const [draft, setDraft] = useState(() => newMaterial())
  const [catalogueSource, setCatalogueSource] = useState<SurfaceMaterialProduct | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [adminFolder, setAdminFolder] = useState('')
  const [catalogueMaterialSelected, setCatalogueMaterialSelected] = useState(false)
  const [showRemoved, setShowRemoved] = useState(false)
  const layout = useContext(MaterialCatalogueContext)
  const isPublicBrowser = !!publicCatalogue
  const readOnly = !!catalogueSource && !isPublicBrowser
  const editDetails = isPublicBrowser && catalogueSource ? getPublicMaterialDetails(draft) : undefined
  const editChoices = editDetails && catalogueSource ? getPublicMaterialChoices(materials, getPublicMaterialDetails(catalogueSource), editDetails.brand) : undefined
  const catalogueFolders = useMemo(() => isPublicBrowser ? getCatalogueFolderPaths(layout, materials) : [], [layout, materials, isPublicBrowser])
  const sourceFolder = catalogueSource ? getMaterialCatalogueFolder(catalogueSource, layout) : undefined
  const inspectorFolder = isPublicBrowser ? sourceFolder ?? adminFolder : draft.folder
  const catalogueLocation = adminFolder ? `Catalogue / ${adminFolder.replaceAll('/', ' / ')}` : 'Catalogue'
  const title = publicCatalogue ? 'Public Materials' : 'Material browser'
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [shape, setShape] = useState<MaterialPreviewShape>('sphere')
  const [lighting, setLighting] = useState<MaterialPreviewLighting>('studio')
  const [processing, setProcessing] = useState<Partial<Record<MaterialMapKey, number>>>({})
  const folders = useMaterialFolders()
  const [selectedFolder, setSelectedFolder] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderError, setFolderError] = useState('')
  const worker = useRef<Worker | null>(null)
  const sequence = useRef(0)
  const jobs = useRef(new Map<number, MaterialMapKey>())
  const latest = useRef<Partial<Record<MaterialMapKey, number>>>({})
  const importInput = useRef<HTMLInputElement>(null)
  const publishOnImport = useRef(false)
  const library = useRef<HTMLElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const local = materials.filter(isLocalMaterial)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLInputElement>('input[maxlength]')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => {
    const current = new Worker(new URL('../materials/materialImage.worker.ts', import.meta.url), { type: 'module' })
    worker.current = current
    current.onmessage = ({ data }: MessageEvent<{ id: number; url?: string; hash?: string; error?: string }>) => {
      const key = jobs.current.get(data.id); jobs.current.delete(data.id)
      if (!key || latest.current[key] !== data.id) return
      delete latest.current[key]
      setProcessing({ ...latest.current })
      if (data.error) { setMessage(data.error); return }
      setDraft(value => ({ ...value, pbr: { ...value.pbr, [key]: data.url,
        textureSourceHashes: { ...value.pbr.textureSourceHashes, [key]: data.hash },
        // A map is multiplied by its factor; a zero metalness factor hides the entire map.
        ...(key === 'metalnessTextureUrl' ? { metalness: 1 } : {}),
        ...(key === 'roughnessTextureUrl' ? { roughness: 1 } : {}),
      } }))
      setDirty(true); setMessage('Map ready. Save the material to keep your changes.')
    }
    current.onerror = () => { jobs.current.clear(); latest.current = {}; setProcessing({}); setMessage('Image processing failed. Please try a PNG, JPEG or WebP image.') }
    return () => { current.terminate(); worker.current = null }
  }, [])
  const pending = Object.keys(processing).length > 0
  const update = (changes: Partial<SurfaceMaterialProduct>) => { if (busy || readOnly) return; setDraft(value => ({ ...value, ...changes })); setDirty(true); setMessage('') }
  const updatePbr = (changes: Partial<SurfaceMaterialPbr>) => { if (busy || readOnly) return; setDraft(value => ({ ...value, pbr: { ...value.pbr, ...changes } })); setDirty(true); setMessage('') }
  const switchDraft = (next: SurfaceMaterialProduct) => {
    if (busy) return false
    if ((dirty || pending) && !window.confirm('Discard unsaved material changes?')) return false
    latest.current = {}; jobs.current.clear(); setProcessing({})
    const copy = structuredClone(next)
    if (isLocalMaterial(next)) {
      setCatalogueSource(null)
      setCatalogueMaterialSelected(false)
      if (!publicCatalogue) setSelectedFolder(normalizeMaterialFolder(next.folder ?? ''))
    } else {
      setCatalogueSource(next)
      setCatalogueMaterialSelected(!!publicCatalogue)
      if (!publicCatalogue) {
        copy.id = `${localMaterialPrefix}${crypto.randomUUID()}`
        copy.manufacturer = 'My materials'
        copy.collection = 'Local library'
        copy.folder = selectedFolder
        delete copy.originalTextureUrls
        delete copy.catalogueFolder
      }
    }
    setPublishing(false); setDraft(copy); setDirty(false); setMessage('')
    return true
  }
  const beginPublish = () => {
    setPublishing(true); setMessage('')
    if (library.current) library.current.scrollTop = 0
  }
  const openImport = (publish = false) => {
    if (busy) return
    publishOnImport.current = publish
    importInput.current?.click()
  }
  const chooseImage = (key: MaterialMapKey, file?: File) => {
    if (busy || readOnly || !file || !worker.current) return
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) { setMessage('Choose a PNG, JPEG or WebP image.'); return }
    const id = ++sequence.current
    jobs.current.set(id, key); latest.current[key] = id; setProcessing({ ...latest.current })
    setDirty(true); setMessage('Preparing image...'); worker.current.postMessage({ id, file })
  }
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (pending || busy) return
    if (publicCatalogue) {
      if (!catalogueSource) { if (!publishing) beginPublish(); return }
      if (!dirty || !editDetails || !editChoices) return
      setBusy(true)
      setMessage('Saving public material…')
      try {
        const body = await createPublicMaterialUpload(draft, matchPublicMaterialDetails(editDetails, editChoices), catalogueSource)
        const { material } = await portalRequest<{ material: SurfaceMaterialProduct }>(`/api/portal/materials/${encodeURIComponent(catalogueSource.id)}`, {
          method: 'PATCH', token: publicCatalogue.token, body,
        })
        setCatalogueSource(material); setDraft(structuredClone(material)); setDirty(false)
        publicCatalogue.onSaved(material)
        setMessage(`Saved changes to ${material.productName}.`)
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the public material.') }
      finally { setBusy(false) }
      return
    }
    if (!onSave) return
    const device = !catalogueSource && (event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-destination') !== 'browser'
    setBusy(true)
    let fileResult: 'saved' | 'downloaded' | undefined
    try {
      const named = { ...draft, productName: draft.productName.trim(), folder: normalizeMaterialFolder(draft.folder ?? '') }
      if (catalogueSource) setMessage('Preparing the texture maps for your copy…')
      const material = catalogueSource ? await embedCatalogueMaterial(named, catalogueSource) : named
      validateLocalMaterial(material)
      if (device) fileResult = await saveMaterialToDevice(material)
      await onSave(material); setDraft(material); setCatalogueSource(null); setDirty(false)
      setMessage(catalogueSource ? 'Copy saved in My materials.' : fileResult ? `${fileResult === 'saved' ? 'Material file saved.' : 'Material file download started.'} Working copy kept in My materials.`
        : 'Working copy saved in this browser. Use Save to device to keep a file backup.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setMessage(`${fileResult ? 'Your material file was saved, but the browser copy could not be stored. ' : ''}${error instanceof Error ? error.message : 'Could not save the material.'}`)
    }
    finally { setBusy(false) }
  }
  const selectFolder = (path: string) => {
    if (busy) return
    setSelectedFolder(path)
    // Browsing folders with a pristine new material must not create discard
    // prompts when the next action is opening an existing library item.
    if (!local.some(material => material.id === draft.id) && path !== (draft.folder ?? '')) setDraft(value => ({ ...value, folder: path }))
  }
  const selectCatalogueFolder = (path: string) => {
    if (busy) return
    setAdminFolder(path)
    setCatalogueMaterialSelected(false)
    setFolderError('')
  }
  const moveMaterial = async (id: string, path: string) => {
    if (busy || pending || !onSave) return
    if (id === draft.id) { update({ folder: path }); setSelectedFolder(path); return }
    const material = local.find(value => value.id === id)
    if (!material) return
    try { await onSave({ ...material, folder: path }); setMessage(`Moved ${material.productName} in your working library. Save its device file to keep the new folder there too.`) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not move the material.') }
  }
  const updateCatalogue = async (change: MaterialCatalogueChange) => {
    if (!publicCatalogue) return
    await publicCatalogue.onUpdate(change, publicCatalogue.token)
    if (change.action === 'move-folder') setAdminFolder(change.to)
    if (change.action === 'create-folder') setAdminFolder(change.path)
    if (change.action === 'delete-folder') setAdminFolder(change.path.split('/').slice(0, -1).join('/'))
    setMessage('Catalogue updated.')
  }
  const addFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !folderName.trim()) return
    setBusy(true)
    setFolderError('')
    try {
      if (publicCatalogue && /[/\\]/.test(folderName)) throw new Error('Enter a folder name without slashes.')
      const name = normalizeMaterialFolder(folderName)
      if (!name) throw new Error('Enter a folder name.')
      const path = normalizeMaterialFolder([publicCatalogue ? adminFolder : selectedFolder, name].filter(Boolean).join('/'))
      if (publicCatalogue) {
        await updateCatalogue({ action: 'create-folder', path })
        setCatalogueMaterialSelected(false)
      } else {
        await createMaterialFolder(path)
        selectFolder(path)
      }
      setFolderName(''); setCreatingFolder(false)
    } catch (error) { setFolderError(error instanceof Error ? error.message : 'Could not create the folder.') }
    finally { setBusy(false) }
  }
  const moveCatalogueMaterial = async (id: string, folder: string) => {
    if (busy || pending) return
    setBusy(true)
    try { await updateCatalogue({ action: 'move-material', id, folder }) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not move the material.') }
    finally { setBusy(false) }
  }
  const close = () => { if (!busy && (!dirty && !pending || window.confirm('Discard unsaved material changes?'))) onClose() }
  return <section ref={dialog} className="material-editor" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); close() }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); dialog.current?.querySelector<HTMLFormElement>('.material-editor-form')?.requestSubmit()
    }
    if (event.key === 'Tab') {
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([hidden]):not(:disabled),select:not(:disabled)') ?? [])]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <header className="material-editor-header">
      <h1>{title}</h1>
      <button type="button" disabled={busy} onClick={close}>Back to designer</button>
    </header>
    <div className="material-editor-layout">
      <aside ref={library} className="material-library">
        {!publicCatalogue && <h2>Libraries</h2>}
        {publicCatalogue && !publishing && <div className="material-folder-location"><strong>Selected folder</strong><span>{catalogueLocation}</span></div>}
        <button type="button" disabled={busy} onClick={() => switchDraft(newMaterial(publicCatalogue ? '' : selectedFolder))}>+ New material</button>
        <button type="button" disabled={busy} onClick={() => openImport()}>Import material file</button>
        <input ref={importInput} hidden type="file" accept=".json" aria-label="Import material file" onChange={async event => {
          const file = event.target.files?.[0], publish = publishOnImport.current
          event.target.value = ''; publishOnImport.current = false
          if (!file || busy) return
          try {
            const value: unknown = JSON.parse(await file.text()); validateLocalMaterial(value)
            if (switchDraft(await withLocalTextureHashes(value)) && publish) beginPublish()
          }
          catch (error) { setMessage(error instanceof Error ? error.message : 'Could not import this material.') }
        }} />
        <button type="button" disabled={busy} onClick={() => { setCreatingFolder(value => !value); setFolderError('') }}>+ New folder</button>
        {creatingFolder && <form className="material-folder-create" onSubmit={event => void addFolder(event)}>
          <label>Folder name<input autoFocus maxLength={80} value={folderName} disabled={busy}
            placeholder={publicCatalogue ? 'e.g. Natural stone' : 'e.g. Bricks or Metals/Chrome'}
            onChange={event => { setFolderName(event.target.value); setFolderError('') }} /></label>
          <small>Inside {publicCatalogue ? catalogueLocation : `My materials${selectedFolder ? ` / ${selectedFolder}` : ''}`}</small>
          {folderError && <p role="alert">{folderError}</p>}
          <button type="submit" disabled={busy || !folderName.trim()}>Create folder</button>
        </form>}
        {publicCatalogue && !publishing && <MaterialCatalogueManagement folder={catalogueMaterialSelected ? sourceFolder ?? '' : adminFolder} busy={busy} onBusyChange={setBusy}
          material={catalogueMaterialSelected ? catalogueSource ?? undefined : undefined}
          removed={!!(catalogueSource && layout.entries[catalogueSource.id]?.removed)} showRemoved={showRemoved} folders={catalogueFolders}
          onShowRemoved={setShowRemoved} onImport={() => openImport(true)} onUpdate={updateCatalogue} />}
        {publicCatalogue && publishing && <MaterialPublication token={publicCatalogue.token} material={draft} materials={materials} busy={busy} onBusyChange={setBusy}
          folder={adminFolder}
          onCancel={() => setPublishing(false)} onPublished={async () => {
            setDirty(false)
            setDraft(newMaterial())
            setPublishing(false)
            setMessage('New material published to the public catalogue.')
            await publicCatalogue.onPublished()
          }} />}
        <MaterialLibraryTree materials={publicCatalogue ? materials : materials.map(material => material.id === draft.id ? { ...material, folder: draft.folder } : material)}
          folders={folders} selectedId={publicCatalogue && !catalogueMaterialSelected ? '' : catalogueSource?.id ?? draft.id} selectedFolder={selectedFolder}
          browserLibrary={publicCatalogue ? 'catalogue' : 'all'}
          selectedCatalogueFolder={publicCatalogue ? adminFolder : undefined} showRemoved={!!publicCatalogue && showRemoved}
          onSelectCatalogueFolder={publicCatalogue ? selectCatalogueFolder : undefined}
          onMoveCatalogueMaterial={publicCatalogue && !publishing ? (id, path) => { void moveCatalogueMaterial(id, path) } : undefined}
          loadCatalogueSwatches={false} onSelect={switchDraft} onSelectFolder={publicCatalogue ? undefined : selectFolder}
          onMove={publicCatalogue ? undefined : (id, path) => { void moveMaterial(id, path) }} />
        {!publicCatalogue && !catalogueSource && selectedFolder !== (draft.folder ?? '') && <button type="button" onClick={() => update({ folder: selectedFolder })}>
          Move current material here
        </button>}
      </aside>
      <form className="material-editor-form" onSubmit={save}>
        <div className="material-editor-preview-column">
          <div className="material-preview-tools" role="group" aria-label="Preview shape">
            {(['sphere', 'tile', 'corner'] as const).map(value => <button key={value} type="button" aria-pressed={shape === value} onClick={() => setShape(value)}>{value === 'sphere' ? 'Sphere' : value === 'tile' ? 'Tile' : 'Room corner'}</button>)}
          </div>
          <div className="material-preview" aria-label="Live material preview"><MaterialPreview material={draft} shape={shape} lighting={lighting} /></div>
          <div className="material-preview-caption"><span>Drag to orbit · Scroll to zoom</span>
            <label>Preview lighting<select value={lighting} onChange={event => setLighting(event.target.value as MaterialPreviewLighting)}>
              <option value="studio">Studio</option><option value="daylight">Daylight</option><option value="grazing">Grazing light</option>
            </select></label></div>
          <div className="material-editor-actions">
            {publicCatalogue ? (!publishing && <button className="material-save" type="submit"
              disabled={busy || pending || !draft.productName.trim() || (!!catalogueSource && !dirty)}>{catalogueSource ? 'Save changes' : 'Publish to catalogue'}</button>)
              : catalogueSource ? <button className="material-save" type="submit" data-destination="browser" disabled={busy || pending}>Save as my copy</button>
              : <>
                <button className="material-save" type="submit" data-destination="device" disabled={busy || pending}>{busy && !publishing ? 'Saving...' : 'Save to device'}</button>
                <button type="submit" data-destination="browser" disabled={busy || pending}>Keep in browser</button>
              </>}
            <span>{dirty ? 'Unsaved changes' : readOnly ? 'Public material preview' : catalogueSource ? 'Public material' : publicCatalogue ? 'New public material' : 'Local material'}</span>
          </div>
          <p className="material-editor-status" role="status">{message}</p>
        </div>
        <div className="material-editor-inspector"><fieldset disabled={readOnly || busy || publishing} aria-label="Material settings">
          <h2>Surface</h2>
          <label>Name<input required maxLength={100} value={draft.productName} onChange={event => update({ productName: event.target.value })} /></label>
          {editDetails && editChoices && catalogueSource && <MaterialCatalogueFields
            key={JSON.stringify([catalogueSource.id, catalogueSource.manufacturer, catalogueSource.collection,
              catalogueSource.catalogueCategory, catalogueSource.materialType])}
            details={editDetails} choices={editChoices} disabled={busy} onChange={changes => update({
              manufacturer: changes.brand ?? editDetails.brand, collection: changes.collection ?? editDetails.collection,
              catalogueCategory: changes.category ?? editDetails.category, materialType: changes.materialType ?? editDetails.materialType,
            })} />}
          {readOnly && catalogueSource && <dl className="material-editor-details">
            <dt>Brand</dt><dd>{catalogueSource.manufacturer}</dd>
            {catalogueSource.collection && <><dt>Collection</dt><dd>{catalogueSource.collection}</dd></>}
            <dt>Category</dt><dd>{materialCategoryLabel(catalogueSource)}</dd>
            {catalogueSource.materialType && <><dt>Material type</dt><dd>{catalogueSource.materialType}</dd></>}
          </dl>}
          <div className="material-folder-location"><strong>{catalogueSource && !publicCatalogue ? 'Copy destination' : 'Folder'}</strong><span>{publicCatalogue ? 'Catalogue' : 'My materials'}
            {inspectorFolder?.split('/').filter(Boolean).map(part => ` / ${part}`).join('')}</span></div>
          <label>Base colour<input type="color" value={draft.pbr.baseColor ?? '#ffffff'} onChange={event => updatePbr({ baseColor: event.target.value })} /></label>
          {([
            ['roughness', 'Roughness', 0, 1, .01, .7],
            ['metalness', 'Metalness', 0, 1, .01, 0],
            ['normalStrength', 'Normal strength', 0, 3, .05, 1],
            ['displacementScale', 'Height amount (m)', 0, .05, .001, .003],
          ] as const).map(([key, label, min, max, step, fallback]) => <label key={key}>{label}
            <div className="material-range"><input aria-label={label} type="range" min={min} max={max} step={step} value={draft.pbr[key] ?? fallback} onChange={event => updatePbr({ [key]: Number(event.target.value) })} />
              <output>{(draft.pbr[key] ?? fallback).toFixed(key === 'displacementScale' ? 3 : 2)}</output></div>
          </label>)}
          <label className="material-checkbox"><input type="checkbox" checked={draft.pbr.normalFlipY ?? false} onChange={event => updatePbr({ normalFlipY: event.target.checked })} />Flip normal green channel (DirectX map)</label>
          <label className="material-checkbox"><input type="checkbox" checked={draft.pbr.imageBasedLighting ?? false} onChange={event => updatePbr({ imageBasedLighting: event.target.checked })} />Environment reflections</label>
          <h2>Texture scale</h2><p>Real-world size of one texture tile.</p>
          <div className="material-settings-grid">
            {(['realWorldWidthMeters', 'realWorldHeightMeters'] as const).map((key, index) => <label key={key}>{index === 0 ? 'Width (m)' : 'Height (m)'}<input required type="number" min="0.001" max="1000" step="any" value={draft.pbr[key] ?? 1} onChange={event => updatePbr({ [key]: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>)}
          </div>
          <label>Rotation<select value={draft.pbr.rotation ?? 0} onChange={event => updatePbr({ rotation: Number(event.target.value) })}><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>
          <h2>Texture maps</h2>{!readOnly && <p>PNG, JPEG or WebP. Images are prepared locally, up to 2048 px.</p>}
          <div className="material-map-list">
            {materialMapSlots.map(({ key, label, help }) => <div className="material-map" key={key} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); chooseImage(key, event.dataTransfer.files[0]) }}>
              <div className="material-map-thumbnail">{draft.pbr[key] ? /\.ktx2(?:[?#]|$)/i.test(draft.pbr[key]!)
                ? <small>KTX2</small> : <img src={draft.pbr[key]} alt={`${label} map`} /> : <span>+</span>}</div>
              <div><label>{label}<input aria-label={`${label} map`} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { chooseImage(key, event.target.files?.[0]); event.target.value = '' }} /></label>
                <small>{readOnly ? (draft.pbr[key] ? 'Included' : 'None') : processing[key] ? 'Preparing image...' : help}</small>
                {!readOnly && (draft.pbr[key] || processing[key]) && <button type="button" className="material-map-remove" onClick={() => {
                  delete latest.current[key]; setProcessing({ ...latest.current })
                  const hashes = { ...draft.pbr.textureSourceHashes }; delete hashes[key]
                  updatePbr({ [key]: undefined, textureSourceHashes: hashes })
                }}>Remove {label.toLowerCase()} map</button>}
              </div>
            </div>)}
          </div>
        </fieldset></div>
      </form>
    </div>
  </section>
}
