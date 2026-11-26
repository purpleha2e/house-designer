import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { ModelDefinition } from '../models/modelLibrary'
import { createPictureFrameDesign, getPictureFrameSize, pictureFrameDefinition, validatePictureFrameDesign } from '../pictureFrameDesign'
import { BuilderDialog } from './ObjectBuilder'
import { PictureFrameMesh } from './PictureFrameMesh'

const pictureRatios = [
  { label: 'Square 1:1', value: 1 },
  { label: 'Landscape 4:3', value: 4 / 3 },
  { label: 'Landscape 3:2', value: 3 / 2 },
  { label: 'Landscape 16:9', value: 16 / 9 },
  { label: 'Portrait 3:4', value: 3 / 4 },
  { label: 'Portrait 2:3', value: 2 / 3 },
]

const dimensions = [
  { key: 'openingWidth', label: 'Picture width', min: 50, max: 3000 },
  { key: 'openingHeight', label: 'Picture height', min: 50, max: 3000 },
  { key: 'frameWidth', label: 'Frame face width', min: 3, max: 250 },
  { key: 'frameDepth', label: 'Frame thickness', min: 3, max: 200 },
  { key: 'slipWidth', label: 'Slip face width', min: 0, max: 100 },
  { key: 'slipDepth', label: 'Slip thickness', min: 1, max: 200 },
] as const

function matchRatio(width: number, height: number) {
  return pictureRatios.find(option => Math.abs(width / height - option.value) < .001)?.value ?? 0
}

export function PictureFrameBuilder({ definition, onClose, onSave }: {
  definition: ModelDefinition | null
  onClose: () => void
  onSave: (definition: ModelDefinition, place: boolean) => Promise<void>
}) {
  const [design, setDesign] = useState(() => definition?.pictureFrameDesign ?? createPictureFrameDesign())
  const [name, setName] = useState(definition?.name ?? 'My picture frame')
  const [measureOutside, setMeasureOutside] = useState(false)
  const [ratio, setRatio] = useState(() => matchRatio(design.openingWidth, design.openingHeight))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const validation = validatePictureFrameDesign(design)
  const size = getPictureFrameSize(design)
  const extent = Math.max(size.width, size.height)
  const focusScale = .75 / Math.max(extent, .05)
  const millimetres = (value: number) => Number((value * 1000).toFixed(1))
  const border = measureOutside ? 2 * (design.frameWidth + design.slipWidth) : 0

  function updateDimension(key: typeof dimensions[number]['key'], value: number, aspectRatio = ratio) {
    setError('')
    const next = { ...design }
    if (key === 'openingWidth' || key === 'openingHeight') {
      next[key] = value - border
      if (aspectRatio && key === 'openingWidth') next.openingHeight = value / aspectRatio - border
      if (aspectRatio && key === 'openingHeight') next.openingWidth = value * aspectRatio - border
    } else {
      next[key] = value
      if (measureOutside && (key === 'frameWidth' || key === 'slipWidth')) {
        const change = 2 * (design[key] - value)
        next.openingWidth += change
        next.openingHeight += change
      }
    }
    setDesign(next)
  }

  async function save(place: boolean) {
    if (validation || !name.trim()) return
    setBusy(true)
    setError('')
    try {
      const id = definition?.id ?? `custom-picture-frame-${crypto.randomUUID()}`
      await onSave(pictureFrameDefinition(id, name, design), place)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the picture frame.')
      setBusy(false)
    }
  }

  return <BuilderDialog title={definition ? 'Edit picture frame' : 'Build a picture frame'} onClose={onClose} expanded busy={busy}>
    <div className="object-builder-body">
      <fieldset className="object-builder-settings" disabled={busy}>
        <label>Frame name<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
        <div className="object-builder-fields">
          <label>Size measured at<select value={measureOutside ? 'outside' : 'picture'} onChange={event => {
            const outside = event.target.value === 'outside'
            setMeasureOutside(outside)
            setRatio(outside ? matchRatio(size.width, size.height) : matchRatio(design.openingWidth, design.openingHeight))
          }}>
            <option value="picture">Picture opening</option>
            <option value="outside">Outside of frame</option>
          </select></label>
          <label>{measureOutside ? 'Overall aspect ratio' : 'Picture aspect ratio'}
            <select value={ratio} onChange={event => {
              const next = Number(event.target.value)
              setRatio(next)
              setError('')
              if (next) updateDimension('openingHeight', (design.openingWidth + border) / next, next)
            }}>
              <option value={0}>Custom</option>
              {pictureRatios.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <div className="object-builder-fields">
          {dimensions.map(({ key, label, min, max }) => {
            const sizeField = key === 'openingWidth' || key === 'openingHeight'
            const adjustment = sizeField ? border : 0
            const fieldLabel = measureOutside && sizeField ? label.replace('Picture', 'Overall') : label
            return <label key={key}>{fieldLabel} (mm)
              <input type="number" min={min + millimetres(adjustment)}
                max={key === 'slipDepth' && design.slipWidth > 0 ? millimetres(design.frameDepth) : max + millimetres(adjustment)}
                step="0.1" value={millimetres(design[key] + adjustment)} disabled={key === 'slipDepth' && design.slipWidth === 0}
                onChange={event => updateDimension(key, Number(event.target.value) / 1000)} />
            </label>
          })}
          <label>Frame colour<input type="color" value={design.frameColor}
            onChange={event => setDesign(current => ({ ...current, frameColor: event.target.value }))} /></label>
          <label>Slip colour<input type="color" value={design.slipColor} disabled={design.slipWidth === 0}
            onChange={event => setDesign(current => ({ ...current, slipColor: event.target.value }))} /></label>
        </div>
        <p>Set the slip face width to 0 to remove it. Assign the picture to Image material in Properties after placing.</p>
      </fieldset>
      <div className="object-builder-preview">
        <div className="object-builder-viewport" aria-label="Picture frame 3D preview">
          {!validation && <Canvas camera={{ position: [.58, .34, 1.3], fov: 43 }} frameloop="demand">
            <color attach="background" args={['#eff3f5']} />
            <ambientLight intensity={1.4} />
            <directionalLight position={[2, 4, 5]} intensity={2.2} />
            <group scale={focusScale}>
              <group position={[0, -size.height / 2, 0]}><PictureFrameMesh design={design} /></group>
            </group>
            <OrbitControls makeDefault enablePan={false} />
          </Canvas>}
        </div>
        {!validation && <p>Overall {millimetres(size.width)} × {millimetres(size.height)} × {millimetres(size.depth)} mm</p>}
      </div>
    </div>
    <footer className="object-builder-footer">
      <div role="status">{error || validation || (busy ? 'Saving picture frame…' : '')}</div>
      <button type="button" disabled={busy || !!validation || !name.trim()} onClick={() => void save(false)}>
        {definition ? 'Save changes' : 'Save to My objects'}
      </button>
      <button type="button" className="object-builder-primary" disabled={busy || !!validation || !name.trim()}
        onClick={() => void save(true)}>Save &amp; place</button>
    </footer>
  </BuilderDialog>
}
