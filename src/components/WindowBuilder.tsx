import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { ModelDefinition } from '../models/modelLibrary'
import { createWindowDesign, fixedPane, getWindowDividerWidth, getWindowLayout, updateWindowSection, validateWindowDesign,
  windowPreset, type WindowDesign, type WindowOpening, type WindowSection } from '../windowDesign'
import { downloadWindowGlb, windowDefinition } from '../windowLibrary'
import { WindowMesh } from './WindowMesh'
import { PbrEnvironmentProvider } from './PbrEnvironment'
import './WindowBuilder.css'

export function WindowBuilder({ definition, instanceCount, onClose, onSave }: {
  definition: ModelDefinition | null; instanceCount: number; onClose: () => void;
  onSave: (definition: ModelDefinition, place: boolean) => Promise<void>
}) {
  const [design, setDesign] = useState<WindowDesign>(() => structuredClone(definition?.windowDesign ?? createWindowDesign()))
  const [name, setName] = useState(definition?.name ?? 'My window')
  const [selected, setSelected] = useState('r')
  const [view, setView] = useState<'2d' | '3d'>('2d')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [past, setPast] = useState<WindowDesign[]>([])
  const svgRef = useRef<SVGSVGElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ path: string; start: WindowDesign } | null>(null)
  const validation = validateWindowDesign(design)
  const layout = getWindowLayout(design)
  const selectedPane = layout.panes.find(p => p.path === selected)
  const selectedDivider = layout.dividers.find(p => p.path === selected)
  const update = (next: WindowDesign) => { setPast(p => [...p.slice(-39), design]); setDesign(next); setError('') }
  const sectionUpdate = (callback: (s: WindowSection) => WindowSection) => update({ ...design,
    layout: updateWindowSection(design.layout, selected, callback) })
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => previous?.focus()
  }, [])
  const commit = async (copy: boolean, place: boolean) => {
    if (validation || !name.trim()) return
    setBusy(true); setError('')
    try {
      const id = !copy && definition ? definition.id : `custom-window-${crypto.randomUUID()}`
      await onSave(windowDefinition(id, copy ? `${name} copy` : name, design), place)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the window.'); setBusy(false) }
  }
  const split = (axis: 'x' | 'y') => sectionUpdate(s => ({ kind: 'split', axis, ratio: 0.5, children: [s, fixedPane()] }))
  const topLights = () => {
    const add = (s: WindowSection): WindowSection => s.kind === 'split'
      ? { ...s, children: s.children.map(add) as [WindowSection, WindowSection] }
      : { kind: 'split', axis: 'y', ratio: 0.25, fixedFirst: 0.3,
        children: [{ kind: 'pane', opening: 'top' }, s] }
    update({ ...design, layout: add(design.layout) }); setSelected('r')
  }
  const changeDividerSize = (size: number, fixed?: boolean) => {
    if (!selectedDivider || selectedDivider.section.kind !== 'split' || !selectedDivider.bounds) return
    const s = selectedDivider.section, b = selectedDivider.bounds
    const span = (s.axis === 'x' ? b.width : b.height) - getWindowDividerWidth(design, s)
    sectionUpdate(() => ({ ...s, ratio: Math.max(0.001, Math.min(0.999, size/span)),
      fixedFirst: (fixed ?? s.fixedFirst !== undefined) ? size : undefined }))
  }
  const dividerFirstSize = selectedDivider && selectedDivider.bounds && selectedDivider.section.kind === 'split'
    ? selectedDivider.section.fixedFirst ?? ((selectedDivider.section.axis === 'x' ? selectedDivider.bounds.width : selectedDivider.bounds.height)-getWindowDividerWidth(design, selectedDivider.section))*selectedDivider.section.ratio : 0
  const extent = Math.max(design.width, design.height, 0.3)
  const pad = extent * 0.13
  return <div className="modal-backdrop window-builder-backdrop">
    <section className="window-builder" role="dialog" aria-modal="true" aria-labelledby="window-builder-title" tabIndex={-1} ref={dialogRef}
      onKeyDown={e => {
        if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose() }
        if (e.key === 'Tab') {
          const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])
          const first = items[0], last = items.at(-1)
          if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last?.focus() }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
        }
        e.stopPropagation()
      }}>
      <header><div><span className="window-builder-eyebrow">MY WINDOWS</span><h2 id="window-builder-title">{definition ? 'Edit window variety' : 'Build a window'}</h2>
        <p>{definition ? `Saving updates ${instanceCount} placed ${instanceCount === 1 ? 'window' : 'windows'} of this variety across all floors.` : 'Design a reusable window, then place it anywhere in your house.'}</p></div>
        <button type="button" aria-label="Close window builder" onClick={onClose} disabled={busy}>×</button></header>
      <div className="window-builder-body" inert={busy}>
        <aside className="window-builder-settings">
          <label>Variety name<input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
          <h3>Overall dimensions</h3>
          <div className="window-builder-fields">{(['width', 'height', 'depth', 'frame', 'divider'] as const).map(key =>
            <label key={key}>{({width:'Width',height:'Height',depth:'Frame depth',frame:'Frame width',divider:'Default divider width'})[key]} (mm)
              <input type="number" min={key==='width'||key==='height'?300:key==='depth'?30:20} max={key==='width'||key==='height'?10000:key==='depth'?500:200}
                step={5} value={Math.round(design[key]*1000)} onChange={e => update({ ...design, [key]: Number(e.target.value)/1000 })} /></label>)}</div>
          <label>Frame colour<input type="color" value={design.color} onChange={e => update({ ...design, color: e.target.value })} /></label>
          <h3>Starting layout</h3><div className="window-builder-presets">{[1,2,3,4].map(n =>
            <button type="button" key={n} onClick={() => { update({ ...design, layout: windowPreset(design,n) }); setSelected('r') }}>{n} {n===1?'pane':'panes'}</button>)}</div>
          <button type="button" onClick={topLights} disabled={layout.panes.length>16}>Add 300 mm top openings</button>
          <p className="window-builder-help">Top openings keep their height when you resize. Select a divider to change this.</p>
          <button type="button" disabled={!past.length} onClick={() => { setDesign(past[past.length-1]); setPast(p => p.slice(0,-1)); setSelected('r') }}>Undo layout change</button>
        </aside>
        <div className="window-builder-centre">
          <nav aria-label="Window preview"><button type="button" aria-pressed={view==='2d'} onClick={() => setView('2d')}>2D layout</button>
            <button type="button" aria-pressed={view==='3d'} onClick={() => setView('3d')} disabled={!!validation}>3D preview</button></nav>
          <div className="window-builder-preview">
          {view === '2d' ? <svg ref={svgRef} aria-label="Window front view, viewed from outside" viewBox={`${-pad} ${-pad} ${design.width+pad*2} ${design.height+pad*2}`}
            onPointerMove={e => {
              const drag = dragRef.current, svg = svgRef.current
              if (!drag || !svg) return
              const matrix = svg.getScreenCTM(); if (!matrix) return
              const point = new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse())
              const divider = getWindowLayout(drag.start).dividers.find(d => d.path===drag.path)!
              const s = divider.section, b = divider.bounds!
              if (s.kind !== 'split') return
              const dividerWidth = getWindowDividerWidth(design, s)
              const span = (s.axis==='x'?b.width:b.height)-dividerWidth
              const size = Math.max(0.1, Math.min(span-0.1, (s.axis==='x'?point.x-b.x:point.y-b.y)-dividerWidth/2))
              const next = { ...design, layout: updateWindowSection(design.layout,drag.path,() => ({...s,ratio:size/span,fixedFirst:s.fixedFirst===undefined?undefined:size})) }
              if (!validateWindowDesign(next)) setDesign(next)
            }} onPointerUp={() => { const start = dragRef.current?.start; if (start) setPast(p => [...p.slice(-39),start]); dragRef.current=null }}
            onPointerCancel={() => { if(dragRef.current) setDesign(dragRef.current.start); dragRef.current=null }}>
            <rect width={Math.max(design.width,0.01)} height={Math.max(design.height,0.01)} fill={design.color} stroke="#657382" strokeWidth={extent*0.003}/>
            {layout.panes.map((p,i) => <g key={p.path} role="button" tabIndex={0} aria-label={`Select pane ${i+1}`} onClick={() => setSelected(p.path)}
              onKeyDown={e => { if(e.key==='Enter'||e.key===' ') {e.preventDefault();setSelected(p.path)} }} className="window-builder-pane">
              <rect x={p.x} y={p.y} width={Math.max(0,p.width)} height={Math.max(0,p.height)} fill={selected===p.path?'#a1d5eb':'#d0e7ee'} stroke={selected===p.path?'#1475b4':'#7496a6'} strokeWidth={extent*0.003}/>
              {p.section.kind==='pane' && p.section.opening!=='fixed' ? <path fill="none" stroke="#4c7789" strokeWidth={extent*0.003} strokeDasharray={`${extent*0.012} ${extent*0.008}`}
                d={p.section.opening==='top' ? `M ${p.x} ${p.y} L ${p.x+p.width/2} ${p.y+p.height} L ${p.x+p.width} ${p.y}` : p.section.opening==='left' ? `M ${p.x} ${p.y} L ${p.x+p.width} ${p.y+p.height/2} L ${p.x} ${p.y+p.height}` : `M ${p.x+p.width} ${p.y} L ${p.x} ${p.y+p.height/2} L ${p.x+p.width} ${p.y+p.height}`} /> : null}
              <text x={p.x+p.width/2} y={p.y+p.height/2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(extent*0.032,p.width*0.17,p.height*0.2)} fill="#2b5061">{p.section.kind==='pane'?({fixed:'Fixed',top:'Top hung',left:'Left hung',right:'Right hung'})[p.section.opening]:''}</text>
            </g>)}
            {layout.dividers.map((d,i) => <rect key={d.path} role="button" tabIndex={0} aria-label={`Select divider ${i+1}`} className={`window-builder-divider ${d.section.kind==='split'?d.section.axis:''}`}
              x={d.x} y={d.y} width={Math.max(d.width,0)} height={Math.max(d.height,0)} fill={selected===d.path?'#2a86b8':design.color} stroke="#70808c" strokeWidth={extent*0.002}
              onKeyDown={e => {if(e.key==='Enter'||e.key===' ') {e.preventDefault();setSelected(d.path)}}}
              onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setSelected(d.path); dragRef.current={path:d.path,start:design} }} />)}
            <text x={design.width/2} y={-pad*0.4} textAnchor="middle" fontSize={extent*0.035} fill="#536477">{Math.round(design.width*1000)} mm</text>
            <text transform={`translate(${-pad*0.4} ${design.height/2}) rotate(-90)`} textAnchor="middle" fontSize={extent*0.035} fill="#536477">{Math.round(design.height*1000)} mm</text>
          </svg> : !validation ? <Canvas camera={{position:[extent*1.15,extent*0.8,extent*1.65],fov:42}}>
            <color attach="background" args={['#e8eef3']} /><ambientLight intensity={1.8}/><directionalLight position={[2,4,5]} intensity={3}/>
            <PbrEnvironmentProvider intensity={0.55}>
              <group position={[0,-design.height/2,0]}><WindowMesh design={design}/></group>
            </PbrEnvironmentProvider><OrbitControls makeDefault />
          </Canvas> : <p>Correct the dimensions to preview this window.</p>}
          </div><p className="window-builder-help">Viewed from outside · Click a pane to edit it. Drag a divider to resize sections.</p>
        </div>
        <aside className="window-builder-selection"><h3>{selectedPane?'Selected pane':selectedDivider?'Selected divider':'Select a pane or divider'}</h3>
          {selectedPane ? <>
            <p>{Math.round(selectedPane.width*1000)} × {Math.round(selectedPane.height*1000)} mm inside frame</p>
            <label>Opening type<select value={selectedPane.section.kind==='pane'?selectedPane.section.opening:'fixed'} onChange={e => sectionUpdate(() => ({kind:'pane',opening:e.target.value as WindowOpening}))}>
              <option value="fixed">Fixed glass</option><option value="top">Top hung</option><option value="left">Left hung</option><option value="right">Right hung</option>
            </select></label>
            <button type="button" onClick={() => split('x')} disabled={layout.panes.length>=64}>Split side by side</button>
            <button type="button" onClick={() => split('y')} disabled={layout.panes.length>=64}>Split top and bottom</button>
            {selected!=='r' ? <button type="button" onClick={() => {const parent=selected.slice(0,selected.lastIndexOf('.'));update({...design,layout:updateWindowSection(design.layout,parent,()=>fixedPane())});setSelected(parent)}}>Merge parent section</button>:null}
          </> : selectedDivider && selectedDivider.section.kind==='split' ? <>
            <label>Separator width (mm)<input type="number" min={20} max={200} step={5}
              value={Math.round(getWindowDividerWidth(design, selectedDivider.section)*1000)}
              onChange={e => sectionUpdate(s => s.kind === 'split' ? { ...s, dividerWidth: Number(e.target.value)/1000 } : s)}/></label>
            <button type="button" disabled={selectedDivider.section.dividerWidth===undefined}
              onClick={() => sectionUpdate(s => s.kind === 'split' ? { ...s, dividerWidth: undefined } : s)}>Use default width</button>
            <p className="window-builder-help">Changes only this separator. Other separators keep their own widths.</p>
            <label>{selectedDivider.section.axis==='x'?'Left section width':'Top section height'} (mm)<input type="number" min={100} step={5} value={Math.round(dividerFirstSize*1000)} onChange={e => changeDividerSize(Number(e.target.value)/1000)}/></label>
            <label className="window-builder-checkbox"><input type="checkbox" checked={selectedDivider.section.fixedFirst!==undefined} onChange={e => changeDividerSize(dividerFirstSize,e.target.checked)}/>Keep this measurement when resizing</label>
            <p className="window-builder-help">Otherwise, sections resize in proportion to the window.</p>
            <button type="button" onClick={() => sectionUpdate(()=>fixedPane())}>Remove divider and its splits</button>
          </> : <p>Choose a section in the 2D preview.</p>}
        </aside>
      </div>
      <footer><div role="status" className={validation||error?'window-builder-error':''}>{error||validation||(busy?'Saving your window…':`${layout.panes.length} panes · Saved locally on this browser and in your house file`)}</div>
        <div className="window-builder-actions"><button type="button" disabled={busy||!!validation} onClick={async()=>{try{await downloadWindowGlb(design,name)}catch(e){setError(String(e))}}}>Download GLB</button>
          {definition?<button type="button" disabled={busy||!!validation||!name.trim()} onClick={()=>void commit(true,false)}>Save as new variety</button>:null}
          <button type="button" disabled={busy||!!validation||!name.trim()} onClick={()=>void commit(false,false)}>{definition?'Save variety':'Save to My windows'}</button>
          <button type="button" className="primary" disabled={busy||!!validation||!name.trim()} onClick={()=>void commit(false,true)}>Save &amp; place</button></div></footer>
    </section></div>
}
