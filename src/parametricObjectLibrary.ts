import { modelLibrary, modelsById, type ModelDefinition } from './models/modelLibrary'

export function registerParametricModels(models: ModelDefinition[], remove?: (model: ModelDefinition) => boolean) {
  if (!models.length && !remove) return
  const ids = new Set(models.map(model => model.id))
  const remaining = modelLibrary.filter(model => {
    if (!ids.has(model.id) && !remove?.(model)) return true
    modelsById.delete(model.id)
    return false
  })
  modelLibrary.splice(0, modelLibrary.length, ...remaining, ...models)
  for (const model of models) modelsById.set(model.id, model)
}

export function createParametricObjectLibrary<Design>(database: string, storeName: string,
  validate: (design: unknown) => string | null, definition: (id: string, name: string, design: Design) => ModelDefinition) {
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(database, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  let writes: Promise<void> = Promise.resolve()
  function write(update: (store: IDBObjectStore) => void) {
    const result = writes.catch(() => undefined).then(async () => {
      const db = await open()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite')
          update(tx.objectStore(storeName))
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error ?? new Error('Could not save the object library.'))
        })
      } finally { db.close() }
    })
    writes = result
    return result
  }

  return {
    async load(): Promise<ModelDefinition[]> {
      const db = await open()
      try {
        const records = await new Promise<{ id: string; name: string; design: Design }[]>((resolve, reject) => {
          const request = db.transaction(storeName).objectStore(storeName).getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        return records.filter(record => typeof record.id === 'string' && typeof record.name === 'string' && !validate(record.design))
          .map(record => definition(record.id, record.name, record.design))
      } finally { db.close() }
    },
    save(id: string, name: string, design: Design | undefined) {
      const error = validate(design)
      if (error) return Promise.reject(new Error(error))
      const snapshot = structuredClone(design)
      return write(store => { store.put({ id, name, design: snapshot }) })
    },
    remove(ids: string[]) {
      return ids.length ? write(store => { ids.forEach(id => store.delete(id)) }) : Promise.resolve()
    },
  }
}
