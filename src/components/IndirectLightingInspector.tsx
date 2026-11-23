/* eslint-disable react-hooks/immutability -- Inspection reads live Three.js scene resources. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { BufferGeometry, Color, Float32BufferAttribute, InstancedMesh, LineBasicMaterial, LineSegments, Matrix3, Matrix4, Mesh, MeshStandardMaterial, Raycaster, Scene, Vector2, Vector3 } from 'three'
import { serializeIndirectField, type IndirectField } from '../indirectLighting'
import { snapshotIndirectGeometry } from '../indirectVisibility'
import { sampleDisplayedIndirect, type IndirectPointInspection } from '../indirectLightingDiagnostic'
import type { IndirectInspectionRequest } from '../indirectLightingDiagnostic.worker'
import type { HybridProbeInspection } from '../../experiments/ml-gi/phase5/editor'
import type { SixRayInspection } from '../sixRayLighting'

type Snapshot = { field: IndirectField; generation: number; ready: boolean; direct?: Uint16Array[];
  lights: { position: number[]; color: string }[] }
type RayReport = SixRayInspection & { displayed?: number[] }
const numberText = (value: number) => Number(value.toPrecision(3)).toString()
const rgbText = (rgb: number[]) => rgb.map(numberText).join(', ')
const swatch = (rgb: number[]) => {
  // A shared compression makes colours comparable without clipping high irradiance.
  const c = new Color().setRGB(...rgb.map(value => Math.max(0, value) / (1 + Math.max(0, value))) as [number, number, number]).convertLinearToSRGB()
  return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`
}

/** Pick a receiver and inspect its immutable lighting snapshot in a separate worker. */
export function IndirectLightingInspector({ enabled, snapshot }: { enabled: boolean; snapshot: () => Snapshot }) {
  const { camera, gl, scene, invalidate } = useThree()
  const latest = useRef(snapshot)
  useLayoutEffect(() => { latest.current = snapshot }, [snapshot])
  const [report, setReport] = useState<IndirectPointInspection | null>(null)
  const [hybridReport, setHybridReport] = useState<HybridProbeInspection | null>(null)
  const [rayReport, setRayReport] = useState<RayReport>()
  const [showRays, setShowRays] = useState(true)
  const [message, setMessage] = useState('Wait for GI ready, then click an indoor surface to inspect its lighting.')
  const [busy, setBusy] = useState(false)
  const reportGeneration = useRef(-1)
  const liveGeneration = useRef(-1)
  const hybridGeneration = useRef('')
  const rayGeneration = useRef(0)
  useFrame(() => {
    liveGeneration.current = latest.current().generation
    const status = scene.userData.experimentalHybridGI
    const next = status ? status.active + '/' + status.published : ''
    if (hybridGeneration.current !== next) { hybridGeneration.current = next; setHybridReport(null) }
    const rays = scene.userData.sixRayGI?.published ?? 0
    if (rayGeneration.current !== rays) { rayGeneration.current = rays; setRayReport(undefined) }
    if (reportGeneration.current >= 0 && reportGeneration.current !== liveGeneration.current) {
      reportGeneration.current = -1; setReport(null); setMessage('Lighting changed. Click the surface again to inspect the new bake.')
    }
  })
  useEffect(() => {
    if (!rayReport || !showRays) return
    const points: number[] = [], colors: number[] = []
    const segment = (start: number[], direction: number[], hit: number[] | undefined, color: string) => {
      const end = hit ?? new Vector3().fromArray(start).addScaledVector(new Vector3().fromArray(direction), 2).toArray()
      const rgb = new Color(color).toArray()
      points.push(...start, ...end); colors.push(...rgb, ...rgb)
    }
    for (const ray of rayReport.traces) {
      segment(rayReport.origin, ray.direction, ray.hit?.point, ray.target ? '#ffb84e' : '#36c9ff')
      if (ray.hit) for (const bounce of ray.secondary) segment(ray.hit.point, bounce.direction, bounce.hit?.point, '#b699fa')
    }
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3))
      .setAttribute('color', new Float32BufferAttribute(colors, 3))
    const material = new LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, toneMapped: false })
    const lines = new LineSegments(geometry, material)
    lines.name = 'six-ray-probe-rays'
    lines.frustumCulled = false
    lines.layers.enableAll()
    const overlay = new Scene()
    overlay.add(lines)
    scene.userData.sixRayOverlay = overlay
    const refresh = () => {
      scene.userData.displayEffectRevision = (scene.userData.displayEffectRevision ?? 0) + 1
      invalidate()
    }
    refresh()
    return () => {
      if (scene.userData.sixRayOverlay === overlay) delete scene.userData.sixRayOverlay
      geometry.dispose(); material.dispose(); refresh()
    }
  }, [invalidate, rayReport, scene, showRays])
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let activeWorker: Worker | null = null, sequence = 0
    const previousCursor = gl.domElement.style.cursor
    gl.domElement.style.cursor = 'crosshair'
    const inspect = (point: Vector3, normal: Vector3) => {
      const current = latest.current()
      const inspectRays = scene.userData.inspectSixRayProbe as ((point: number[], normal: number[]) => Promise<SixRayInspection | undefined>) | undefined
      if (inspectRays) {
        const request = ++sequence
        const generation = scene.userData.sixRayGI?.published
        activeWorker?.terminate(); activeWorker = null
        setBusy(true); setReport(null); setHybridReport(null); setRayReport(undefined)
        setMessage('Inspecting the nearest ray-traced probe…')
        return inspectRays(point.toArray(), normal.toArray()).then(result => {
          if (disposed || request !== sequence) return
          setBusy(false)
          if (generation === scene.userData.sixRayGI?.published && result) {
            const field = scene.userData.getSixRayField?.().field as IndirectField | undefined
            const sample = point.clone().addScaledVector(normal, .045)
            const floor = field?.ranges.findLastIndex(range => sample.y >= range.bottom && sample.y <= range.top) ?? -1
            const displayed = field && floor >= 0 ? sampleDisplayedIndirect(field, floor, sample, normal).rgb : undefined
            setRayReport({ ...result, displayed }); setMessage('Click another surface to inspect its nearest probe.')
          } else setMessage('Wait for ray-traced lighting to settle, then click again.')
        })
      }
      const hybrid: HybridProbeInspection | undefined = import.meta.env.DEV
        ? scene.userData.inspectExperimentalHybridProbe?.(point, normal) : undefined
      setHybridReport(hybrid ?? null)
      if (!current.ready || gl.xr.isPresenting) {
        setMessage(hybrid ? 'Click another surface to inspect its nearest hybrid probe.' : 'Wait for GI ready, then click an indoor surface.')
        return
      }
      const request = ++sequence
      activeWorker?.terminate()
      const diagnostic = new Worker(new URL('../indirectLightingDiagnostic.worker.ts', import.meta.url), { type: 'module' })
      activeWorker = diagnostic
      setBusy(true); setReport(null); setMessage('Comparing the lighting at this point…')
      diagnostic.onmessage = event => {
        if (disposed || request !== sequence) return
        diagnostic.terminate(); activeWorker = null; setBusy(false)
        if (current.generation !== liveGeneration.current) { setMessage('Lighting changed during inspection. Click the surface again.'); return }
        if (!event.data.ok) { setMessage(event.data.error); return }
        reportGeneration.current = current.generation
        setReport(event.data.result); setMessage('Click another surface to compare it.')
        scene.userData.indirectPointInspection = event.data.result
      }
      diagnostic.onerror = event => {
        if (disposed || request !== sequence) return
        diagnostic.terminate(); activeWorker = null; setBusy(false); setMessage(event.message || 'Inspection failed. Try again.')
      }
      try {
        const data: IndirectInspectionRequest = { field: serializeIndirectField(current.field), coefficients: current.field.coefficients,
          volume: current.field.volume.data, geometry: snapshotIndirectGeometry(scene), point: point.toArray(), normal: normal.toArray(),
          floorLayer: current.field.floorLayer.ready ? current.field.floorLayer.data : undefined,
          direct: current.direct, lights: current.lights }
        diagnostic.postMessage(data)
      } catch (error) {
        diagnostic.terminate(); activeWorker = null; setBusy(false); setMessage(error instanceof Error ? error.message : 'Inspection failed.')
      }
    }
    // Also exposed for reproducible browser checks; it is removed with the inspector.
    scene.userData.inspectIndirectPoint = (point: number[], normal: number[]) => inspect(new Vector3().fromArray(point), new Vector3().fromArray(normal))
    const pick = (event: PointerEvent) => {
      if (event.target !== gl.domElement || event.button !== 0) return
      event.preventDefault(); event.stopImmediatePropagation()
      const rect = gl.domElement.getBoundingClientRect(), ray = new Raycaster()
      ray.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera)
      const hit = ray.intersectObjects(scene.children, true).find(hit => {
        const object = hit.object
        if (!(object instanceof Mesh) || object.userData.selectionDecoration || object.userData.houseDesignerRole === 'ground-image') return false
        for (let parent = object; parent; parent = parent.parent as Mesh) if (!parent.visible) return false
        const material = Array.isArray(object.material) ? object.material[hit.face?.materialIndex ?? 0] : object.material
        return material instanceof MeshStandardMaterial && material.visible && material.opacity > 0 && !/glass|glazing/i.test(material.name)
      })
      if (!hit?.face) { setMessage('Click a visible indoor surface.'); return }
      const matrix = hit.object.matrixWorld.clone()
      if (hit.object instanceof InstancedMesh && hit.instanceId !== undefined) {
        const instance = new Matrix4(); hit.object.getMatrixAt(hit.instanceId, instance); matrix.multiply(instance)
      }
      const normal = hit.face.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(matrix))
      if (normal.dot(ray.ray.direction) > 0) normal.negate()
      inspect(hit.point, normal)
    }
    window.addEventListener('pointerdown', pick, true)
    return () => {
      disposed = true; sequence++; activeWorker?.terminate(); activeWorker = null
      gl.domElement.style.cursor = previousCursor; window.removeEventListener('pointerdown', pick, true)
      delete scene.userData.inspectIndirectPoint; delete scene.userData.indirectPointInspection
    }
  }, [enabled, camera, gl, scene])
  if (!enabled) return null
  const download = () => {
    if (!report && !hybridReport && !rayReport) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ generation: reportGeneration.current, ...report, hybrid: hybridReport, rays: rayReport }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'gi-point-inspection.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const rows = report ? [['Displayed GI', report.displayed.rgb], ['Exact blend at surface', report.exactAtSurface.rgb],
    ['Exact blend at shifted sample', report.exactAtShiftedSample.rgb]] as const : []
  const bounces = report?.bounces
  const bounceRows = bounces ? [['First bounce', bounces.firstBrightness, bounces.firstRGB],
    ['Additional bounce', bounces.additionalBrightness, bounces.additionalRGB], ['Final GI', bounces.finalBrightness, bounces.finalRGB]] as const : []
  return <Html fullscreen calculatePosition={(_, __, size) => [size.width / 2, size.height / 2]}
    onOcclude={() => {}} zIndexRange={[50, 50]} style={{ pointerEvents: 'none' }}><section className="gi-inspection-panel" aria-label="GI point inspection" aria-busy={busy}>
    <strong>GI point inspection</strong>
    <p aria-live="polite">{message}</p>
    {rayReport && <>
      <p>Probe {rayReport.probe} · Reconstructed irradiance {rgbText(rayReport.irradiance)}</p>
      {rayReport.displayed && <p>Volume irradiance at receiver {rgbText(rayReport.displayed)}</p>}
      <label><input type="checkbox" checked={showRays} onChange={event => setShowRays(event.target.checked)} /> Show primary and secondary rays</label>
      {showRays && <p>Blue coverage · amber targeted · violet secondary</p>}
      <details open><summary>Primary rays</summary>
        <ol>{rayReport.traces.map((ray, i) => <li key={i}>
          <details><summary>{ray.target ? `${ray.target.kind} · ${ray.target.id}` : 'Broad coverage'} · {rgbText(ray.direction)}</summary>
            <p>{ray.hit ? `Hit ${rgbText(ray.hit.point)} · material ${ray.hit.material} · reflectance ${rgbText(ray.hit.reflectance)} · sun ${ray.solarVisible ? 'visible' : 'absent'}` : 'Escaped to the environment'}</p>
            <p>First contribution {rgbText(ray.first)} · second bounce {rgbText(ray.second)}</p>
            {ray.secondary.length > 0 && <ul>{ray.secondary.map((bounce, j) => <li key={j}>
              {bounce.hit ? `Hit ${rgbText(bounce.hit.point)}` : 'Environment'} · radiance {rgbText(bounce.radiance)}
            </li>)}</ul>}
          </details>
        </li>)}</ol>
      </details>
      <details><summary>Candidate influence and SH coefficients</summary>
        <p>{rgbText(rayReport.coefficients)}</p>
        <ul>{rayReport.candidates.map((candidate, i) => <li key={i}>{candidate.kind} · {candidate.id} · {numberText(candidate.score)} · {candidate.visible ? 'visible' : 'occluded'}</li>)}</ul>
      </details>
    </>}
    {hybridReport && <details open><summary>Hybrid probe {hybridReport.probe} · {numberText(hybridReport.distance)} m away</summary>
      <table><tbody>
        <tr><td>Exact first solar bounce</td><td>{rgbText(hybridReport.firstSolarIrradiance)}</td></tr>
        <tr><td>Other reflected light</td><td>{rgbText(hybridReport.otherReflectedIrradiance)}</td></tr>
        <tr><td>Total directional irradiance</td><td>{rgbText(hybridReport.irradiance)}</td></tr>
      </tbody></table>
      <details><summary>SH coefficients and strongest visible patches under fixed transfer</summary>
        <p>Coefficients {rgbText(hybridReport.coefficients)}</p>
        <p>Learned minus fixed {rgbText(hybridReport.learnedMinusFixed)}</p>
        <ul>{hybridReport.sources.map(patch => <li key={patch.patch}>Patch {patch.patch}, material {patch.material} · {rgbText(patch.position)} · {numberText(patch.meanRadiance)}</li>)}</ul>
      </details>
    </details>}
    {report && <>
      {bounces ? <>
        <table aria-label="Bounce contribution"><thead><tr><th>Light at this surface</th><th>Relative brightness</th></tr></thead><tbody>
          {bounceRows.map(([label, value, rgb]) => <tr key={label}><td>{label}</td><td><span className="gi-inspection-swatch" style={{ background: swatch(rgb) }} />{numberText(value)}</td></tr>)}
        </tbody></table>
        {bounces.gain !== null && <p>Final GI is {numberText(bounces.gain)} times the first bounce.
          {bounces.additionalPercent !== null && <> The additional bounce contributes {bounces.additionalPercent.toFixed(1)}% of the final total.</>}</p>}
        {bounces.firstBrightness === 0 && <p>{bounces.finalBrightness > 0
          ? 'The first bounce is zero here; the additional bounce supplies the final GI.' : 'No bounced light was measured at this point.'}</p>}
        <p>These estimates compare the same surface position and direction. First bounce already means reflected light; direct lamp light is excluded. Values are linear, before textures and exposure, and are not lux.</p>
      </> : <p>First-bounce data is unavailable for this bake.</p>}
      <details><summary>Sampling checks and RGB values</summary>
      <table><tbody>{rows.map(([label, rgb]) => <tr key={label}><td>{label}</td><td><span className="gi-inspection-swatch" style={{ background: swatch([...rgb]) }} />{rgbText([...rgb])}</td></tr>)}</tbody></table>
      <p>Sample offset: {(report.bias * 100).toFixed(1)} cm. Values show probe light in the surface direction, before material textures.</p>
      {report.floorLayer && <p>Visible probe support: {report.exactAtSurface.support.toFixed(4)}. Floor confidence: {(report.exactAtSurface.confidence * 100).toFixed(1)}%.</p>}
      <p>Differences between Displayed GI and the exact blends can reveal filtering or sample-offset effects.</p>
      </details>
      <details><summary>Nearby probes, evaluated in the surface direction</summary><table><thead><tr><th>Probe</th><th>Light</th><th>Visible</th></tr></thead><tbody>
        {report.probes.map(probe => <tr key={probe.index}><td>{probe.index} · {probe.distance.toFixed(2)} m</td><td><span className="gi-inspection-swatch" style={{ background: swatch(probe.finalRGB) }} />{rgbText(probe.finalRGB)}</td><td>{probe.visibleAtSurface ? 'Yes' : 'No'}</td></tr>)}
      </tbody></table></details>
    </>}
    {(report || hybridReport || rayReport) && <button type="button" onClick={download}>Download report</button>}
  </section></Html>
}
