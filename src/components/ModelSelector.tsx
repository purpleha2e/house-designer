import { useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ModelDefinition } from '../models/modelLibrary'
import {
  getModelLibraryRoot,
  getModelLibrarySection,
  getModelTypeLabel,
  matchesModelTags,
  normalizeModelTag,
  type ModelLibraryRoot,
  type ModelLibrarySection,
} from '../models/modelLibrarySections'

type ModelSelectorProps = {
  initialRoot?: ModelLibraryRoot
  initialSection: ModelLibrarySection
  models: ModelDefinition[]
  onClose: () => void
  onRefreshModels: () => void
  onSelectModel: (modelId: string) => void
  onBuildWindow?: () => void
  onEditWindow?: (model: ModelDefinition) => void
  onBuildStairs?: () => void
  onEditStairs?: (model: ModelDefinition) => void
  onEditPictureFrame?: (model: ModelDefinition) => void
  onEditKitchenUnit?: (model: ModelDefinition) => void
}

export function ModelSelector({
  initialRoot = 'public',
  initialSection,
  models,
  onClose,
  onRefreshModels,
  onSelectModel,
  onBuildWindow,
  onEditWindow,
  onBuildStairs,
  onEditStairs,
  onEditPictureFrame,
  onEditKitchenUnit,
}: ModelSelectorProps) {
  const [root, setRoot] = useState<ModelLibraryRoot>(initialRoot)
  const [section, setSection] = useState<ModelLibrarySection>(initialSection)
  const [view, setView] = useState<'filter' | 'hierarchy'>('filter')
  const [text, setText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const tagInput = useRef<HTMLInputElement>(null)
  const tagInputId = useId()
  const nextTag = normalizeModelTag(text)
  const sectionModels = useMemo(
    () => models.filter(model => getModelLibraryRoot(model) === root && getModelLibrarySection(model) === section)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [models, root, section],
  )
  const filteredModels = useMemo(() => tags.length ? sectionModels.filter(model => matchesModelTags(model, tags)) : sectionModels, [sectionModels, tags])
  const groups = useMemo(() => {
    const byType = new Map<string, ModelDefinition[]>()
    for (const model of sectionModels) {
      const type = getModelTypeLabel(model)
      const group = byType.get(type) ?? []
      group.push(model)
      byType.set(type, group)
    }
    return [...byType].sort(([a], [b]) => a.localeCompare(b))
  }, [sectionModels])
  const renderModels = (items: ModelDefinition[]) => (
    <div className="model-grid">
      {items.map(model => (
        <div className="model-option-wrap" key={model.id}>
          <button type="button" className="model-option" onClick={() => onSelectModel(model.id)}>
            {model.previewUrl ? (
              <span className="model-option-preview-image"><img src={model.previewUrl} alt="" loading="lazy" /></span>
            ) : (
              <span className={`model-option-preview${model.shape === 'round' || model.shape === 'light' ? ' round' : ''}`}
                style={{ '--model-color': model.color, '--model-depth': model.depth, '--model-width': model.width } as CSSProperties} />
            )}
            <strong>{model.name}</strong>
            <span>{model.roofMount === 'dormer' ? 'Up-and-over / hip roofs' : getModelTypeLabel(model)}</span>
          </button>
          {model.windowDesign && onEditWindow && <button type="button" className="model-option-edit" onClick={() => onEditWindow(model)} aria-label={`Edit variety ${model.name}`}>Edit variety</button>}
          {model.stairDesign && onEditStairs && <button type="button" className="model-option-edit" onClick={() => onEditStairs(model)} aria-label={`Edit stair variety ${model.name}`}>Edit variety</button>}
          {model.pictureFrameDesign && onEditPictureFrame && <button type="button" className="model-option-edit"
            onClick={() => onEditPictureFrame(model)} aria-label={`Edit picture frame ${model.name}`}>Edit frame</button>}
          {model.kitchenUnitDesign && onEditKitchenUnit && <button type="button" className="model-option-edit"
            onClick={() => onEditKitchenUnit(model)} aria-label={`Edit kitchen unit ${model.name}`}>Edit unit</button>}
        </div>
      ))}
    </div>
  )
  const builder = section === 'objects' ? onBuildStairs : onBuildWindow
  const empty = view === 'filter' && tags.length ? 'No models match all of these tags.' : root === 'mine'
    ? (section === 'objects' ? 'No saved objects yet.' : 'No saved window varieties yet.')
    : 'No models are available in this library.'

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="model-selector"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-selector-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="model-selector-title">
              {section === 'openings' ? 'Add an opening' : 'Add an object'}
            </h2>
            <p>
              {section === 'openings'
                ? 'Choose a window or door, then click a compatible wall or roof in the 2D or 3D view.'
                : 'Choose an object to place on the active floor.'}
            </p>
          </div>
          <div className="model-selector-actions">
            <button type="button" onClick={onRefreshModels}>
              Refresh
            </button>
            <button type="button" aria-label="Close model selector" onClick={onClose}>
              x
            </button>
          </div>
        </header>

        <div className="model-selector-controls">
          <div className="model-selector-library-row">
            <label>Library
              <select value={root} onChange={event => setRoot(event.currentTarget.value === 'mine' ? 'mine' : 'public')}>
                <option value="public">Public objects</option>
                <option value="mine">My objects</option>
              </select>
            </label>
            {builder && <button type="button" className="model-library-builder" onClick={builder}>{section === 'objects' ? 'Build stairs' : 'Build a window'}</button>}
          </div>
          <div className="model-selector-nav">
            <nav className="model-selector-tabs" aria-label="Asset type">
              <button type="button" aria-pressed={section === 'objects'} onClick={() => setSection('objects')}>Objects</button>
              <button type="button" aria-pressed={section === 'openings'} onClick={() => setSection('openings')}>Windows &amp; doors</button>
            </nav>
            <nav className="model-selector-tabs" aria-label="Browse mode">
              <button type="button" aria-pressed={view === 'filter'} onClick={() => setView('filter')}>Filter</button>
              <button type="button" aria-pressed={view === 'hierarchy'} onClick={() => setView('hierarchy')}>Browse by type</button>
            </nav>
          </div>
        </div>

        <div className="model-selector-results">
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
            {tags.length > 0 && <ul aria-label="Active tags" className="model-selector-tags">
              {tags.map(tag => <li key={tag}>
                <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => {
                  setTags(tags.filter(item => item !== tag))
                  tagInput.current?.focus()
                }}>{tag}<span aria-hidden="true">×</span></button>
              </li>)}
            </ul>}
          </div>}
          {(view === 'filter' ? filteredModels.length : sectionModels.length) === 0
            ? <p className="model-selector-empty" role="status">{empty}</p>
            : view === 'filter' ? renderModels(filteredModels)
              : groups.map(([type, items]) => <details key={`${root}-${section}-${type}`} className="model-selector-type" open>
                <summary>{type} <span>{items.length}</span></summary>
                {renderModels(items)}
              </details>)}
        </div>
      </section>
    </div>
  )
}
