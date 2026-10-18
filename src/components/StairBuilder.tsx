import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bounds, OrbitControls } from '@react-three/drei'
import type { Object3D } from 'three'
import type { ModelDefinition } from '../models/modelLibrary'
import type { SurfaceMaterialProduct } from '../types'
import { createStairDesign, getStairFinish, getStairLayout, stairParts, stairPartLabels, stairTurnSteps, validateStairDesign,
  type StairDesign, type StairPart } from '../stairDesign'
import { stairGeometryKey } from '../stairGeometry'
import { downloadStairGlb, stairDefinition } from '../stairLibrary'
import { StairContent } from './ThreeDView'
import { PbrEnvironmentProvider } from './PbrEnvironment'
import './WindowBuilder.css'
import './StairBuilder.css'

export function StairBuilder({ definition, instanceCount, floorRise, materials, onClose, onSave }: {
  definition: ModelDefinition | null; instanceCount: number; floorRise: number; materials: SurfaceMaterialProduct[];
  onClose: () => void; onSave: (definition: ModelDefinition, place: boolean) => Promise<void>
}) {
  const [design, setDesign] = useState<StairDesign>(() => {
    const saved = structuredClone(definition?.stairDesign ?? createStairDesign(floorRise))
    const updated = { ...saved, landingSteps: saved.landingSteps ?? 0 }
    return validateStairDesign(updated) ? saved : updated
  })
  const [preview, setPreview] = useState(design)
  const [name, setName] = useState(definition?.name ?? 'My stairs')
  const [preferredRise, setPreferredRise] = useState(Math.round(design.totalRise / design.riserCount * 1000))
  const [part, setPart] = useState<StairPart>('treads')
  const [view, setView] = useState<'2d' | '3d'>('3d')
  const [past, setPast] = useState<StairDesign[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const dialog = useRef<HTMLElement>(null), previewObject = useRef<Object3D | null>(null)
  const validation = validateStairDesign(design), layout = getStairLayout(preview), b = layout.bounds
  const actualRise = design.totalRise / design.riserCount, finish = getStairFinish(design, part)
  const turnSteps = stairTurnSteps(design), secondFlight = design.riserCount - design.stepsBeforeTurn - turnSteps
  const update = (patch: Partial<StairDesign>) => {
    const next = { ...design, ...patch }
    if (patch.width !== undefined) next.landingDepth = Math.abs(design.landingDepth - design.width) < 1e-7
      ? next.width : Math.max(next.landingDepth, next.width)
    if (patch.riserCount === undefined && design.layout !== 'straight' && next.layout !== 'straight' &&
      ['layout', 'turnType', 'winderCount', 'landingSteps'].some(key => key in patch))
      next.riserCount += stairTurnSteps(next) - stairTurnSteps(design)
    if (['layout', 'turnType', 'riserCount', 'winderCount'].some(key => key in patch))
      next.stepsBeforeTurn = Math.max(next.turnType === 'landing' ? 2 : 1,
        Math.min(next.stepsBeforeTurn, next.riserCount - stairTurnSteps(next) - (next.turnType === 'landing' ? 2 : 1)))
    setPast(p => [...p.slice(-39), design]); setDesign(next); setError('')
    if (!validateStairDesign(next)) setPreview(next)
  }
  const setFinish = (patch: Partial<typeof finish>) => update({ finishes: { ...design.finishes, [part]: { ...finish, ...patch } } })
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => previous?.focus()
  }, [])
  const commit = async (copy: boolean, place: boolean) => {
    if (validation || !name.trim()) return
    setBusy(true); setError('')
    try {
      const id = !copy && definition ? definition.id : `custom-stairs-${crypto.randomUUID()}`
      await onSave(stairDefinition(id, copy ? `${name} copy` : name, design), place)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the stairs.'); setBusy(false) }
  }
  const number = (label: string, key: keyof StairDesign, min: number, max: number, step = 5, millimetres = true) =>
    <label>{label}{millimetres ? ' (mm)' : ''}<input type="number" min={min} max={max} step={step}
      value={millimetres ? Math.round((design[key] as number) * 1000) : design[key] as number}
      onChange={e => update({ [key]: Number(e.target.value) / (millimetres ? 1000 : 1) })} /></label>
  const check = (label: string, key: 'closedRisers' | 'closedUnderside' | 'stringers') => <label className="window-builder-checkbox">
    <input type="checkbox" checked={!!design[key]} onChange={e => update({ [key]: e.target.checked })} />{label}</label>
  const shapeLabel = design.layout === 'straight' ? 'Straight' : design.layout === 'l' ? 'L-shaped' : 'U-shaped'
  return <div className="modal-backdrop window-builder-backdrop">
    <section className="window-builder stair-builder" role="dialog" aria-modal="true" aria-labelledby="stair-builder-title" tabIndex={-1} ref={dialog}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Escape' && !busy) onClose()
        if (e.key !== 'Tab') return
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? [])
        const first = items[0], last = items.at(-1)
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }}>
      <header><div><span className="window-builder-eyebrow">MY STAIRS</span><h2 id="stair-builder-title">{definition ? 'Edit stair variety' : 'Build stairs'}</h2>
        <p>{definition ? `Saving updates ${instanceCount} placed ${instanceCount === 1 ? 'staircase' : 'staircases'} of this variety across all floors.` : 'Shape your staircase, choose each finish, then save and place it.'}</p></div>
        <button type="button" aria-label="Close stair builder" disabled={busy} onClick={onClose}>×</button></header>
      <div className="window-builder-body" inert={busy}>
        <aside className="window-builder-settings">
          <label>Variety name<input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
          <h3>Construction</h3>
          <div className="stair-builder-layouts"><button type="button" aria-pressed={!design.closedRisers && !design.closedUnderside}
            onClick={() => update({ closedRisers: false, closedUnderside: false })}>Open treads</button>
            <button type="button" aria-pressed={design.closedRisers && !!design.closedUnderside}
              onClick={() => update({ closedRisers: true, closedUnderside: true })}>Enclosed stairs</button></div>
          <h3>Layout</h3><div className="stair-builder-layouts">{(['straight', 'l', 'u'] as const).map(layout =>
            <button key={layout} type="button" aria-pressed={design.layout === layout} onClick={() => update({ layout, winderCount: layout === 'u' ? 6 : 3 })}>
              {layout === 'straight' ? 'Straight' : layout === 'l' ? 'L-shaped' : 'U-shaped'}</button>)}</div>
          {design.layout !== 'straight' && <>
            <label>Turn direction<select value={design.turn} onChange={e => update({ turn: e.target.value as StairDesign['turn'] })}>
              <option value="left">Turn left going up</option><option value="right">Turn right going up</option></select></label>
            <label>Mid-landing<select value={design.turnType === 'winder' ? 'winder' : String(design.landingSteps ?? 0)} onChange={e => {
              const turnType = e.target.value === 'winder' ? 'winder' : 'landing'
              const landingSteps = turnType === 'landing' ? Number(e.target.value) as 0 | 1 | 2 | 3 : design.landingSteps
              const nextTurns = turnType === 'winder' ? design.winderCount : landingSteps ?? 0
              update({ turnType, landingSteps, riserCount: design.riserCount + nextTurns - turnSteps })
            }}>
              <option value="0">Flat</option><option value="1">1 step · middle</option>
              <option value="2">2 steps · splayed</option><option value="3">3 steps · split turn</option>
              <option value="winder">Full winding turn</option></select></label>
          </>}
          <h3>Rise &amp; steps</h3>
          {number('Total rise', 'totalRise', 300, 8000, 10)}
          <button type="button" onClick={() => update({ totalRise: floorRise, riserCount: Math.max(2, Math.min(48, Math.round(floorRise / (preferredRise / 1000 || .18)))) })}>Fit floor-to-floor · {Math.round(floorRise * 1000)} mm</button>
          <div className="window-builder-fields">
            <label>Target riser height (mm)<input type="number" min={60} max={350} step={1} value={preferredRise}
              onChange={e => { const value = Number(e.target.value); setPreferredRise(value); if (value >= 60 && value <= 350) update({ riserCount: Math.max(2, Math.min(48, Math.round(design.totalRise / (value / 1000)))) }) }} /></label>
            {number('Riser count', 'riserCount', 2, 48, 1, false)}
          </div>
          <p className="stair-builder-summary" role="status">{design.riserCount} equal risers × {Number.isFinite(actualRise) ? (actualRise * 1000).toFixed(1) : '—'} mm</p>
          <div className="window-builder-fields">{number('Stair width', 'width', 400, 3000)}{number('Tread depth', 'going', 100, 600)}
            {number('Tread thickness', 'treadThickness', 10, 120, 1)}{number('Nosing', 'nosing', 0, 60, 1)}</div>
          <label className="window-builder-checkbox"><input type="checkbox" checked={!!design.nosingRadius}
            onChange={e => update({ nosingRadius: e.target.checked ? .01 : 0 })} />Rounded tread edges (6 segments)</label>
          {!!design.nosingRadius && <>
            <label>Edge radius (mm)<input type="number" min={1} max={60} step={1} value={Math.round(design.nosingRadius * 1000)}
              onChange={e => update({ nosingRadius: Number(e.target.value) / 1000 })} /></label>
            <p className="window-builder-help">Rounds the carpet over each tread and landing edge. Radius is limited by the nosing and tread thickness.</p>
          </>}
          {design.layout !== 'straight' && <>
            <div className="window-builder-fields">
              <label>First flight steps<input type="number" min={design.turnType === 'landing' ? 2 : 1} max={46} step={1} value={design.stepsBeforeTurn}
                onChange={e => update({ stepsBeforeTurn: Number(e.target.value), riserCount: Number(e.target.value) + turnSteps + secondFlight })} /></label>
              <label>Second flight steps<input type="number" min={design.turnType === 'landing' ? 2 : 1} max={46} step={1} value={secondFlight}
                onChange={e => update({ riserCount: design.stepsBeforeTurn + turnSteps + Number(e.target.value) })} /></label>
            </div>
            <button type="button" onClick={() => update({ stepsBeforeTurn: Math.floor((design.riserCount - turnSteps) / 2) })}>Balance flights</button>
            <p className="window-builder-help">Counts include the rise onto the landing or upper floor. {design.stepsBeforeTurn} + {turnSteps} in the turn + {secondFlight} = {design.riserCount} risers.</p>
            {design.turnType === 'landing' ? number('Landing depth', 'landingDepth', Math.round(design.width * 1000), 4000) : number('Winding tread count', 'winderCount', 2, 12, 1, false)}
            {design.turnType === 'landing' && <p className="window-builder-help">Landing depth runs from the newel / first-step line to the back edge.</p>}
            {design.layout === 'u' && number('Gap between flights', 'wellWidth', 40, 2000)}
          </>}
          <h3>Components</h3>
          {check('Closed risers (kickboards)', 'closedRisers')}{check('Closed underside', 'closedUnderside')}
          {!design.closedUnderside && check('Supporting stringers', 'stringers')}
          <button type="button" disabled={!past.length} onClick={() => {
            const previous = past.at(-1)!; setDesign(previous); if (!validateStairDesign(previous)) setPreview(previous)
            setPast(p => p.slice(0, -1)); setError('')
          }}>Undo design change</button>
        </aside>
        <div className="window-builder-centre">
          <nav aria-label="Stair preview"><button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>3D preview</button>
            <button type="button" aria-pressed={view === '2d'} onClick={() => setView('2d')}>2D plan</button></nav>
          <div className="window-builder-preview">
            {view === '3d' ? <Canvas frameloop="demand" camera={{ position: [5, 4, -6], fov: 40 }}>
              <color attach="background" args={['#e8eef3']} /><hemisphereLight intensity={1.5} /><directionalLight position={[3, 6, -2]} intensity={2.5} />
              <PbrEnvironmentProvider intensity={.45}>
                <Bounds fit clip observe margin={1.8} key={stairGeometryKey(preview)}><StairContent design={preview}
                  onObject={object => { previewObject.current = object; return () => { previewObject.current = null } }} /></Bounds>
              </PbrEnvironmentProvider><OrbitControls makeDefault />
            </Canvas> : <svg aria-label="Stair plan, arrow points upstairs" viewBox={`${b.minX - .25} ${-b.maxZ - .25} ${b.maxX - b.minX + .5} ${b.maxZ - b.minZ + .5}`}>
              <defs><marker id="stair-up-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#176f9d" /></marker></defs>
              {layout.surfaces.map((s, i) => <polygon key={i} points={s.polygon.map(p => `${p.x},${-p.z}`).join(' ')} fill={preview.finishes.treads.color} stroke="#586d7f" strokeWidth={.012} />)}
              {layout.flights.map((f, i) => {
                const a = f.left[0], z = f.left.at(-1)!, ra = f.right[0], rz = f.right.at(-1)!
                return <line key={i} x1={(a.x + ra.x) / 2} y1={-(a.z + ra.z) / 2} x2={(z.x + rz.x) / 2} y2={-(z.z + rz.z) / 2} stroke="#176f9d" strokeWidth={.025} markerEnd="url(#stair-up-arrow)" />
              })}
            </svg>}
          </div>
          <div className="stair-builder-metrics"><span>{shapeLabel} · {Math.round((b.maxX - b.minX) * 1000)} × {Math.round((b.maxZ - b.minZ) * 1000)} mm plan</span>
            <span>{Math.round(preview.totalRise * 1000)} mm rise · {(Math.atan2(preview.totalRise / preview.riserCount, preview.going) * 180 / Math.PI).toFixed(1)}° pitch</span></div>
          <p className="window-builder-help">Drag to orbit · Scroll to zoom{validation ? ' · Preview shows the last valid design' : ''}</p>
        </div>
        <aside className="window-builder-selection">
          <h3>Banisters &amp; handrails</h3>
          <p>Sides are viewed while going upstairs.</p>
          <div className="stair-builder-rail-options">{(['left', 'right'] as const).map(side => <div key={side}><strong>{side === 'left' ? 'Left side' : 'Right side'}</strong>
            {(['banisters', 'handrails'] as const).map(key => <label key={key} className="window-builder-checkbox">
              <input type="checkbox" checked={design[key][side]} onChange={e => update({ [key]: { ...design[key], [side]: e.target.checked } })} />{key === 'banisters' ? 'Spindles & posts' : 'Handrail'}</label>)}</div>)}</div>
          <div className="window-builder-fields">{number('Rail height', 'railHeight', 400, 1500)}{number('Spindle width', 'spindleWidth', 10, 100, 1)}
            {number('Spindle spacing', 'spindleSpacing', 60, 400)}{number('Newel width', 'postWidth', 30, 200, 1)}
            {number('Handrail width', 'handrailWidth', 25, 150, 1)}</div>
          <h3>Individual finishes</h3>
          <label>Stair part<select value={part} onChange={e => setPart(e.target.value as StairPart)}>{stairParts.map(p => <option value={p} key={p}>{stairPartLabels[p]}</option>)}</select></label>
          <label>Material<select value={finish.materialId ?? ''} onChange={e => setFinish({ materialId: e.target.value || undefined })}>
            <option value="">Custom colour & finish</option>{materials.map(m => <option key={m.id} value={m.id}>{m.manufacturer} · {m.productName}</option>)}</select></label>
          <label>Texture scale<input type="number" min={.01} max={100} step={.1} value={finish.textureScale ?? 1}
            onChange={e => setFinish({ textureScale: Number(e.target.value) })} /></label>
          <p className="window-builder-help">1 uses the material's normal size. 2 makes its pattern twice as large. Each stair part has its own scale.</p>
          {!finish.materialId && <>
            <div className="stair-builder-layouts">{[{ name: 'Oak', color: '#a87948', roughness: .6, metalness: 0 },
              { name: 'Paint', color: '#eeeae1', roughness: .55, metalness: 0 }, { name: 'Metal', color: '#303941', roughness: .35, metalness: .85 }].map(({ name, ...f }) =>
              <button key={name} type="button" onClick={() => setFinish(f)}>{name}</button>)}</div>
            <label>Part colour<input type="color" value={finish.color} onChange={e => setFinish({ color: e.target.value })} /></label>
            <div className="window-builder-fields"><label>Roughness<input type="number" min={0} max={1} step={.05} value={finish.roughness} onChange={e => setFinish({ roughness: Number(e.target.value) })} /></label>
              <label>Metallic<input type="number" min={0} max={1} step={.05} value={finish.metalness} onChange={e => setFinish({ metalness: Number(e.target.value) })} /></label></div>
          </>}
          <p className="window-builder-help">Each part keeps its own finish. Spindles use the profile from your existing floating stairs.</p>
        </aside>
      </div>
      <footer><div role="status" className={validation || error ? 'window-builder-error' : ''}>{error || validation || (exporting ? 'Exporting GLB…' : busy ? 'Saving your stairs…' : 'Saved locally on this browser and in your house file')}</div>
        <div className="window-builder-actions"><button type="button" disabled={busy || !!validation || view !== '3d'} title={view === '2d' ? 'Open the 3D preview to export all materials.' : undefined} onClick={async () => {
          setBusy(true); setExporting(true); setError('')
          try {
            const object = previewObject.current
            if (!object) throw new Error('The 3D preview is still preparing. Try again in a moment.')
            await downloadStairGlb(design, name, object)
          } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
          finally { setBusy(false); setExporting(false) }
        }}>Download GLB</button>
          {definition && <button type="button" disabled={busy || !!validation || !name.trim()} onClick={() => void commit(true, false)}>Save as new variety</button>}
          <button type="button" disabled={busy || !!validation || !name.trim()} onClick={() => void commit(false, false)}>{definition ? 'Save variety' : 'Save to My stairs'}</button>
          <button type="button" className="primary" disabled={busy || !!validation || !name.trim()} onClick={() => void commit(false, true)}>Save &amp; place</button></div></footer>
    </section>
  </div>
}
