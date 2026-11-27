import { useId, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { portalRequest, readPortalToken, setPortalToken, type PortalSession } from '../assetPortalClient'
import type { ModelDefinition } from '../models/modelLibrary'
import {
  getModelCatalogueFolder, getModelLibraryRoot, getModelLibrarySection, getModelTypeLabel, matchesModelTags, normalizeModelTag,
  type ModelLibraryRoot, type ModelLibrarySection,
} from '../models/modelLibrarySections'
import { normalizeObjectFolder, objectBuilderOptions, type ObjectBuilderType, type ObjectCatalogue, type ObjectCatalogueEntry } from '../models/objectCatalogue'

type ModelSelectorProps = {
  initialRoot: ModelLibraryRoot
  initialSection: ModelLibrarySection
  initialFolder?: string
  models: ModelDefinition[]
  publicCatalogue: ObjectCatalogue
  personalCatalogue: ObjectCatalogue
  onClose: () => void
  onRefreshModels: () => void
  onSelectModel: (modelId: string) => void
  onBuild: (type: ObjectBuilderType, folder: string) => void
  onEdit: (model: ModelDefinition) => void
  onOpenPublicUploads: () => void
  onUpdatePublic: (id: string, entry: ObjectCatalogueEntry, token: string) => Promise<void>
  onUpdatePersonal: (id: string, entry: ObjectCatalogueEntry) => void
}

type Folder = { name: string; path: string; children: Map<string, Folder>; models: ModelDefinition[] }

const folderOrder = (left: Folder, right: Folder) => left.name.localeCompare(right.name)

function modelFolders(models: ModelDefinition[], catalogue: ObjectCatalogue) {
  const root: Folder = { name: '', path: '', children: new Map(), models: [] }
  for (const model of models) {
    let parent = root
    for (const name of normalizeObjectFolder(getModelCatalogueFolder(model, catalogue[model.id])).split('/')) {
      const key = name.toLowerCase()
      const existing = parent.children.get(key)
      const folder: Folder = existing ?? { name, path: parent.path ? parent.path + '/' + name : name, children: new Map(), models: [] }
      if (!existing) parent.children.set(key, folder)
      parent = folder
    }
    parent.models.push(model)
  }
  return [...root.children.values()].sort(folderOrder)
}

export function ModelSelector({
  initialRoot, initialSection, initialFolder, models, publicCatalogue, personalCatalogue,
  onClose, onRefreshModels, onSelectModel, onBuild, onEdit, onOpenPublicUploads, onUpdatePublic, onUpdatePersonal,
}: ModelSelectorProps) {
  const [root, setRoot] = useState(initialRoot)
  const [section, setSection] = useState(initialSection)
  const [folder, setFolder] = useState(initialFolder ?? '')
  const [view, setView] = useState<'filter' | 'hierarchy'>('hierarchy')
  const [text, setText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [building, setBuilding] = useState(false)
  const [destination, setDestination] = useState('')
  const [managedId, setManagedId] = useState<string | null>(null)
  const [confirmRemoval, setConfirmRemoval] = useState(false)
  const [showRemoved, setShowRemoved] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [adminToken, setAdminToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const tagInput = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const tagInputId = useId()
  const folderSuggestionsId = useId()
  const nextTag = normalizeModelTag(text)
  const canManage = root === 'mine' || !!adminToken
  const catalogue = root === 'mine' ? personalCatalogue : publicCatalogue
  const sectionModels = useMemo(
    () => models.filter(model => getModelLibraryRoot(model) === root && getModelLibrarySection(model) === section)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [models, root, section],
  )
  const visibleModels = sectionModels.filter(model => {
    const path = getModelCatalogueFolder(model, catalogue[model.id]).toLowerCase()
    const current = folder.toLowerCase()
    return (!catalogue[model.id]?.removed || (canManage && showRemoved)) &&
      (!current || path === current || path.startsWith(current + '/')) &&
      (view !== 'filter' || matchesModelTags(model, tags, path))
  })
  const suggestedFolders = [...new Set([
    ...objectBuilderOptions.filter(option => option.section === section).map(option => option.folder),
    ...models.filter(model => getModelLibrarySection(model) === section).map(model =>
      getModelCatalogueFolder(model, getModelLibraryRoot(model) === 'mine' ? personalCatalogue[model.id] : publicCatalogue[model.id])),
  ])].sort((a, b) => a.localeCompare(b))
  const managed = canManage && sectionModels.find(model => model.id === managedId)

  function changeLocation(nextRoot: ModelLibraryRoot, nextSection: ModelLibrarySection) {
    setRoot(nextRoot)
    setSection(nextSection)
    setFolder('')
    setManagedId(null)
    setConfirmRemoval(false)
    setBuilding(false)
    setSigningIn(false)
    setShowRemoved(false)
    setMessage('')
  }

  function beginBuild(path: string) {
    if (results.current) results.current.scrollTop = 0
    setDestination(path)
    setBuilding(true)
    setManagedId(null)
    setConfirmRemoval(false)
    setSigningIn(false)
    setMessage('')
  }

  async function enterAdminMode() {
    if (results.current) results.current.scrollTop = 0
    setSigningIn(true)
    setBuilding(false)
    setMessage('')
    const token = readPortalToken()
    if (!token) return
    setBusy(true)
    try {
      const session = await portalRequest<Omit<PortalSession, 'token'>>('/api/portal/session', { token })
      if (session.user.role === 'admin') {
        setAdminToken(token)
        setSigningIn(false)
      }
    } catch { /* A stopped server or expired session can be retried in the sign-in form. */ }
    finally { setBusy(false) }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setMessage('')
    try {
      const session = await portalRequest<PortalSession>('/api/portal/login', { method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) })
      if (session.user.role !== 'admin') throw new Error('An administrator account is required')
      setPortalToken(session.token)
      setAdminToken(session.token)
      setSigningIn(false)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  async function updateEntry(model: ModelDefinition, entry: ObjectCatalogueEntry) {
    setBusy(true)
    setMessage('')
    try {
      if (root === 'mine') onUpdatePersonal(model.id, entry)
      else if (adminToken) await onUpdatePublic(model.id, entry, adminToken)
      setManagedId(null)
      setConfirmRemoval(false)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  function renderModels(items: ModelDefinition[]) {
    return <div className="model-grid">{items.map(model => {
      const removed = catalogue[model.id]?.removed
      const editable = model.windowDesign || model.doorDesign || model.stairDesign || model.pictureFrameDesign || model.kitchenUnitDesign
      return <div className="model-option-wrap" key={model.id}>
        <button type="button" className="model-option" disabled={removed} onClick={() => onSelectModel(model.id)}>
          {model.previewUrl ? (
            <span className="model-option-preview-image"><img src={model.previewUrl} alt="" loading="lazy" /></span>
          ) : (
            <span className={`model-option-preview${model.shape === 'round' || model.shape === 'light' ? ' round' : ''}`}
              style={{ '--model-color': model.color, '--model-depth': model.depth, '--model-width': model.width } as CSSProperties} />
          )}
          <strong>{model.name}</strong>
          <span>{removed ? 'Removed from catalogue' : model.roofMount === 'dormer' ? 'Up-and-over / hip roofs' : getModelTypeLabel(model)}</span>
        </button>
        {root === 'mine' && editable && !removed && <button type="button" className="model-option-edit"
          onClick={() => onEdit(model)} aria-label={`Edit ${model.doorDesign ? 'door' : model.pictureFrameDesign ? 'frame' :
            model.kitchenUnitDesign ? 'unit' : model.stairDesign ? 'stair variety' : 'variety'} ${model.name}`}>Edit</button>}
        {canManage && <button type="button" className="model-option-edit" disabled={busy}
          aria-label={`Manage ${model.name}`} aria-pressed={model.id === managedId}
          onClick={() => {
            if (results.current) results.current.scrollTop = 0
            setManagedId(model.id)
            setDestination(getModelCatalogueFolder(model, catalogue[model.id]))
            setBuilding(false)
            setConfirmRemoval(false)
            setMessage('')
          }}>Manage</button>}
      </div>
    })}</div>
  }

  function renderFolder(node: Folder) {
    return <details key={node.path} className="model-selector-type" open>
      <summary>{node.name}</summary>
      <div className="object-browser-folder">
        {root === 'mine' && <button type="button" className="model-option-edit" disabled={busy}
          aria-label={`Build in ${node.path}`} onClick={() => beginBuild(node.path)}>+ Build here</button>}
        {node.models.length > 0 && renderModels(node.models)}
        {[...node.children.values()].sort(folderOrder).map(renderFolder)}
      </div>
    </details>
  }

  return <div className="modal-backdrop" role="presentation" onClick={() => { if (!busy) onClose() }}>
    <section className="model-selector" role="dialog" aria-modal="true" aria-labelledby="model-selector-title"
      onClick={event => event.stopPropagation()}>
      <header>
        <div><h2 id="model-selector-title">Object browser</h2>
          <p>{section === 'openings' ? 'Choose an opening, then click a compatible wall or roof.' : 'Choose an object to place it in the house.'}</p>
        </div>
        <div className="model-selector-actions">
          <button type="button" disabled={busy} onClick={onRefreshModels}>Refresh</button>
          <button type="button" disabled={busy} aria-label="Close model selector" onClick={onClose}>×</button>
        </div>
      </header>
      <div className="model-selector-controls">
        <div className="model-selector-library-row">
          <label>Library<select value={root} disabled={busy} onChange={event => changeLocation(event.currentTarget.value as ModelLibraryRoot, section)}>
            <option value="public">Public objects</option><option value="mine">My objects</option>
          </select></label>
          <div className="object-browser-actions">
            <button type="button" className="model-library-builder" disabled={busy} onClick={() => beginBuild(root === 'mine' ? folder : '')}>+ New object</button>
            {root === 'public' && (adminToken ? <>
              <button type="button" className="model-library-builder" disabled={busy} onClick={onOpenPublicUploads}>Upload public model</button>
              <button type="button" className="model-library-builder" disabled={busy} onClick={() => {
                setAdminToken(null); setManagedId(null); setShowRemoved(false)
              }}>Exit admin mode</button>
            </> : <button type="button" className="model-library-builder" disabled={busy} onClick={() => void enterAdminMode()}>Manage public catalogue</button>)}
          </div>
        </div>
        <div className="model-selector-nav">
          <nav className="model-selector-tabs" aria-label="Asset type">
            <button type="button" aria-pressed={section === 'objects'} disabled={busy} onClick={() => changeLocation(root, 'objects')}>Objects</button>
            <button type="button" aria-pressed={section === 'openings'} disabled={busy} onClick={() => changeLocation(root, 'openings')}>Windows &amp; doors</button>
          </nav>
          <nav className="model-selector-tabs" aria-label="Browse mode">
            <button type="button" aria-pressed={view === 'filter'} onClick={() => setView('filter')}>Filter</button>
            <button type="button" aria-pressed={view === 'hierarchy'} onClick={() => setView('hierarchy')}>Browse folders</button>
          </nav>
        </div>
      </div>
      <div className="model-selector-results" ref={results}>
        <datalist id={folderSuggestionsId}>{suggestedFolders.map(path => <option key={path} value={path} />)}</datalist>
        {message && <p role="alert">{message}</p>}
        {signingIn && <form className="object-browser-form" onSubmit={event => void signIn(event)}>
          <strong>Catalogue administrator</strong>
          <label>Email<input name="email" type="email" autoComplete="username" required disabled={busy} /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required disabled={busy} /></label>
          <div className="object-browser-actions">
            <button type="submit" disabled={busy}>Sign in</button>
            <button type="button" disabled={busy} onClick={() => { setSigningIn(false); setMessage('') }}>Cancel</button>
          </div>
        </form>}
        {building && <section className="object-browser-form" aria-label="Create an object">
          <label>Folder in My objects<input list={folderSuggestionsId} value={destination} maxLength={240}
            placeholder="Use the builder’s default folder" onChange={event => setDestination(event.currentTarget.value)} /></label>
          <div className="object-browser-actions">
            {objectBuilderOptions.filter(option => option.section === section).map(option => <button type="button" key={option.type}
              onClick={() => onBuild(option.type, normalizeObjectFolder(destination) || option.folder)}>{option.label}</button>)}
            <button type="button" onClick={() => setBuilding(false)}>Cancel</button>
          </div>
        </section>}
        {managed && <form className="object-browser-form" onSubmit={event => {
          event.preventDefault()
          void updateEntry(managed, { folder: normalizeObjectFolder(destination) })
        }}>
          <strong>{managed.name}</strong>
          {!confirmRemoval && <label>Catalogue folder<input list={folderSuggestionsId} value={destination} maxLength={240}
            disabled={busy} onChange={event => setDestination(event.currentTarget.value)} /></label>}
          {confirmRemoval && <p>Remove this object from the catalogue? Houses using it keep the model.</p>}
          <div className="object-browser-actions">
            {confirmRemoval ? <button type="button" disabled={busy} onClick={() => void updateEntry(managed, { removed: true })}>Confirm removal</button>
              : <>
                <button type="submit" disabled={busy}>Move to folder</button>
                {catalogue[managed.id]?.removed
                  ? <button type="button" disabled={busy} onClick={() => void updateEntry(managed, { removed: false })}>Restore to catalogue</button>
                  : <button type="button" disabled={busy} onClick={() => setConfirmRemoval(true)}>Remove from catalogue</button>}
              </>}
            <button type="button" disabled={busy} onClick={() => { setManagedId(null); setConfirmRemoval(false); setMessage('') }}>Cancel</button>
          </div>
        </form>}
        {(folder || canManage) && <div className="object-browser-actions object-browser-scope">
          {folder && <button type="button" className="model-option-edit" onClick={() => setFolder('')}>All folders</button>}
          {folder && <span>{folder.replaceAll('/', ' / ')}</span>}
          {canManage && <label><input type="checkbox" checked={showRemoved} onChange={event => setShowRemoved(event.currentTarget.checked)} /> Show removed</label>}
        </div>}
        {view === 'filter' && <div className="model-selector-filter">
          <form onSubmit={event => {
            event.preventDefault()
            if (!nextTag || tags.includes(nextTag)) return
            setTags([...tags, nextTag])
            setText('')
            tagInput.current?.focus()
          }}>
            <label htmlFor={tagInputId}>Tags</label>
            <input ref={tagInput} id={tagInputId} type="text" value={text}
              onChange={event => setText(event.currentTarget.value)} placeholder="e.g. sofa or oak" />
            <button type="submit" aria-label="Add tag" title="Add tag" disabled={!nextTag || tags.includes(nextTag)}>+</button>
          </form>
          {tags.length > 0 && <ul aria-label="Active tags" className="model-selector-tags">{tags.map(tag => <li key={tag}>
            <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => {
              setTags(tags.filter(item => item !== tag))
              tagInput.current?.focus()
            }}>{tag}<span aria-hidden="true">×</span></button>
          </li>)}</ul>}
        </div>}
        {!visibleModels.length ? <p className="model-selector-empty" role="status">
          {tags.length && view === 'filter' ? 'No objects match these tags.' : 'No objects in this part of the catalogue.'}
        </p> : view === 'filter' ? renderModels(visibleModels) : modelFolders(visibleModels, catalogue).map(renderFolder)}
      </div>
    </section>
  </div>
}
