import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { SurfaceMaterialPbr, SurfaceMaterialProduct } from '../types'
import { isLocalMaterial, localMaterialPrefix, materialMapSlots, saveMaterialToDevice, validateLocalMaterial, withLocalTextureHashes, type MaterialMapKey } from '../materials/localMaterials'
import { normalizeMaterialFolder } from '../materials/materialFolderPath'
import { createMaterialFolder, useMaterialFolders } from '../materials/useMaterialFolders'
import { MaterialLibraryTree } from './MaterialLibraryTree'
import { MaterialPreview, type MaterialPreviewLighting, type MaterialPreviewShape } from './MaterialPreview'
import './MaterialEditor.css'

function newMaterial(folder = ''): SurfaceMaterialProduct {
  return { id: `${localMaterialPrefix}${crypto.randomUUID()}`, manufacturer: 'My materials',
    folder,
    productName: 'Untitled material', category: 'wall-covering', collection: 'Local library',
    pbr: { baseColor: '#ffffff', roughness: .7, metalness: 0, normalStrength: 1,
      realWorldWidthMeters: 1, realWorldHeightMeters: 1, imageBasedLighting: true } }
}

export function MaterialEditor({ materials, onSave, onClose }: {
  materials: SurfaceMaterialProduct[]
  onSave: (material: SurfaceMaterialProduct) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => newMaterial())
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
  const worker = useRef<Worker | null>(null)
  const sequence = useRef(0)
  const jobs = useRef(new Map<number, MaterialMapKey>())
  const latest = useRef<Partial<Record<MaterialMapKey, number>>>({})
  const importInput = useRef<HTMLInputElement>(null)
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
  const update = (changes: Partial<SurfaceMaterialProduct>) => { if (busy) return; setDraft(value => ({ ...value, ...changes })); setDirty(true); setMessage('') }
  const updatePbr = (changes: Partial<SurfaceMaterialPbr>) => { if (busy) return; setDraft(value => ({ ...value, pbr: { ...value.pbr, ...changes } })); setDirty(true); setMessage('') }
  const switchDraft = (next: SurfaceMaterialProduct) => {
    if (busy) return
    if ((dirty || pending) && !window.confirm('Discard unsaved material changes?')) return
    latest.current = {}; jobs.current.clear(); setProcessing({})
    setDraft(structuredClone(next)); setDirty(false); setMessage('')
    setSelectedFolder(normalizeMaterialFolder(next.folder ?? ''))
  }
  const chooseImage = (key: MaterialMapKey, file?: File) => {
    if (busy || !file || !worker.current) return
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) { setMessage('Choose a PNG, JPEG or WebP image.'); return }
    const id = ++sequence.current
    jobs.current.set(id, key); latest.current[key] = id; setProcessing({ ...latest.current })
    setDirty(true); setMessage('Preparing image...'); worker.current.postMessage({ id, file })
  }
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (pending || busy) return
    const device = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-destination') !== 'browser'
    setBusy(true)
    let fileResult: 'saved' | 'downloaded' | undefined
    try {
      const material = { ...draft, productName: draft.productName.trim(), folder: normalizeMaterialFolder(draft.folder ?? '') }
      validateLocalMaterial(material)
      if (device) fileResult = await saveMaterialToDevice(material)
      await onSave(material); setDirty(false)
      setMessage(fileResult ? `${fileResult === 'saved' ? 'Material file saved.' : 'Material file download started.'} Working copy kept in My materials.`
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
  const addFolder = async () => {
    if (!folderName.trim()) return
    try {
      const name = normalizeMaterialFolder(folderName)
      if (!name) throw new Error('Enter a folder name.')
      const path = normalizeMaterialFolder([selectedFolder, name].filter(Boolean).join('/'))
      await createMaterialFolder(path)
      selectFolder(path); setFolderName(''); setCreatingFolder(false)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create the folder.') }
  }
  const moveMaterial = async (id: string, path: string) => {
    if (busy || pending) return
    if (id === draft.id) { update({ folder: path }); setSelectedFolder(path); return }
    const material = local.find(value => value.id === id)
    if (!material) return
    try { await onSave({ ...material, folder: path }); setMessage(`Moved ${material.productName} in your working library. Save its device file to keep the new folder there too.`) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not move the material.') }
  }
  const close = () => { if (!busy && (!dirty && !pending || window.confirm('Discard unsaved material changes?'))) onClose() }
  return <section ref={dialog} className="material-editor" role="dialog" aria-modal="true" aria-label="Material editor" onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); close() }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); dialog.current?.querySelector('form')?.requestSubmit()
    }
    if (event.key === 'Tab') {
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([hidden]):not(:disabled),select:not(:disabled)') ?? [])]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <header className="material-editor-header">
      <div><span className="material-editor-eyebrow">HOUSE DESIGNER / MY MATERIALS</span><h1>Material editor</h1></div>
      <button type="button" disabled={busy} onClick={close}>Back to designer</button>
    </header>
    <div className="material-editor-layout">
      <aside className="material-library">
        <h2>My materials <span>{local.length}</span></h2>
        <p>Your browser working library. Save a material file to keep it on your device.</p>
        <button type="button" onClick={() => switchDraft(newMaterial(selectedFolder))}>+ New material</button>
        <button type="button" onClick={() => importInput.current?.click()}>Import material file</button>
        <input ref={importInput} hidden type="file" accept=".json" aria-label="Import material file" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
          try { const value: unknown = JSON.parse(await file.text()); validateLocalMaterial(value); switchDraft(await withLocalTextureHashes(value)) }
          catch (error) { setMessage(error instanceof Error ? error.message : 'Could not import this material.') }
        }} />
        <button type="button" onClick={() => setCreatingFolder(value => !value)}>+ New folder</button>
        {creatingFolder && <div className="material-folder-create">
          <label>Folder name<input autoFocus maxLength={80} value={folderName} placeholder="e.g. Bricks or Metals/Chrome"
            onChange={event => setFolderName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void addFolder() } }} /></label>
          <small>Inside My materials{selectedFolder ? ` / ${selectedFolder}` : ''}</small>
          <button type="button" disabled={!folderName.trim()} onClick={() => void addFolder()}>Create folder</button>
        </div>}
        <MaterialLibraryTree materials={local.map(material => material.id === draft.id ? { ...material, folder: draft.folder } : material)}
          folders={folders} selectedId={draft.id} selectedFolder={selectedFolder} onSelect={switchDraft} onSelectFolder={selectFolder}
          onMove={(id, path) => { void moveMaterial(id, path) }} />
        {selectedFolder !== (draft.folder ?? '') && <button type="button" onClick={() => update({ folder: selectedFolder })}>
          Move current material here
        </button>}
        <p className="material-library-note">Material files survive clearing browser data. Used materials also travel with a saved house and its published tour. No account needed.</p>
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
            <button className="material-save" type="submit" data-destination="device" disabled={busy || pending}>{busy ? 'Saving...' : 'Save to device'}</button>
            <button type="submit" data-destination="browser" disabled={busy || pending}>Keep in browser</button>
            <span>{dirty ? 'Unsaved changes' : 'Local material'}</span>
          </div>
          <p className="material-editor-status" role="status">{message}</p>
        </div>
        <div className="material-editor-inspector">
          <h2>Surface</h2>
          <label>Name<input required maxLength={100} value={draft.productName} onChange={event => update({ productName: event.target.value })} /></label>
          <div className="material-folder-location"><strong>Folder</strong><span>My materials{draft.folder ? ` / ${draft.folder.split('/').join(' / ')}` : ''}</span></div>
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
          <h2>Texture maps</h2><p>PNG, JPEG or WebP. Images are prepared locally, up to 2048 px.</p>
          <div className="material-map-list">
            {materialMapSlots.map(({ key, label, help }) => <div className="material-map" key={key} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); chooseImage(key, event.dataTransfer.files[0]) }}>
              <div className="material-map-thumbnail">{draft.pbr[key] ? <img src={draft.pbr[key]} alt={`${label} map`} /> : <span>+</span>}</div>
              <div><label>{label}<input aria-label={`${label} map`} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { chooseImage(key, event.target.files?.[0]); event.target.value = '' }} /></label>
                <small>{processing[key] ? 'Preparing image...' : help}</small>
                {(draft.pbr[key] || processing[key]) && <button type="button" className="material-map-remove" onClick={() => {
                  delete latest.current[key]; setProcessing({ ...latest.current })
                  const hashes = { ...draft.pbr.textureSourceHashes }; delete hashes[key]
                  updatePbr({ [key]: undefined, textureSourceHashes: hashes })
                }}>Remove {label.toLowerCase()} map</button>}
              </div>
            </div>)}
          </div>
        </div>
      </form>
    </div>
  </section>
}
