export type ObjectCatalogueEntry = { folder?: string; removed?: boolean; published?: boolean }
export type ObjectCatalogue = Record<string, ObjectCatalogueEntry>

export const objectBuilderOptions = [
  { type: 'stairs', section: 'objects', label: 'Build stairs', folder: 'Stairs' },
  { type: 'picture-frame', section: 'objects', label: 'Build a picture frame', folder: 'Decoration/Picture frames' },
  { type: 'kitchen-unit', section: 'objects', label: 'Build a kitchen unit', folder: 'Kitchen/Cabinets' },
  { type: 'windows', section: 'openings', label: 'Build a window', folder: 'Windows' },
  { type: 'doors', section: 'openings', label: 'Build a door', folder: 'Interior doors' },
] as const
export type ObjectBuilderType = typeof objectBuilderOptions[number]['type']
export const personalCatalogueKey = 'houseDesignerPersonalObjectCatalogue'

export function normalizeObjectFolder(value: string) {
  return value.split('/').map(part => part.trim()).filter(Boolean).join('/')
}

export function readObjectCatalogueEntry(value: unknown): ObjectCatalogueEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { folder, removed, published } = value as ObjectCatalogueEntry
  if ((folder !== undefined && (typeof folder !== 'string' || folder.length > 240)) ||
    (removed !== undefined && typeof removed !== 'boolean') ||
    (published !== undefined && typeof published !== 'boolean')) return undefined
  return { ...(folder !== undefined && { folder: normalizeObjectFolder(folder) }),
    ...(removed !== undefined && { removed }), ...(published !== undefined && { published }) }
}

export function readObjectCatalogue(value: unknown): ObjectCatalogue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([id, entry]) => {
    const normalized = readObjectCatalogueEntry(entry)
    return isObjectCatalogueId(id) && normalized ? [[id, normalized]] : []
  }))
}

export function isObjectCatalogueId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z\d][a-z\d_-]{0,159}$/i.test(id) &&
    !Object.hasOwn(Object.prototype, id)
}
