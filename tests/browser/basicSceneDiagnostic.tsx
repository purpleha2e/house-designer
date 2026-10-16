import { loadPortalCatalog } from '../../src/portalCatalog'
import { registerRuntimeSurfaceMaterials } from '../../src/materials/materialCatalog'
import { createRoot } from 'react-dom/client'
import { _roots } from '@react-three/fiber'
import { ThreeDView } from '../../src/components/ThreeDView'
import { basicSceneReport, opaqueMaterialDiagnostic, pbrMaterialDiagnostic, updateBasicSceneReport } from '../../src/basicSceneDiagnostic'
import { modelsById, registerRuntimeModels } from '../../src/models/modelLibrary'
import { normalizeFloor } from '../../src/modelPlacement'
import type { PublishedHouse } from '../../src/viewer/viewerProject'
import '../../src/App.css'

const root = createRoot(document.getElementById('root')!)
const noop = () => {}
let revision = 0
const applicationReadyMs = performance.now()
const progressive = new URLSearchParams(location.search).has('progressive')
const noSavedLighting = new URLSearchParams(location.search).has('no-saved-lighting')
const mode = pbrMaterialDiagnostic ? 'pbr-materials' : opaqueMaterialDiagnostic ? 'opaque-materials' : 'basic'
document.querySelector('#report h1')!.textContent = pbrMaterialDiagnostic ? 'Opaque PBR load diagnostic' : opaqueMaterialDiagnostic ? 'Opaque material load diagnostic' : 'Basic geometry load diagnostic'
document.querySelector('#report h1 + div')!.textContent = pbrMaterialDiagnostic
  ? 'Opaque PBR maps + fixed unshadowed lighting. No GI, reflections, transparency, or postprocessing.'
  : opaqueMaterialDiagnostic
  ? 'Opaque colours + base textures. No lights, shadows, GI, transparency, or postprocessing.'
  : 'One opaque shader. No textures, lights, shadows, GI, or postprocessing.'
for (const [name, parameter] of [['Basic shader', ''], ['Opaque colours', 'opaque-materials'], ['Opaque PBR', 'pbr-materials']]) {
  const link = document.createElement('a'), url = new URL(location.href)
  url.searchParams.delete('progressive'); url.searchParams.set('basic-scene', '')
  url.searchParams.delete('opaque-materials'); url.searchParams.delete('pbr-materials')
  if (parameter) url.searchParams.set(parameter, '')
  link.href = url.href; link.textContent = name
  link.style.cssText = 'display:inline-block;color:#9ed4ff;margin:10px 12px 0 0'
  document.getElementById('report')!.append(link)
}
function report() {
  const r = basicSceneReport, ms = (n?: number) => n === undefined ? '…' : `${n.toFixed(1)} ms`
  document.getElementById('timings')!.textContent = [
    `Application code ready: ${ms(applicationReadyMs)} (outside model timer)`,
    `Read/fetch JSON:        ${ms(r.readMs)}`,
    `Parse JSON:            ${ms(r.parseMs)}`,
    ...(opaqueMaterialDiagnostic ? [`Material catalog:      ${ms(r.catalogMs)}`] : []),
    `Normalize/register:    ${ms(r.normalizeMs)}`,
    `Meshes + model assets: ${ms(r.geometryReadyMs)}`,
    `Readiness check:       ${ms(r.settledMs)}`,
    `Basic draw snapshot:   ${ms(r.snapshotMs)}`,
    `First draw CPU call:   ${ms(r.drawMs)}`,
    `JSON start → draw:     ${ms(r.firstFrameMs)}`,
    `JSON start → GPU done: ${ms(r.gpuCompleteMs)}`,
    `Meshes: ${r.meshes ?? '…'} · triangles: ${r.triangles ?? '…'}`,
    `GPU programs: ${r.programs ?? '…'} · textures: ${r.textures ?? '…'}`,
    ...(pbrMaterialDiagnostic ? [`Mapped materials: normal ${r.mapUsage?.normalMap ?? 0}, roughness ${r.mapUsage?.roughnessMap ?? 0}, metal ${r.mapUsage?.metalnessMap ?? 0}, AO ${r.mapUsage?.aoMap ?? 0}`] : []),
    r.error ? `ERROR: ${r.error}` : r.firstFrameMs ? 'Basic scene displayed. Drag to look; WASD to move.' : `Waiting: ${r.pending?.join(', ') || 'model data / scene setup'}`,
  ].join('\n')
}
window.addEventListener('basic-scene-report', report)
Object.assign(window, { basicSceneState: () => [..._roots.values()][0]?.store.getState() })

