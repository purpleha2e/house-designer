import { useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { createDoorDesign, DEFAULT_DOOR_GROOVE_COLOR, DOOR_CASING_WIDTH, doorDefinition, doorDimensionFields, doorFrameProfiles, doorMaterialRegions,
  doorPanelDetails, doorPresetPanels, doorStyles, doorTextureScale, getDoorHandleHeight, getDoorHandleHeightBounds, getDoorMaterialIds, getDoorOpeningSize,
  getDoorPanelTextureValue, spaceDoorPanels, validateDoorDesign, type DoorDesign, type DoorFrameProfile, type DoorPanel, type DoorPanelDetail } from '../doorDesign'
import { kitchenHandleFinishes } from '../kitchenUnitDesign'
import type { ModelDefinition } from '../models/modelLibrary'
import type { MaterialTextureTransform, SurfaceMaterialProduct } from '../types'
import { normalizeTextureRotation } from '../modelMaterialOverrides'
import { BuilderDialog } from './ObjectBuilder'
import { MaterialChoice } from './MaterialChoice'
import { DoorMesh } from './DoorMesh'
import { ParametricModelMaterials } from './ThreeDView'
import { PbrEnvironmentProvider } from './PbrEnvironment'

const widths = [610, 686, 762, 838]
const mm = (value: number) => Math.round(value * 1000)
const panelFields = [{ key: 'left', label: 'From left', axis: 'width' }, { key: 'bottom', label: 'From bottom', axis: 'height' },
  { key: 'width', label: 'Panel width', axis: 'width' }, { key: 'height', label: 'Panel height', axis: 'height' }] as const
const textureSections = [{ key: 'leafTexture', label: 'Main leaf' }, { key: 'panelTexture', label: 'All panels' }] as const

function DoorPreview({ design, wall, open }: { design: DoorDesign; wall: number; open: boolean }) {
  const { width, height } = getDoorOpeningSize(design)
  const aspect = useThree(state => state.size.width / Math.max(1, state.size.height))
  const scale = Math.min(.86 / (height + DOOR_CASING_WIDTH), .84 * aspect / (width + DOOR_CASING_WIDTH * 2))
  return <group scale={scale}><group position={[0, -(height + DOOR_CASING_WIDTH) / 2, 0]}>
    <DoorMesh design={design} wallThickness={wall} angles={open ? [52, 28] : [0, 0]}>
      {root => <ParametricModelMaterials root={root} regions={doorMaterialRegions}
        materials={getDoorMaterialIds(design)} />}
    </DoorMesh>
  </group></group>
}

export function DoorBuilder({ definition, materials, onClose, onSave }: {
  definition: ModelDefinition | null; materials: SurfaceMaterialProduct[]; onClose: () => void
  onSave: (definition: ModelDefinition, place: boolean) => Promise<void>
}) {
  const [design, setDesign] = useState(() => definition?.doorDesign ?? createDoorDesign())
  const [name, setName] = useState(definition?.name ?? 'Light oak door')
  const [wall, setWall] = useState(.1)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const validation = validateDoorDesign(design)
  const opening = getDoorOpeningSize(design)
  const panel = design.panels[selected]
  const frameFinish = getDoorMaterialIds(design).hd_frame
  const handleHeightBounds = getDoorHandleHeightBounds(design)

  function update(changes: Partial<DoorDesign>) {
    setDesign(current => ({ ...current, ...changes }))
    setError('')
  }

  function addPanel() {
    const panels = [...design.panels, doorPresetPanels(design.style)[0]]
    update({ panels: spaceDoorPanels(design, panels) })
    setSelected(panels.length - 1)
  }

  function updatePanel(changes: Partial<DoorPanel>) {
    update({ panels: design.panels.map((part, index) => index === selected ? { ...part, ...changes } : part) })
  }

  async function save(place: boolean) {
    if (validation || !name.trim()) return
    setBusy(true)
    setError('')
    try { await onSave(doorDefinition(definition?.id ?? `custom-door-${crypto.randomUUID()}`, name, design), place) }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the door.')
      setBusy(false)
    }
  }

  return <BuilderDialog title={definition ? 'Edit door' : 'Build an oak door'} onClose={onClose} expanded busy={busy}>
    <div className="object-builder-body">
      <fieldset className="object-builder-settings" disabled={busy}>
        <label>Door name<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
        <div className="object-builder-fields">
          <label>Style<select value={design.style} onChange={event => {
            const style = event.target.value as DoorDesign['style']
            update({ style, panels: doorPresetPanels(style) }); setSelected(0)
          }}>{Object.entries(doorStyles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          {design.style === 'raised' && <label>Panel detail<select value={design.panelDetail ?? 'simple'}
            onChange={event => update({ panelDetail: event.target.value as DoorPanelDetail })}>
            {Object.entries(doorPanelDetails).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>}
          <label>Leaves<select value={design.leafCount} onChange={event => update({ leafCount: event.target.value === '2' ? 2 : 1 })}>
            <option value={1}>Single</option><option value={2}>Double</option>
          </select></label>
          <label>Swing direction<select value={design.swing} onChange={event => update({ swing: event.target.value as DoorDesign['swing'] })}>
            <option value="front">Toward front</option><option value="back">Toward back</option>
          </select></label>
          {design.leafCount === 1 && <label>Hinge side (front view)<select value={design.handing} onChange={event => update({ handing: event.target.value as DoorDesign['handing'] })}>
            <option value="left">Left</option><option value="right">Right</option>
          </select></label>}
        </div>
        <label>Leaf width <output>{mm(design.width)} mm</output>
          <input type="range" aria-label="Leaf width" min={610} max={838} step={1} value={mm(design.width)}
            onChange={event => update({ width: Number(event.target.value) / 1000 })} />
        </label>
        <div className="door-width-options" role="group" aria-label="Standard leaf widths">
          {widths.map(width => <button type="button" key={width} aria-pressed={mm(design.width) === width}
            onClick={() => update({ width: width / 1000 })}>{width} mm</button>)}
        </div>
        <div className="object-builder-fields">
          {doorDimensionFields.filter(field => field.key !== 'width').map(({ key, label, min, max }) => <label key={key}>{label} (mm)
            <input type="number" min={mm(min)} max={mm(max)} value={mm(design[key])} step={1}
              onChange={event => update({ [key]: Number(event.target.value) / 1000 })} />
          </label>)}
          <label>Preview wall thickness<select value={wall} onChange={event => setWall(Number(event.target.value))}>
            <option value={.1}>100 mm</option><option value={.15}>150 mm</option>
          </select></label>
          <label>Frame profile<select value={design.frameProfile ?? 'plain'} onChange={event => update({ frameProfile: event.target.value as DoorFrameProfile })}>
            {Object.entries(doorFrameProfiles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <label>Handle finish<select value={design.handleFinish} onChange={event => update({ handleFinish: event.target.value as DoorDesign['handleFinish'] })}>
            {Object.entries(kitchenHandleFinishes).map(([id, finish]) => <option key={id} value={id}>{finish.label}</option>)}
          </select></label>
          <label>Handle height from floor (mm)<input type="number" min={mm(handleHeightBounds.min)} max={mm(handleHeightBounds.max)}
            step={1} value={mm(getDoorHandleHeight(design))} onChange={event => update({ handleHeight: Number(event.target.value) / 1000 })} /></label>
        </div>
        <div className="object-builder-material"><span>Oak finish</span>
          <MaterialChoice label="Oak" value={design.oakMaterialId ?? ''} materials={materials}
            original={{ label: 'Natural oak grain', color: '#c99e68' }} onChange={id => update({ oakMaterialId: id || undefined })} />
        </div>
        {design.style !== 'raised' && <label>Plank groove colour
          <input type="color" value={design.grooveColor ?? DEFAULT_DOOR_GROOVE_COLOR} onChange={event => update({ grooveColor: event.target.value })} />
        </label>}
        <div className="object-builder-material"><span>Frame finish</span>
          <MaterialChoice label="Frame" value={design.frameMaterialId ?? ''} materials={materials}
            original={{ label: design.frameMaterialId === null ? 'Natural oak grain' : 'Match leaf finish', color: '#c99e68',
              materialId: design.frameMaterialId === null ? undefined : design.oakMaterialId }}
            onChange={id => update({ frameMaterialId: id || undefined })} />
          {frameFinish &&
            <button type="button" onClick={() => update({ frameMaterialId: null })}>Use natural oak for frame</button>}
        </div>
        {textureSections.map(({ key, label }) => {
          const scale = key === 'leafTexture' ? design.leafTexture?.textureScale ?? 1 : getDoorPanelTextureValue(design, 'textureScale')
          const rotation = key === 'leafTexture' ? design.leafTexture?.textureRotation ?? 0 : getDoorPanelTextureValue(design, 'textureRotation')
          const updateTexture = (changes: MaterialTextureTransform) => update({ [key]: { ...design[key], ...changes } })
          return <div key={key} className="object-builder-material" role="group" aria-label={`${label} texture`}>
            <span>{label} texture</span>
            <div className="object-builder-fields">
              <label>Scale (×)<input aria-label={`${label} texture scale`} type="number" min={doorTextureScale.min} max={doorTextureScale.max}
                step={.1} value={scale ?? ''} placeholder={scale === undefined ? 'Mixed' : undefined} onChange={event => {
                  if (Number.isFinite(event.target.valueAsNumber)) updateTexture({ textureScale: event.target.valueAsNumber })
                }} /></label>
              <label>Orientation (°)<input aria-label={`${label} texture orientation`} type="number" step={1}
                value={rotation ?? ''} placeholder={rotation === undefined ? 'Mixed' : undefined} onChange={event => {
                  if (Number.isFinite(event.target.valueAsNumber)) updateTexture({ textureRotation: event.target.valueAsNumber })
                }} onBlur={() => {
                  const value = design[key]?.textureRotation
                  if (value !== undefined && normalizeTextureRotation(value) !== value) updateTexture({ textureRotation: normalizeTextureRotation(value) })
                }} /></label>
            </div>
          </div>
        })}
        <div className="door-panel-editor">
          <div className="door-panel-toolbar"><strong>Panels per leaf</strong>
            <button type="button" disabled={design.panels.length >= 16} onClick={addPanel}>Add panel</button>
          </div>
          <div className="door-panel-controls">
            <div className="door-panel-diagram" aria-label="Leaf panel layout">
              {design.panels.map((part, index) => <button type="button" key={index} aria-label={`Panel ${index + 1}`}
                aria-pressed={index === selected} onClick={() => setSelected(index)} style={{ left: `${part.left * 100}%`,
                  bottom: `${part.bottom * 100}%`, width: `${part.width * 100}%`, height: `${part.height * 100}%` }} />)}
            </div>
            {panel && <div className="door-panel-fields">
              <label>Selected panel<select value={selected} onChange={event => setSelected(Number(event.target.value))}>
                {design.panels.map((_, index) => <option key={index} value={index}>Panel {index + 1}</option>)}
              </select></label>
              <div className="object-builder-fields">
                {panelFields.map(({ key, label, axis }) => <label key={key}>{label} (mm)
                  <input type="number" min={0} max={mm(design[axis])} value={mm(panel[key] * design[axis])}
                    onChange={event => {
                      const value = Number(event.target.value) / 1000 / design[axis]
                      updatePanel({ [key]: value })
                    }} />
                </label>)}
              </div>
              <button type="button" onClick={() => {
                const panels = design.panels.filter((_, index) => index !== selected)
                update({ panels: spaceDoorPanels(design, panels) }); setSelected(Math.max(0, Math.min(selected, panels.length - 1)))
              }}>Remove panel</button>
            </div>}
          </div>
        </div>
      </fieldset>
      <div className="object-builder-preview door-builder-preview">
        <div className="object-builder-viewport" aria-label="Door 3D preview">
          {!validation && <Canvas camera={{ position: [.32, .17, 1.43], fov: 42 }} frameloop="demand">
            <color attach="background" args={['#edf2f5']} />
            <ambientLight intensity={1.05} />
            <directionalLight position={[2, 4, 4]} intensity={2.15} />
            <PbrEnvironmentProvider intensity={.48}><DoorPreview design={design} wall={wall} open={open} /></PbrEnvironmentProvider>
            <OrbitControls makeDefault enablePan={false} />
          </Canvas>}
        </div>
        <div className="door-preview-controls">
          <button type="button" aria-pressed={open} onClick={() => setOpen(current => !current)}>{open ? 'Preview closed' : 'Preview open'}</button>
          <p>Wall cutout {mm(opening.width)} × {mm(opening.height)} mm</p>
        </div>
      </div>
    </div>
    <footer className="object-builder-footer">
      <div role="status">{error || validation || (busy ? 'Saving door…' : '')}</div>
      <button type="button" disabled={busy || !!validation || !name.trim()} onClick={() => void save(false)}>
        {definition ? 'Save changes' : 'Save to My openings'}</button>
      <button type="button" className="object-builder-primary" disabled={busy || !!validation || !name.trim()}
        onClick={() => void save(true)}>Save &amp; place</button>
    </footer>
  </BuilderDialog>
}
