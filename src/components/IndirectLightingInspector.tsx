/* eslint-disable react-hooks/immutability -- Inspection reads live Three.js scene resources. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, InstancedMesh, Matrix3, Matrix4, Mesh, MeshStandardMaterial, Raycaster, Vector2, Vector3 } from 'three'
import { serializeIndirectField, type IndirectField } from '../indirectLighting'
import { snapshotIndirectGeometry } from '../indirectVisibility'
import type { IndirectPointInspection } from '../indirectLightingDiagnostic'
import type { IndirectInspectionRequest } from '../indirectLightingDiagnostic.worker'

type Snapshot = { field: IndirectField; generation: number; ready: boolean; direct?: Uint16Array[];
  lights: { position: number[]; color: string }[] }
const rgbText = (rgb: number[]) => rgb.map(value => value.toFixed(3)).join(', ')
const swatch = (rgb: number[]) => {
  // A shared compression makes colours comparable without clipping high irradiance.
  const c = new Color().setRGB(...rgb.map(value => value / (1 + value)) as [number, number, number]).convertLinearToSRGB()
  return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`
}

/** Pick a receiver and inspect its immutable lighting snapshot in a separate worker. */
export function IndirectLightingInspector({ enabled, snapshot }: { enabled: boolean; snapshot: () => Snapshot }) {
  const { camera, gl, scene } = useThree()
  const latest = useRef(snapshot)
  useLayoutEffect(() => { latest.current = snapshot }, [snapshot])
  const [report, setReport] = useState<IndirectPointInspection | null>(null)
  const [message, setMessage] = useState('Click the orange carpet patch to inspect its lighting.')
  const [busy, setBusy] = useState(false)
  const reportGeneration = useRef(-1)
  const liveGeneration = useRef(-1)
  useFrame(() => {
    liveGeneration.current = latest.current().generation
    if (reportGeneration.current >= 0 && reportGeneration.current !== liveGeneration.current) {
      reportGeneration.current = -1; setReport(null); setMessage('Lighting changed. Click the carpet again to inspect the new bake.')
    }
  })
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let activeWorker: Worker | null = null, sequence = 0
    const previousCursor = gl.domElement.style.cursor
    gl.domElement.style.cursor = 'crosshair'
    const inspect = (point: Vector3, normal: Vector3) => {
      const current = latest.current()
      if (!current.ready || gl.xr.isPresenting) { setMessage('Wait for GI ready, then click the carpet.'); return }
      const request = ++sequence
      activeWorker?.terminate()
      const diagnostic = new Worker(new URL('../indirectLightingDiagnostic.worker.ts', import.meta.url), { type: 'module' })
      activeWorker = diagnostic
      setBusy(true); setReport(null); setMessage('Comparing the lighting at this point…')
      diagnostic.onmessage = event => {
        if (disposed || request !== sequence) return
        diagnostic.terminate(); activeWorker = null; setBusy(false)
        if (current.generation !== liveGeneration.current) { setMessage('Lighting changed during inspection. Click the carpet again.'); return }
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
    if (!report) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ generation: reportGeneration.current, ...report }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'gi-point-inspection.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const rows = report ? [['Displayed GI', report.displayed.rgb], ['Exact blend at surface', report.exactAtSurface.rgb],
    ['Exact blend at shifted sample', report.exactAtShiftedSample.rgb]] as const : []
  return <Html fullscreen calculatePosition={(_, __, size) => [size.width / 2, size.height / 2]}
    onOcclude={() => {}} zIndexRange={[50, 50]} style={{ pointerEvents: 'none' }}><section className="gi-inspection-panel" aria-label="GI point inspection" aria-busy={busy}>
    <strong>GI point inspection</strong>
    <p aria-live="polite">{message}</p>
    {report && <>
      <table><tbody>{rows.map(([label, rgb]) => <tr key={label}><td>{label}</td><td><span className="gi-inspection-swatch" style={{ background: swatch([...rgb]) }} />{rgbText([...rgb])}</td></tr>)}</tbody></table>
      <p>Sample offset: {(report.bias * 100).toFixed(1)} cm. Values show probe light in the surface direction, before material textures.</p>
      {report.floorLayer && <p>Visible probe support: {report.exactAtSurface.support.toFixed(4)}. Floor confidence: {(report.exactAtSurface.confidence * 100).toFixed(1)}%.</p>}
      <p>Orange only in Displayed GI points to volume filtering. Orange at the shifted sample but less at the surface points to the offset. Orange in all three needs a capture or bounce check.</p>
      <details><summary>Nearby probes, evaluated in the surface direction</summary><table><thead><tr><th>Probe</th><th>Light</th><th>Visible</th></tr></thead><tbody>
        {report.probes.map(probe => <tr key={probe.index}><td>{probe.index} · {probe.distance.toFixed(2)} m</td><td><span className="gi-inspection-swatch" style={{ background: swatch(probe.finalRGB) }} />{rgbText(probe.finalRGB)}</td><td>{probe.visibleAtSurface ? 'Yes' : 'No'}</td></tr>)}
      </tbody></table></details>
      <button type="button" onClick={download}>Download report</button>
    </>}
  </section></Html>
}
