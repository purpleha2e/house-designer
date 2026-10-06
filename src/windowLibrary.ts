import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { ModelDefinition } from './models/modelLibrary'
import { createWindowGeometry, disposeWindowGeometry } from './windowGeometry'
import { validateWindowDesign, windowThumbnail, type WindowDesign } from './windowDesign'

export function windowDefinition(id: string, name: string, design: WindowDesign): ModelDefinition {
  const error = validateWindowDesign(design)
  if (error) throw new Error(error)
  return { id, name: name.trim() || 'Custom window', category: 'My windows', objectType: 'window',
    wallMount: 'window', shape: 'box', color: design.color, width: design.width,
    height: design.height, depth: design.depth, windowDesign: structuredClone(design),
    localBounds: { minX: -design.width/2, maxX: design.width/2, minZ: 0, maxZ: design.depth },
    previewUrl: windowThumbnail(design) }
}

export async function exportWindowGlb(design: WindowDesign): Promise<Blob> {
  const error = validateWindowDesign(design)
  if (error) throw new Error(error)
  const group = createWindowGeometry(design)
  try {
    const data = await new GLTFExporter().parseAsync(group, { binary: true })
    return new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' })
  } finally { disposeWindowGeometry(group) }
}

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('house-designer-windows', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('windows', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadWindowLibrary(): Promise<ModelDefinition[]> {
  const db = await openLibrary()
  try {
    const records = await new Promise<{ id: string; name: string; design: WindowDesign }[]>((resolve, reject) => {
      const request = db.transaction('windows').objectStore('windows').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return records.filter(r => typeof r.id === 'string' && !validateWindowDesign(r.design))
      .map(r => windowDefinition(r.id, r.name, r.design))
  } finally { db.close() }
}

let libraryWrites: Promise<void> = Promise.resolve()

export function saveWindowToLibrary(definition: ModelDefinition): Promise<void> {
  const snapshot = structuredClone(definition)
  const write = libraryWrites.catch(() => undefined).then(() => writeWindow(snapshot))
  libraryWrites = write
  return write
}

export function removeWindowsFromLibrary(ids: string[]): Promise<void> {
  const write = libraryWrites.catch(() => undefined).then(async () => {
    if (!ids.length) return
    const db = await openLibrary()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('windows', 'readwrite')
        ids.forEach(id => tx.objectStore('windows').delete(id))
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  })
  libraryWrites = write
  return write
}

async function writeWindow(definition: ModelDefinition) {
  if (!definition.windowDesign) return
  const glb = await exportWindowGlb(definition.windowDesign)
  const db = await openLibrary()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('windows', 'readwrite')
      tx.objectStore('windows').put({ id: definition.id, name: definition.name, design: definition.windowDesign, glb })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('Could not save the window library.'))
    })
  } finally { db.close() }
}

export async function downloadWindowGlb(design: WindowDesign, name: string) {
  const url = URL.createObjectURL(await exportWindowGlb(design))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'window'}.glb`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
