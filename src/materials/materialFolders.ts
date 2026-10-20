import type { SurfaceMaterialProduct } from '../types.ts'
import { isLocalMaterial } from './localMaterials.ts'
import { normalizeMaterialFolder } from './materialFolderPath.ts'

export const defaultMaterialFolders = ['Bricks', 'Paint', 'Metals', 'Metals/Chrome', 'Tiles', 'Wood']

export function mergeMaterialFolders(paths: string[]) {
  const result = new Map<string, string>()
  for (const path of paths) {
    const parts = normalizeMaterialFolder(path).split('/').filter(Boolean)
    let parent = ''
    for (const part of parts) {
      const candidate = parent ? `${parent}/${part}` : part
      parent = result.get(candidate.toLowerCase()) ?? candidate
      result.set(parent.toLowerCase(), parent)
    }
  }
  return [...result.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

export type MaterialFolderNode = {
  key: string
  name: string
  /** Present only on writable local folders. Empty string is the library root. */
  path?: string
  folders: MaterialFolderNode[]
  materials: SurfaceMaterialProduct[]
}

const title = (value: string) => value.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
const catalogueNames: Record<string, string> = { brick: 'Bricks', bricks: 'Bricks', paint: 'Paint',
  flooring: 'Flooring', 'wall-covering': 'Wall coverings', tile: 'Tiles', ceiling: 'Ceilings', worktop: 'Worktops' }

/** Both the editor and surface picker consume this exact library structure. */
export function buildMaterialFolderTree(materials: SurfaceMaterialProduct[], paths: string[] = []): MaterialFolderNode[] {
  const local: MaterialFolderNode = { key: 'local', name: 'My materials', path: '', folders: [], materials: [] }
  const catalogue: MaterialFolderNode = { key: 'catalogue', name: 'Catalogue', folders: [], materials: [] }
  const folder = (root: MaterialFolderNode, segments: string[]) => {
    let node = root
    for (const name of segments) {
      let child = node.folders.find(item => item.name.toLowerCase() === name.toLowerCase())
      if (!child) {
        child = { key: `${node.key}/${encodeURIComponent(name.toLowerCase())}`, name,
          ...(root === local ? { path: node.path ? `${node.path}/${name}` : name } : {}), folders: [], materials: [] }
        node.folders.push(child)
      }
      node = child
    }
    return node
  }
  for (const path of mergeMaterialFolders(paths)) folder(local, path.split('/'))
  for (const material of materials) {
    if (isLocalMaterial(material)) {
      folder(local, normalizeMaterialFolder(material.folder ?? '').split('/').filter(Boolean)).materials.push(material)
    } else {
      const type = material.materialType || material.category
      const segments = [catalogueNames[type.toLowerCase()] ?? title(type), material.manufacturer,
        material.collection].filter((value): value is string => !!value)
      folder(catalogue, segments).materials.push(material)
    }
  }
  const sort = (node: MaterialFolderNode) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    node.materials.sort((a, b) => a.productName.localeCompare(b.productName, undefined, { numeric: true }))
    node.folders.forEach(sort)
  }
  sort(local); sort(catalogue)
  return [local, ...(catalogue.folders.length || catalogue.materials.length ? [catalogue] : [])]
}

export function filterMaterialFolderTree(nodes: MaterialFolderNode[], search: string): MaterialFolderNode[] {
  const query = search.trim().toLowerCase()
  if (!query) return nodes
  const filter = (node: MaterialFolderNode, inheritedMatch = false): MaterialFolderNode | undefined => {
    const matches = inheritedMatch || node.name.toLowerCase().includes(query)
    const folders = node.folders.flatMap(child => { const match = filter(child, matches); return match ? [match] : [] })
    const materials = node.materials.filter(material => matches ||
      [material.productName, material.manufacturer, material.collection, ...(material.tags ?? [])]
        .some(value => value?.toLowerCase().includes(query)))
    return matches || folders.length || materials.length ? { ...node, folders, materials } : undefined
  }
  return nodes.flatMap(node => { const match = filter(node); return match ? [match] : [] })
}
