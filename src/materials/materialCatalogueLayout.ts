import type { SurfaceMaterialProduct } from '../types.ts'
import { isLocalMaterial } from './localMaterials.ts'
import { normalizeMaterialFolder } from './materialFolderPath.ts'

type Entry = { folder?: string; removed?: boolean }
export type MaterialCatalogueLayout = { folders: string[]; entries: Record<string, Entry> }
export const emptyMaterialCatalogue: MaterialCatalogueLayout = { folders: [], entries: {} }

export type MaterialCatalogueChange =
  | { action: 'create-folder' | 'delete-folder'; path: string }
  | { action: 'move-folder'; from: string; to: string }
  | { action: 'move-material'; id: string; folder: string }
  | { action: 'set-removed'; id: string; removed: boolean }

const title = (value: string) => value.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
const categoryNames: Record<string, string> = { brick: 'Bricks', bricks: 'Bricks', paint: 'Paint',
  flooring: 'Flooring', 'wall-covering': 'Wall coverings', tile: 'Tiles', ceiling: 'Ceilings', worktop: 'Worktops' }

function isCatalogueMaterialId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z\d][a-z\d_-]{0,159}$/i.test(id) && !Object.hasOwn(Object.prototype, id)
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const within = (path: string, parent: string) => same(path, parent) || path.toLowerCase().startsWith(parent.toLowerCase() + '/')

export function getMaterialCatalogueFolder(material: SurfaceMaterialProduct, layout: MaterialCatalogueLayout) {
  const folder = layout.entries[material.id]?.folder ?? material.catalogueFolder
  if (folder !== undefined) return folder
  const type = material.materialType || material.category
  const key = type.toLowerCase()
  return [Object.hasOwn(categoryNames, key) ? categoryNames[key] : title(type), material.manufacturer, material.collection]
    .map(part => part?.replace(/[/\\]/g, ' - ').replace(/[\x00-\x1f]/g, ' ').slice(0, 80).trim()) // eslint-disable-line no-control-regex
    .filter(part => part && part !== '.' && part !== '..').join('/')
}

function parseFolder(value: unknown) {
  if (typeof value !== 'string') return undefined
  try { return normalizeMaterialFolder(value) } catch { return undefined }
}

export function readMaterialCatalogueLayout(value: unknown): MaterialCatalogueLayout {
  if (!value || typeof value !== 'object') return emptyMaterialCatalogue
  const { folders, entries } = value as Partial<MaterialCatalogueLayout>
  const paths = Array.isArray(folders) ? folders.flatMap(path => parseFolder(path) || []) : []
  return {
    folders: paths,
    entries: Object.fromEntries(entries && typeof entries === 'object' ? Object.entries(entries).flatMap(([id, entry]) => {
      if (!isCatalogueMaterialId(id) || !entry || typeof entry !== 'object') return []
      const folder = parseFolder(entry.folder)
      return [[id, { ...(folder !== undefined && { folder }), ...(entry.removed === true && { removed: true }) }]]
    }) : []),
  }
}

export function getCatalogueFolderPaths(layout: MaterialCatalogueLayout, materials: SurfaceMaterialProduct[]) {
  const paths = new Map<string, string>()
  const add = (path: string) => {
    let parent = ''
    for (const segment of path.split('/').filter(Boolean)) {
      const candidate = parent ? `${parent}/${segment}` : segment
      const key = candidate.toLowerCase()
      parent = paths.get(key) ?? candidate
      paths.set(key, parent)
    }
  }
  layout.folders.forEach(add)
  for (const material of materials) {
    if (!isLocalMaterial(material) && !layout.entries[material.id]?.removed) add(getMaterialCatalogueFolder(material, layout))
  }
  return [...paths.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/** Apply a whole folder move to one current snapshot, including archived materials. */
export function changeMaterialCatalogue(layout: MaterialCatalogueLayout, materials: SurfaceMaterialProduct[], value: unknown) {
  const change = value as MaterialCatalogueChange | null
  const entries = { ...layout.entries }
  let folders = [...layout.folders]
  const publicMaterials = materials.filter(material => !isLocalMaterial(material))
  const paths = getCatalogueFolderPaths(layout, publicMaterials)
  const hasPath = (path: string) => paths.some(existing => same(existing, path))
  const requireFolder = (value: unknown, allowRoot = false) => {
    const path = parseFolder(value)
    if (path === undefined || (!allowRoot && !path)) throw new Error('Enter a valid catalogue folder path.')
    return path
  }

  switch (change?.action) {
    case 'create-folder': {
      const path = requireFolder(change.path)
      if (hasPath(path)) throw new Error('A folder with that path already exists.')
      folders.push(path)
      break
    }
    case 'move-folder': {
      const from = requireFolder(change.from), to = requireFolder(change.to)
      if (!hasPath(from)) throw new Error('The source folder is no longer available.')
      if (to === from) return layout
      if (!same(to, from) && (within(to, from) || hasPath(to))) throw new Error('Choose a new folder path outside the folder being moved.')
      const move = (path: string) => requireFolder(to + path.slice(from.length))
      const publicIds = new Set(publicMaterials.map(material => material.id))
      folders = folders.map(path => within(path, from) ? move(path) : path)
      if (!folders.some(path => same(path, to))) folders.push(to)
      for (const material of publicMaterials) {
        const path = getMaterialCatalogueFolder(material, layout)
        if (within(path, from)) entries[material.id] = { ...entries[material.id], folder: move(path) }
      }
      for (const [id, entry] of Object.entries(layout.entries)) {
        if (!publicIds.has(id) && entry.folder && within(entry.folder, from)) {
          entries[id] = { ...entry, folder: move(entry.folder) }
        }
      }
      break
    }
    case 'delete-folder': {
      const path = requireFolder(change.path)
      if (!hasPath(path)) throw new Error('That folder is no longer available.')
      if (publicMaterials.some(material => !entries[material.id]?.removed && within(getMaterialCatalogueFolder(material, layout), path))) {
        throw new Error('Move or remove the materials in this folder before deleting it.')
      }
      folders = folders.filter(folder => !within(folder, path))
      break
    }
    case 'move-material':
    case 'set-removed': {
      if (!isCatalogueMaterialId(change.id) || !publicMaterials.some(material => material.id === change.id)) {
        throw new Error('That public material is no longer available.')
      }
      if (change.action === 'move-material') {
        const folder = requireFolder(change.folder, true)
        entries[change.id] = { ...entries[change.id], folder }
        if (folder && !hasPath(folder)) folders.push(folder)
      } else {
        if (typeof change.removed !== 'boolean') throw new Error('Choose whether to remove or restore the material.')
        entries[change.id] = { ...entries[change.id], removed: change.removed }
      }
      break
    }
    default: throw new Error('Choose a catalogue change.')
  }
  return { folders, entries } satisfies MaterialCatalogueLayout
}
