import type { SurfaceMaterialProduct } from '../types.ts'
import { normalizeMaterialFolder } from './materialFolderPath.ts'

export const localMaterialPrefix = 'local-material-'
export const materialMapSlots = [
  { key: 'baseColorTextureUrl', label: 'Base colour', help: 'The colour or pattern of the surface.' },
  { key: 'normalTextureUrl', label: 'Normal', help: 'Fine surface detail. Use an OpenGL normal map, or flip its green channel below.' },
  { key: 'roughnessTextureUrl', label: 'Roughness', help: 'Black is smooth; white is rough. Multiplied by the roughness setting.' },
  { key: 'metalnessTextureUrl', label: 'Metalness', help: 'White is metal; black is non-metal. Multiplied by the metalness setting.' },
  { key: 'ambientOcclusionTextureUrl', label: 'Ambient occlusion', help: 'Shading in small creases and cavities.' },
  { key: 'displacementTextureUrl', label: 'Height', help: 'Moves surface vertices. Keep the height subtle; disabled on some house surfaces and in VR.' },
] as const
export type MaterialMapKey = typeof materialMapSlots[number]['key']

export function isLocalMaterial(material: SurfaceMaterialProduct) {
  return material.id.startsWith(localMaterialPrefix)
}

export function materialMapCount(material: SurfaceMaterialProduct) {
  return materialMapSlots.filter(({ key }) => material.pbr[key]).length
}

// Registering and then saving a portable material validates the same bytes
// again. Cache only successful image checks, weakly owned by its PBR record;
// metadata is always checked and a changed URL always gets a new validation.
const validatedImages = new WeakMap<object, Partial<Record<MaterialMapKey, string>>>()

/** Portable definitions contain image bytes, never a browser-session blob URL. */
export function validateLocalMaterial(value: unknown): asserts value is SurfaceMaterialProduct {
  const material = value as SurfaceMaterialProduct | null
  if (!material || typeof material.id !== 'string' || !material.id.startsWith(localMaterialPrefix) ||
    typeof material.productName !== 'string' || !material.productName.trim() ||
    typeof material.manufacturer !== 'string' ||
    !material.pbr || typeof material.pbr !== 'object' ||
    !['ceiling', 'flooring', 'paint', 'tile', 'wall-covering', 'worktop'].includes(material.category)) {
    throw new Error('This is not a saved local material.')
  }
  if (material.folder !== undefined) {
    if (typeof material.folder !== 'string') throw new Error('Invalid material folder.')
    normalizeMaterialFolder(material.folder)
  }
  for (const { key } of materialMapSlots) {
    const url = material.pbr[key]
    if (url === undefined) delete validatedImages.get(material.pbr)?.[key]
    if (url !== undefined && validatedImages.get(material.pbr)?.[key] !== url) {
      if (typeof url !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(url)) {
        throw new Error('Local material textures must contain PNG, JPEG or WebP image data.')
      }
      const cached = validatedImages.get(material.pbr) ?? {}
      cached[key] = url; validatedImages.set(material.pbr, cached)
    }
    const hash = material.pbr.textureSourceHashes?.[key]
    if (hash !== undefined && !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid texture source hash.')
  }
  for (const key of ['roughness', 'metalness', 'normalStrength', 'displacementScale',
    'realWorldWidthMeters', 'realWorldHeightMeters', 'repeatX', 'repeatY', 'rotation'] as const) {
    const number = material.pbr[key]
    if (number !== undefined && (typeof number !== 'number' || !Number.isFinite(number))) {
      throw new Error(`Invalid material setting: ${key}.`)
    }
    if (number !== undefined && key !== 'rotation' && (number < 0 ||
      (['realWorldWidthMeters', 'realWorldHeightMeters', 'repeatX', 'repeatY'].includes(key) && number === 0) ||
      (['roughness', 'metalness'].includes(key) && number > 1))) throw new Error(`Invalid material setting: ${key}.`)
  }
  if (material.pbr.baseColor !== undefined && !/^#[\da-f]{6}$/i.test(material.pbr.baseColor)) throw new Error('Choose a valid base colour.')
}

/** A real device file is the portable master; IndexedDB is only a working library. */
export async function saveMaterialToDevice(material: SurfaceMaterialProduct): Promise<'saved' | 'downloaded'> {
  validateLocalMaterial(material)
  const name = `${material.productName.replace(/[^a-z0-9_-]+/gi, '-') || 'material'}.material.json`
  const contents = JSON.stringify(material, null, 2)
  const pickerWindow = window as typeof window & { showSaveFilePicker?: (options: {
    suggestedName: string; types: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<{ createWritable: () => Promise<{ write: (value: string) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> }> }> }
  if (pickerWindow.showSaveFilePicker) {
    const handle = await pickerWindow.showSaveFilePicker({ suggestedName: name,
      types: [{ description: 'House Designer material', accept: { 'application/json': ['.json'] } }] })
    const stream = await handle.createWritable()
    try { await stream.write(contents); await stream.close() }
    catch (error) { await stream.abort?.().catch(() => undefined); throw error }
    return 'saved'
  }
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}

export async function withLocalTextureHashes(material: SurfaceMaterialProduct) {
  validateLocalMaterial(material)
  const copy = structuredClone(material)
  copy.pbr.textureSourceHashes = {}
  await Promise.all(materialMapSlots.map(async ({ key }) => {
    const url = copy.pbr[key]
    if (!url) return
    const response = await fetch(url)
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer())
    copy.pbr.textureSourceHashes![key] = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  }))
  return copy
}

/** Only materials referenced by this house travel with it, including model overrides and roofs. */
export function collectLocalMaterialDefinitions(project: unknown, materials: Iterable<SurfaceMaterialProduct>) {
  const ids = new Set<string>()
  const visit = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith(localMaterialPrefix)) ids.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(project)
  return [...materials].filter(material => ids.has(material.id)).sort((a, b) => a.id.localeCompare(b.id))
}

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('house-designer-materials', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('materials', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadLocalMaterials(): Promise<SurfaceMaterialProduct[]> {
  const db = await openLibrary()
  try {
    const records = await new Promise<SurfaceMaterialProduct[]>((resolve, reject) => {
      const request = db.transaction('materials').objectStore('materials').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return records.filter(record => { try { validateLocalMaterial(record); return true } catch { return false } })
  } finally { db.close() }
}

export async function saveLocalMaterial(material: SurfaceMaterialProduct) {
  validateLocalMaterial(material)
  const db = await openLibrary()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('materials', 'readwrite')
      tx.objectStore('materials').put(material)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('Could not save your local material.'))
    })
  } finally { db.close() }
}
