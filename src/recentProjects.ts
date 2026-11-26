import { useEffect, useSyncExternalStore } from 'react'

export type ProjectFileHandle = {
  name?: string
  getFile: () => Promise<File>
  createWritable: () => Promise<{ close: () => Promise<void>; write: (data: BlobPart) => Promise<void> }>
  isSameEntry?: (other: ProjectFileHandle) => Promise<boolean>
  requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState>
}
export type LoadedProjectFile = { contents: string; fileName: string; handle?: ProjectFileHandle }
export type RecentProject = LoadedProjectFile & { id: string }

let recent: RecentProject[] = []
let loading: Promise<void> | undefined
let writes = Promise.resolve()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const snapshot = () => recent
const publish = (entries: RecentProject[]) => { recent = entries; listeners.forEach(listener => listener()) }

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('house-designer-recent-projects', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('settings')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function load() {
  loading ??= (async () => {
    const db = await database()
    try {
      const entries = await new Promise<RecentProject[] | undefined>((resolve, reject) => {
        const request = db.transaction('settings').objectStore('settings').get('recent')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      if (Array.isArray(entries)) publish(entries.filter(entry => entry && typeof entry.id === 'string' &&
        typeof entry.fileName === 'string' && typeof entry.contents === 'string').slice(0, 3))
    } finally { db.close() }
  })().catch(error => console.warn('Could not read recent models:', error))
  return loading
}

/** Store the bytes from a validated load or a completed device save. */
export function rememberRecentProject(file: LoadedProjectFile, existingId?: string) {
  const write = writes.catch(() => undefined).then(async () => {
    await load()
    let match = recent.find(entry => entry.id === existingId)
    if (!match) for (const entry of recent) {
      if (file.handle && entry.handle) {
        try { if (await file.handle.isSameEntry?.(entry.handle)) { match = entry; break } } catch { /* Stale handle. */ }
      } else if (!file.handle && !entry.handle && entry.fileName === file.fileName) {
        match = entry; break
      }
    }
    const next = [{ ...file, id: match?.id ?? crypto.randomUUID() }, ...recent.filter(entry => entry !== match)].slice(0, 3)
    try {
      const db = await database()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('settings', 'readwrite')
          tx.objectStore('settings').put(next, 'recent')
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error ?? new Error('Could not store recent models.'))
        })
      } finally { db.close() }
    } finally {
      // Publish after committing so an immediate refresh retains the list.
      // The current session also remains usable if storage is unavailable.
      publish(next)
    }
  })
  writes = write
  return write
}

export async function readRecentProject(entry: RecentProject): Promise<LoadedProjectFile> {
  if (!entry.handle) return { contents: entry.contents, fileName: entry.fileName }
  // Request directly from the menu click, while browser user activation is live.
  if (entry.handle.requestPermission && await entry.handle.requestPermission({ mode: 'read' }) !== 'granted') {
    throw new Error('File access was not granted. Use Load to select the model again.')
  }
  try {
    const file = await entry.handle.getFile()
    return { contents: await file.text(), fileName: file.name, handle: entry.handle }
  } catch {
    throw new Error('The recent file is unavailable. It may have been moved or deleted. Use Load to select it again.')
  }
}

export function useRecentProjects() {
  const entries = useSyncExternalStore(subscribe, snapshot)
  useEffect(() => { void load() }, [])
  return entries
}
