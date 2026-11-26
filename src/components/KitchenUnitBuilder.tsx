import { useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { ModelDefinition } from '../models/modelLibrary'
import type { SurfaceMaterialProduct } from '../types'
import { copyKitchenUnitStyle, createKitchenUnitDesign, getKitchenUnitConstruction, getKitchenUnitDimensions, getKitchenUnitLayouts,
  getKitchenUnitMaterialRegions, getKitchenUnitSize, kitchenDoorStyles, kitchenHandleFinishes, kitchenHandleStyles, kitchenUnitDefinition, kitchenUnitLayouts, kitchenUnitTypes,
  validateKitchenUnitDesign, type KitchenUnitDesign, type KitchenUnitType } from '../kitchenUnitDesign'
import { BuilderDialog } from './ObjectBuilder'
import { KitchenUnitMesh } from './KitchenUnitMesh'
import { MaterialChoice } from './MaterialChoice'
import { ParametricModelMaterials } from './ThreeDView'
import { PbrEnvironmentProvider } from './PbrEnvironment'

const colours = [
  { key: 'frontColor', label: 'Front colour' },
  { key: 'cabinetColor', label: 'Cabinet colour' },
  { key: 'plinthColor', label: 'Plinth colour' },
  { key: 'worktopColor', label: 'Worktop colour' },
] as const

function KitchenUnitPreview({ design }: { design: KitchenUnitDesign }) {
  const { width, depth, height } = getKitchenUnitSize(design)
  const aspect = useThree(state => state.size.width / Math.max(1, state.size.height))
  const scale = .73 * Math.min(1, aspect / .86) / Math.max(width, depth, height)
  const worktop = design.worktopMaterialId
  return <group scale={scale}><group position={[0, -height / 2, -depth / 2]}>
    <KitchenUnitMesh design={design}>
      {root => <ParametricModelMaterials root={root} regions={getKitchenUnitMaterialRegions(design)}
        materials={worktop ? { hd_worktop: worktop } : undefined} />}
    </KitchenUnitMesh>
  </group></group>
}

export function KitchenUnitBuilder({ definition, materials, models, onClose, onSave }: {
  definition: ModelDefinition | null
  materials: SurfaceMaterialProduct[]
  models: ModelDefinition[]
  onClose: () => void
  onSave: (definition: ModelDefinition, place: boolean) => Promise<void>
}) {
  const [design, setDesign] = useState(() => definition?.kitchenUnitDesign ?? createKitchenUnitDesign())
  const [name, setName] = useState(definition?.name ?? 'My kitchen unit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const validation = validateKitchenUnitDesign(design)
  const size = getKitchenUnitSize(design)
  const mm = (value: number) => Math.round(value * 1000)
  const worktop = design.worktopMaterialId
  const unitType = design.unitType ?? 'base'
  const baseUnit = unitType === 'base'
  const layouts = getKitchenUnitLayouts(unitType)
  const { plinthHeight, worktopThickness } = getKitchenUnitConstruction(design)
  const hasWorktop = worktopThickness > 0
  const hasPlinth = plinthHeight > 0
  const changingType = definition && (definition.kitchenUnitDesign?.unitType ?? 'base') !== unitType
  const styleSources = models
    .filter(model => model.kitchenUnitDesign && model.id !== definition?.id)
    .sort((first, second) => first.name.localeCompare(second.name))

  function update<Key extends keyof KitchenUnitDesign>(key: Key, value: KitchenUnitDesign[Key]) {
    setDesign(current => ({ ...current, [key]: value }))
    setError('')
  }

  function changeUnitType(nextType: KitchenUnitType) {
    const previous = createKitchenUnitDesign(unitType)
    const next = createKitchenUnitDesign(nextType)
    setDesign(current => ({ ...current, unitType: nextType,
      layout: getKitchenUnitLayouts(nextType).includes(current.layout) ? current.layout : next.layout,
      depth: current.depth === previous.depth ? next.depth : current.depth,
      height: current.height === previous.height ? next.height : current.height,
    }))
    setError('')
  }

  async function save(place: boolean) {
    if (validation || !name.trim()) return
    setBusy(true)
    setError('')
    try {
      const id = definition && !changingType ? definition.id : `custom-kitchen-unit-${crypto.randomUUID()}`
      await onSave(kitchenUnitDefinition(id, name, design), place)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the kitchen unit.')
      setBusy(false)
    }
  }

  return <BuilderDialog title={definition ? 'Edit kitchen unit' : 'Build a kitchen unit'} onClose={onClose} expanded busy={busy}>
    <div className="object-builder-body">
      <fieldset className="object-builder-settings" disabled={busy}>
        <label>Unit name<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
        <label>Unit type<select value={unitType} onChange={event => changeUnitType(event.target.value as KitchenUnitType)}>
          {Object.entries(kitchenUnitTypes).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        {changingType && <p>Changing the unit type saves a new unit.</p>}
        <label>Copy style<select value="" disabled={!styleSources.length} onChange={event => {
          const source = styleSources.find(model => model.id === event.target.value)?.kitchenUnitDesign
          if (source) {
            setDesign(current => copyKitchenUnitStyle(current, source))
            setError('')
          }
        }}>
          <option value="" disabled>{styleSources.length ? 'Choose a saved kitchen unit' : 'No other saved kitchen units'}</option>
          {styleSources.map(model => <option key={model.id} value={model.id}>
            {model.name} ({kitchenUnitTypes[model.kitchenUnitDesign?.unitType ?? 'base']})
          </option>)}
        </select></label>
        <div className="object-builder-fields">
          <label>Front layout<select value={design.layout} onChange={event => update('layout', event.target.value as KitchenUnitDesign['layout'])}>
            {!layouts.includes(design.layout) && <option value={design.layout} disabled>{kitchenUnitLayouts[design.layout]} (existing)</option>}
            {layouts.map(id => <option key={id} value={id}>{kitchenUnitLayouts[id]}</option>)}
          </select></label>
          {design.layout !== 'glass-front' && <label>Door style<select value={design.doorStyle} onChange={event => update('doorStyle', event.target.value as KitchenUnitDesign['doorStyle'])}>
            {Object.entries(kitchenDoorStyles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>}
          <label>Handles<select value={design.handleStyle} onChange={event => update('handleStyle', event.target.value as KitchenUnitDesign['handleStyle'])}>
            {Object.entries(kitchenHandleStyles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <label>Handle finish<select value={design.handleFinish ?? 'bronze'} disabled={design.handleStyle === 'none'}
            onChange={event => update('handleFinish', event.target.value as KitchenUnitDesign['handleFinish'])}>
            {Object.entries(kitchenHandleFinishes).map(([id, finish]) => <option key={id} value={id}>{finish.label}</option>)}
          </select></label>
        </div>
        <div className="object-builder-fields">
          {getKitchenUnitDimensions(unitType).map(({ key, label, min, max }) => <label key={key}>{label} (mm)
            <input type="number" min={mm(min)} max={mm(max)} step="1" value={mm(design[key])}
              disabled={((key === 'frontOverhang' || key === 'sideOverhang') && !hasWorktop) || (key === 'plinthInset' && !hasPlinth)}
              onChange={event => update(key, Number(event.target.value) / 1000)} />
          </label>)}
          {baseUnit && <label>Front roll radius (mm)
            <input type="number" min={0} max={mm(design.worktopThickness)} step="1"
              value={mm(design.frontRollRadius ?? 0)} disabled={!hasWorktop}
              title="Rounds the upper front edge. Use 0 for a square edge."
              onChange={event => update('frontRollRadius', Number(event.target.value) / 1000)} />
          </label>}
          {(baseUnit ? colours : colours.slice(0, 2)).map(({ key, label }) => <label key={key}>{label}
            <input type="color" value={design[key]} disabled={(key === 'plinthColor' && !hasPlinth) || (key === 'worktopColor' && (!hasWorktop || !!worktop))}
              onChange={event => update(key, event.target.value)} />
          </label>)}
        </div>
        {hasWorktop && <div className="object-builder-material"><span>Worktop material</span>
          <MaterialChoice label="Worktop" value={worktop ?? ''} materials={materials}
            original={{ color: design.worktopColor, label: 'Worktop colour' }}
            onChange={id => update('worktopMaterialId', id || undefined)} />
        </div>}
        <p>{baseUnit
          ? 'Overall height includes the plinth and worktop. Set plinth height or worktop thickness to 0 to omit that part.'
          : 'Place the unit on a wall, then drag it up or down in 3D or set Height above floor in Properties.'}</p>
      </fieldset>
      <div className="object-builder-preview">
        <div className="object-builder-viewport" aria-label="Kitchen unit 3D preview">
          {!validation && <Canvas camera={{ position: [.8, .63, 1.45], fov: 43 }} frameloop="demand">
            <color attach="background" args={['#eff3f5']} />
            <ambientLight intensity={1.3} />
            <directionalLight position={[2, 4, 5]} intensity={2.3} />
            <PbrEnvironmentProvider intensity={.48}>
              <KitchenUnitPreview design={design} />
            </PbrEnvironmentProvider>
            <OrbitControls makeDefault enablePan={false} />
          </Canvas>}
        </div>
        {!validation && <p>Overall {mm(size.width)} × {mm(size.depth)} × {mm(size.height)} mm</p>}
      </div>
    </div>
    <footer className="object-builder-footer">
      <div role="status">{error || validation || (busy ? 'Saving kitchen unit…' : '')}</div>
      <button type="button" disabled={busy || !!validation || !name.trim()} onClick={() => void save(false)}>
        {changingType ? 'Save as new unit' : definition ? 'Save changes' : 'Save to My objects'}
      </button>
      <button type="button" className="object-builder-primary" disabled={busy || !!validation || !name.trim()}
        onClick={() => void save(true)}>Save &amp; place</button>
    </footer>
  </BuilderDialog>
}
