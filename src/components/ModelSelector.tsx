import type { CSSProperties } from 'react'
import { modelLibrary } from '../models/modelLibrary'

type ModelSelectorProps = {
  onClose: () => void
  onSelectModel: (modelId: string) => void
}

export function ModelSelector({ onClose, onSelectModel }: ModelSelectorProps) {
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
          <button type="button" aria-label="Close model selector" onClick={onClose}>
            x
          </button>
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
                  model.shape === 'round'
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