async function load(read: () => Promise<string>) {
  // File picker dwell time is deliberately outside the read timer.
  root.render(null)
  for (const key of Object.keys(basicSceneReport)) delete (basicSceneReport as unknown as Record<string, unknown>)[key]
  updateBasicSceneReport({ mode, startedAt: performance.now(), pending: ['read-json'] })
  try {
    const text = await read()
    updateBasicSceneReport({ readMs: performance.now() - basicSceneReport.startedAt })
    const parseStart = performance.now()
    const project = JSON.parse(text) as PublishedHouse['project']
    updateBasicSceneReport({ parseMs: performance.now() - parseStart })
    if (!Array.isArray(project.floors) || !project.floors.length) throw new Error('No floors in this project')
    if (opaqueMaterialDiagnostic || progressive) {
      const start = performance.now()
      const catalog = await loadPortalCatalog()
      registerRuntimeSurfaceMaterials(catalog.materials)
      updateBasicSceneReport({ catalogMs: performance.now() - start })
    }
    const normalizeStart = performance.now()
    registerRuntimeModels(project.modelDefinitions ?? [])
    const floors = project.floors.map(floor => normalizeFloor(floor, modelsById))
    const activeFloorId = project.activeFloorId ?? floors[0].id
    const camera = project.threeDView?.camera ?? { position: { x: 10, y: 8, z: 10 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
    updateBasicSceneReport({ normalizeMs: performance.now() - normalizeStart, mountedAt: performance.now() })
    root.render(<ThreeDView savedIndirectLighting={progressive && !noSavedLighting ? project.indirectLighting : undefined} key={++revision} readOnly viewerMode="walk"
      activeFloorId={activeFloorId} floors={floors} cameraRestoreRevision={revision} cameraViewState={camera}
      isEngineConsoleOpen={false} lightDirection={project.sunPosition ?? { azimuth: 135, elevation: 35 }}
      modelAssetVersion={1} sceneRevision={revision} showAllFloors surfaceAssignments={project.surfaceAssignments ?? []}
      onCameraViewStateChange={noop} onClearSelection={noop} onEngineConsoleOpenChange={noop}
      onLightDirectionChange={noop} onSelectFloor={noop} onSelectModel={noop} onSelectRoof={noop}
      onSelectSurface={noop} onUpdateModel={noop} selectedModelId={null} selectedRoofId={null}
      selectedSurface={null} selectedWallId={null} />)
  } catch (error) { updateBasicSceneReport({ error: String(error) }) }
}
document.getElementById('open')!.onclick = () => document.getElementById('file')!.click()
document.getElementById('file')!.onchange = event => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) void load(() => file.text())
}
void load(async () => {
  const response = await fetch(new URLSearchParams(location.search).get('project') ?? '/colin_house_v2.json')
  if (!response.ok) throw new Error(`Project fetch failed: ${response.status}`)
  return response.text()
})

if (progressive) {
  document.querySelector('#report h1')!.textContent = 'Progressive scene startup'
  document.querySelector('#report h1 + div')!.textContent = 'Opaque PBR first; lighting prepares while you navigate.'
  setInterval(() => {
    const s = [..._roots.values()][0]?.store.getState()
    document.getElementById('timings')!.textContent = JSON.stringify(s?.scene.userData.progressiveStartup ?? { phase: 'geometry' }, null, 2)
  }, 250)
}
