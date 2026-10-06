import { useMemo, useState, type CSSProperties } from 'react'
import type { ModelDefinition } from '../models/modelLibrary'
import {
  getModelLibrarySection,
  type ModelLibrarySection,
} from '../models/modelLibrarySections'

type ModelSelectorProps = {
  initialSection: ModelLibrarySection
  models: ModelDefinition[]
  onClose: () => void
  onRefreshModels: () => void
  onSelectModel: (modelId: string) => void
  onBuildWindow?: () => void
  onEditWindow?: (model: ModelDefinition) => void
}

export function ModelSelector({
  initialSection,
  models,
  onClose,
  onRefreshModels,
  onSelectModel,
  onBuildWindow,
  onEditWindow,
}: ModelSelectorProps) {
  const [section, setSection] = useState<ModelLibrarySection>(initialSection)
  const sectionModels = useMemo(
    () => models.filter((model) => getModelLibrarySection(model) === section),
    [models, section],
  )

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

        <nav className="model-selector-tabs" aria-label="Asset type">
          <button
            type="button"
            className={section === 'openings' ? 'active' : ''}
            aria-pressed={section === 'openings'}
            onClick={() => setSection('openings')}
          >
            Windows &amp; doors
          </button>
          <button
            type="button"
            className={section === 'objects' ? 'active' : ''}
            aria-pressed={section === 'objects'}
            onClick={() => setSection('objects')}
          >
            Objects
          </button>
        </nav>

        <div className="model-grid">
          {section === 'openings' && onBuildWindow ? <button type="button" className="model-option" onClick={onBuildWindow}>
            <span className="model-option-preview">＋</span><strong>Build a window</strong><span>Design panes, sizes and openings</span>
          </button> : null}
          {sectionModels.map((model) => (
            <div className="model-option-wrap" key={model.id}>
            <button
              key={model.id}
              type="button"
              className="model-option"
              onClick={() => onSelectModel(model.id)}
            >
              {model.previewUrl ? (
                <span className="model-option-preview-image">
                  <img src={model.previewUrl} alt="" loading="lazy" />
                </span>
              ) : (
                <span
                  className={
                    model.shape === 'round' || model.shape === 'light'
                      ? 'model-option-preview round'
                      : 'model-option-preview'
                  }
                  style={{
                    '--model-color': model.color,
                    '--model-depth': model.depth,
                    '--model-width': model.width,
                  } as CSSProperties}
                />
              )}
              <strong>{model.name}</strong>
              <span>
                {section === 'openings'
                  ? model.roofMount === 'dormer'
                    ? 'Up-and-over / hip roofs'
                    : model.windowDesign ? 'My windows · Click to position' : 'Click to position'
                  : model.category}
              </span>
            </button>
            {model.windowDesign && onEditWindow ? <button type="button" onClick={() => onEditWindow(model)} aria-label={`Edit variety ${model.name}`}>Edit variety</button> : null}
            </div>
          ))}
          {sectionModels.length === 0 ? (
            <p className="model-selector-empty">
              No {section === 'openings' ? 'windows or doors' : 'objects'} are available.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  )
}
