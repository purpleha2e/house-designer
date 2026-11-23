import { useEffect, useState, type RefObject } from 'react'
import type { Scene } from 'three'
import type { HybridMode } from '../../experiments/ml-gi/phase5/editor'
import { isSixRayMode, type SixRayMode } from '../sixRaySampling'
import type { SixRayOptions } from '../sixRayLighting'
import { lumenViews } from '../lumenViewportPass'
import type { LumenTraceMethod } from './LumenGI'

export type EditorGIBackend = HybridMode | SixRayMode | 'lumen'

type Status = {
  active: HybridMode; state: string; stage: string; detail: string
  patches: number; edges: number; probes: number; samples: number; generation: number
  geometryBuilds: number; setupMs: number; updateMs: number; medianMs: number; p95Ms: number; gpuMs: number; memoryBytes: number
}
export function ExperimentalHybridControls({ scene, value, onChange, primary, secondary, onPrimaryChange, onSecondaryChange, diffuseEnabled, lumenView, onLumenView, lumenTrace, onLumenTrace }: {
  scene: RefObject<Scene | null>; value: EditorGIBackend; onChange: (mode: EditorGIBackend) => void
  lumenView:number; onLumenView:(view:number)=>void
  lumenTrace:LumenTraceMethod; onLumenTrace:(method:LumenTraceMethod)=>void
  primary: SixRayOptions['primary']; secondary: SixRayOptions['secondary']; diffuseEnabled: boolean
  onPrimaryChange: (value: SixRayOptions['primary']) => void; onSecondaryChange: (value: SixRayOptions['secondary']) => void
}) {
  const [status, setStatus] = useState<Status | null>(null)
  const [rayStatus, setRayStatus] = useState<{ state: string; detail: string; probes: number; visibleMs: number } | null>(null)
  const sixRay = isSixRayMode(value)
  const [pixel,setPixel]=useState('')
  const [lumenStatus,setLumenStatus] = useState('')
  const [traceReady,setTraceReady] = useState(false)
  useEffect(() => {
    if (value === 'production') return
    const read = () => {
      const next = scene.current?.userData.experimentalHybridGI
      setStatus(next ? { ...next } as Status : null)
      const ray = scene.current?.userData.sixRayGI
      setRayStatus(ray ? { ...ray } : null)
      if(value==='lumen')setPixel(scene.current?.userData.lumenPixel ? JSON.stringify(scene.current.userData.lumenPixel,null,1) : '')
      const cache = scene.current?.userData.lumenGI
      if (value === 'lumen') setTraceReady(cache?.trace === 'sdf')
      if (value === 'lumen') setLumenStatus(cache?.state === 'ready'
        ? lumenView===7 ? `GI submission ${cache.cpuMs.toFixed(1)} ms · GPU ${cache.gpuMs===null?'pending':cache.gpuMs.toFixed(1)+' ms'}`
          : lumenView===10 ? `${cache.surfaces.toLocaleString()} patches · ${cache.lightingTriangles.toLocaleString()} of ${cache.originalTriangles.toLocaleString()} triangles used for GI · ${(cache.atlasBytes/1048576).toFixed(1)} MiB cache`
          : `${cache.surfaces.toLocaleString()} surface samples · ${cache.lightingSource} · ${!cache.daylightReady ? 'Updating window daylight' : !cache.bounceReady ? 'Updating diffuse bounces' : cache.invalidation} · ${cache.geometryBuilds} geometry build${cache.geometryBuilds===1?'':'s'}`
        : cache?.detail || cache?.state || 'Waiting for geometry')
    }
    read()
    const timer = setInterval(read, 400)
    return () => clearInterval(timer)
  }, [scene, value, lumenView])
  return <>
    <label className="render-options-slider editor-view-select"><span>GI backend</span>
      <select aria-label="GI backend" value={value} onChange={event => {
        const mode = event.currentTarget.value
        if (mode === 'production' || isSixRayMode(mode) || mode === 'fixed' || mode === 'learned' || (import.meta.env.DEV && mode === 'lumen')) onChange(mode)
      }}>
        <option value="production">Production probes</option>
        <option value="six-fixed">Experimental six-ray · fixed</option>
        <option value="six-rotated">Experimental six-ray · rotated</option>
        <option value="six-adaptive">Experimental six-ray · adaptive</option>
        {import.meta.env.DEV && <>
          <option value="lumen">Lumen-inspired experimental GI</option>
          <option value="fixed">Experimental hybrid · fixed</option>
          <option value="learned">Experimental hybrid · learned</option>
        </>}
      </select>
    </label>
    {value === 'lumen' && <>
      <label className="render-options-slider editor-view-select"><span>GI trace method</span>
        <select aria-label="Lumen trace method" value={lumenTrace} onChange={event=>onLumenTrace(event.currentTarget.value==='sdf'?'sdf':'patches')}>
          <option value="patches">Surface patches</option>
          <option value="sdf">Signed distance field (experimental)</option>
        </select>
      </label>
      {diffuseEnabled && lumenTrace==='sdf' && lumenStatus && <p className="viewport-menu-description">{traceReady ? 'Distance-field tracing active' : 'Preparing distance field'}</p>}
      <label className="render-options-slider editor-view-select"><span>GI view</span>
        <select aria-label="Lumen GI view" value={lumenView} onChange={event=>onLumenView(Number(event.currentTarget.value))}>
          {lumenViews.map((name,index)=><option key={name} value={index}>{name}</option>)}
        </select>
      </label>
      <div className="viewport-menu-description">
        {lumenView===15 && 'Red shows screen hits, green shows fallback hits and blue shows direct sky. '}
        Alt-click a surface to inspect its lighting.{pixel && <pre style={{maxHeight:'14em',overflow:'auto'}}>{pixel}</pre>}
      </div>
      <p className="viewport-menu-description" role="status">{diffuseEnabled ? lumenStatus : 'Indirect lighting is off'}</p>
    </>}
    {sixRay && <>
      <label className="render-options-slider editor-view-select"><span>Primary rays</span>
        <select aria-label="Primary rays" value={primary} onChange={event => onPrimaryChange(Number(event.currentTarget.value) as SixRayOptions['primary'])}>
          <option value={6}>6</option><option value={12}>12</option><option value={24}>24</option>
        </select>
      </label>
      <label className="render-options-slider editor-view-select"><span>Secondary rays per hit</span>
        <select aria-label="Secondary rays per hit" value={secondary} onChange={event => onSecondaryChange(Number(event.currentTarget.value) as SixRayOptions['secondary'])}>
          <option value={0}>0</option><option value={4}>4</option><option value={8}>8</option>
        </select>
      </label>
      <p className="viewport-menu-description" role="status">{!diffuseEnabled ? 'Indirect lighting is off' :
        rayStatus?.state === 'error' ? rayStatus.detail :
        rayStatus?.state === 'ready' ? `${rayStatus.probes} probes · ${Math.round(rayStatus.visibleMs)} ms to display` :
          rayStatus?.state === 'updating' ? 'Updating bounced light' : 'Preparing ray-traced lighting'}</p>
    </>}
    {!sixRay && value !== 'production' && value !== 'lumen' && <div className="viewport-menu-description" aria-label="Hybrid GI diagnostics">
      <p role="status">{status?.state === 'fallback' ? status.detail : status?.stage ?? 'Waiting for the production probe layout'}</p>
      {status?.geometryBuilds ? <dl>
        <dt>Active backend</dt><dd>{status.active}</dd>
        <dt>Geometry cache</dt><dd>{status.geometryBuilds} build, {(status.setupMs / 1000).toFixed(1)} s preparation</dd>
        <dt>Surface patches and edges</dt><dd>{status.patches.toLocaleString()} / {status.edges.toLocaleString()}</dd>
        <dt>Probes and first-bounce samples</dt><dd>{status.probes.toLocaleString()} / {status.samples.toLocaleString()}</dd>
        <dt>Generation</dt><dd>{status.generation}</dd>
        <dt>Visible update, median and P95</dt><dd>{status.updateMs.toFixed(0)} / {status.medianMs.toFixed(0)} / {status.p95Ms.toFixed(0)} ms</dd>
        <dt>GPU reconstruction</dt><dd>{status.gpuMs ? status.gpuMs.toFixed(1) + ' ms' : 'Waiting for GPU timing'}</dd>
        <dt>Estimated worker data</dt><dd>{(status.memoryBytes / 1048576).toFixed(1)} MiB</dd>
      </dl> : null}
    </div>}
  </>
}
