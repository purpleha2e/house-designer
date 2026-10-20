import { useEffect, useSyncExternalStore } from 'react'
import { defaultMaterialFolders, mergeMaterialFolders } from './materialFolders'

let folders = defaultMaterialFolders
let loading: Promise<void> | undefined
let writes = Promise.resolve()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const snapshot = () => folders
const publish = (next: string[]) => { folders = next; listeners.forEach(listener => listener()) }

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('house-designer-material-folders', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('settings')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function load() {
  loading ??= (async () => {
    const db = await database()
    try {
      const stored = await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction('settings').objectStore('settings').get('folders')
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      if (Array.isArray(stored) && stored.every(path => typeof path === 'string')) publish(mergeMaterialFolders(stored))
    } finally { db.close() }
  })()
  return loading
}

export function createMaterialFolder(path: string) {
  const write = writes.catch(() => undefined).then(async () => {
    await load()
    const next = mergeMaterialFolders([...folders, path])
    const db = await database()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite')
        tx.objectStore('settings').put(next, 'folders')
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
      })
      publish(next)
    } finally { db.close() }
  })
  writes = write
  return write
}

export function useMaterialFolders() {
  const current = useSyncExternalStore(subscribe, snapshot)
  useEffect(() => { void load().catch(error => console.warn('Could not read material folders:', error)) }, [])
  return current
}
