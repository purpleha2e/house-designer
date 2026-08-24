import type { CSSProperties } from 'react'
import { modelLibrary } from '../models/modelLibrary'

type ModelSelectorProps = {
  onClose: () => void
  onRefreshModels: () => void
  onSelectModel: (modelId: string) => void
}

export function ModelSelector({
  onClose,
  onRefreshModels,
  onSelectModel,
}: ModelSelectorProps) {
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
            <h2 id="model-selector-title">Add Model</h2>
            <p>Choose a model to place on the active floor.</p>
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

        <div className="model-grid">
          {modelLibrary.map((model) => (
            <button
              key={model.id}
              type="button"
              className="model-option"
              onClick={() => onSelectModel(model.id)}
            >
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
              <strong>{model.name}</strong>
              <span>{model.category}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
