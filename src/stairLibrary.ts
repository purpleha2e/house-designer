import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { Mesh, WebGLRenderer, type MeshStandardMaterial, type Object3D, type Texture } from 'three'
import { decompress } from 'three/examples/jsm/utils/WebGLTextureUtils.js'
import { modelLibrary, modelsById, type ModelDefinition, type ModelMaterialRegion } from './models/modelLibrary'
import { getStairFinish, getStairLayout, stairParts, stairPartLabels, stairThumbnail, validateStairDesign, type StairDesign } from './stairDesign'
import { createStairGeometry, disposeStairGeometry } from './stairGeometry'
import { surfaceMaterialsById } from './materials/materialCatalog'

export const parametricStairMaterialRegions: ModelMaterialRegion[] = stairParts.map(part => ({
  id: `stairs_${part}`, label: stairPartLabels[part], sourceMaterialNames: [`stairs_${part}`],
}))

export function stairDefinition(id: string, name: string, design: StairDesign): ModelDefinition {
  const error = validateStairDesign(design)
  if (error) throw new Error(error)
  const layout = getStairLayout(design), first = layout.flights[0].left, last = layout.flights.at(-1)!.left
  const direction = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1
    return { x: (b.x - a.x) / length, y: (b.z - a.z) / length }
  }
  return { id, name: name.trim() || 'Custom stairs', category: 'My stairs', objectType: 'stairs', shape: 'box',
    color: design.finishes.treads.color, width: layout.bounds.maxX - layout.bounds.minX,
    depth: layout.bounds.maxZ - layout.bounds.minZ, height: design.totalRise,
    stairDesign: structuredClone(design), localBounds: layout.bounds,
    materialRegions: parametricStairMaterialRegions,
    stairLandings: { lower: { x: layout.lower.x, y: layout.lower.z }, upper: { x: layout.upper.x, y: layout.upper.z } },
    stairLandingDirections: { lower: direction(first[0], first.at(-1)!), upper: direction(last.at(-1)!, last[0]) },
    stairFootprint: design.layout === 'l' ? layout.footprints.map(polygon => polygon.map(p => ({ x: p.x, y: p.z }))) : undefined,
    previewUrl: stairThumbnail(design) }
}

/** Replaces personal stair varieties without affecting imported models or windows. */
export function registerStairModels(models: ModelDefinition[], replace = false) {
  const ids = new Set(models.map(m => m.id))
  const removed = modelLibrary.filter(m => ids.has(m.id) || (replace && m.stairDesign))
  removed.forEach(m => modelsById.delete(m.id))
  modelLibrary.splice(0, modelLibrary.length, ...modelLibrary.filter(m => !removed.includes(m)), ...models)
  models.forEach(m => modelsById.set(m.id, m))
}

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('house-designer-stairs', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('stairs', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function loadStairLibrary(): Promise<ModelDefinition[]> {
  const db = await openLibrary()
  try {
    const records = await new Promise<{ id: string; name: string; design: StairDesign }[]>((resolve, reject) => {
      const r = db.transaction('stairs').objectStore('stairs').getAll()
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
    return records.filter(r => typeof r.id === 'string' && !validateStairDesign(r.design)).map(r => stairDefinition(r.id, r.name, r.design))
  } finally { db.close() }
}
let writes: Promise<void> = Promise.resolve()
function writeLibrary(callback: (store: IDBObjectStore) => void) {
  const work = writes.catch(() => undefined).then(async () => {
    const db = await openLibrary()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('stairs', 'readwrite')
        callback(tx.objectStore('stairs'))
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  })
  writes = work
  return work
}
export function saveStairToLibrary(definition: ModelDefinition) {
  const record = { id: definition.id, name: definition.name, design: structuredClone(definition.stairDesign) }
  const error = validateStairDesign(record.design)
  if (error) return Promise.reject(new Error(error))
  return writeLibrary(store => { store.put(record) })
}
export function removeStairsFromLibrary(ids: string[]) {
  return ids.length ? writeLibrary(store => { ids.forEach(id => store.delete(id)) }) : Promise.resolve()
}
export async function downloadStairGlb(design: StairDesign, name: string, preview?: Object3D | null) {
  const error = validateStairDesign(design)
  if (error) throw new Error(error)
  for (const part of stairParts) {
    const id = getStairFinish(design, part).materialId
    if (!id) continue
    const product = surfaceMaterialsById.get(id), mesh = preview?.getObjectByName(`stair-${part}`)
    if (!mesh) continue // An optional part may be switched off.
    if (!product || !(mesh instanceof Mesh)) throw new Error('The selected material is unavailable.')
    const material = mesh.material as MeshStandardMaterial
    const required = [[product.pbr.baseColorTextureUrl, material.map], [product.pbr.normalTextureUrl, material.normalMap],
      [product.pbr.roughnessTextureUrl, material.roughnessMap], [product.pbr.metalnessTextureUrl, material.metalnessMap],
      [product.pbr.ambientOcclusionTextureUrl, material.aoMap]]
    if (required.some(([url, texture]) => url && !texture)) throw new Error('The material textures are still loading. Try the export again in a moment.')
  }
  const object = preview ?? createStairGeometry(design)
  const exportRenderer: { current: WebGLRenderer | null } = { current: null }
  const readable = new Map<Texture, Texture>()
  try {
    const exporter = new GLTFExporter().setTextureUtils({ decompress: (texture, maxTextureSize) => {
      const cached = readable.get(texture)
      if (cached) return cached
      exportRenderer.current ??= new WebGLRenderer({ antialias: false })
      const result = decompress(texture, maxTextureSize, exportRenderer.current)
      readable.set(texture, result)
      return result
    } })
    const data = await exporter.parseAsync(object, { binary: true, onlyVisible: true })
    const url = URL.createObjectURL(new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' }))
    const link = document.createElement('a'); link.href = url
    link.download = `${name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'stairs'}.glb`
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  } finally {
    readable.forEach(texture => texture.dispose())
    exportRenderer.current?.forceContextLoss(); exportRenderer.current?.dispose()
    if (!preview) disposeStairGeometry(object as ReturnType<typeof createStairGeometry>)
  }
}
