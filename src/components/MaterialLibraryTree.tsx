import { memo, useContext, useMemo, useState } from 'react'
import type { SurfaceMaterialProduct } from '../types'
import { buildMaterialFolderTree, filterMaterialFolderTree, type MaterialFolderNode } from '../materials/materialFolders'
import { isLocalMaterial } from '../materials/localMaterials'
import { MaterialCatalogueContext } from '../materials/materialCatalogueContext'
import './MaterialLibraryTree.css'

const dragType = 'application/x-house-designer-material'
const count = (node: MaterialFolderNode): number => node.materials.length + node.folders.reduce((total, child) => total + count(child), 0)
const contains = (node: MaterialFolderNode, id: string): boolean => node.materials.some(material => material.id === id) || node.folders.some(child => contains(child, id))

// Embedded map URLs can be several MB. Keep their CSS values stable while
// preview sliders update rather than rebuilding those strings on every input.
export const MaterialSwatch = memo(function MaterialSwatch({ colour, url }: { colour?: string; url?: string }) {
  return <span className="material-tree-swatch" style={{ backgroundColor: colour ?? '#d1d5db',
    backgroundImage: url && !url.includes('.ktx2') ? `url("${url}")` : undefined }} />
})

export function MaterialLibraryTree({ materials, folders, selectedId, selectedFolder, onSelect, onSelectFolder, onMove,
  loadCatalogueSwatches = true, selectedCatalogueFolder, onSelectCatalogueFolder, onMoveCatalogueMaterial,
  showRemoved = false, browserLibrary }: {
  materials: SurfaceMaterialProduct[]
  folders: string[]
  selectedId: string
  selectedFolder?: string
  onSelect: (material: SurfaceMaterialProduct) => void
  onSelectFolder?: (path: string) => void
  onMove?: (id: string, path: string) => void
  loadCatalogueSwatches?: boolean
  selectedCatalogueFolder?: string
  onSelectCatalogueFolder?: (path: string) => void
  onMoveCatalogueMaterial?: (id: string, path: string) => void
  showRemoved?: boolean
  browserLibrary?: 'all' | 'catalogue'
}) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, { open: boolean; selection?: string }>>({})
  const layout = useContext(MaterialCatalogueContext)
  const nodes = useMemo(() => {
    const tree = buildMaterialFolderTree(materials, folders, layout, showRemoved, !!browserLibrary)
    return filterMaterialFolderTree(browserLibrary === 'catalogue' ? tree.filter(node => node.cataloguePath !== undefined) : tree, search)
  }, [materials, folders, layout, search, showRemoved, browserLibrary])
  const render = (node: MaterialFolderNode, depth: number) => {
    const path = node.path ?? node.cataloguePath
    const selected = node.path !== undefined ? selectedFolder : selectedCatalogueFolder
    const select = node.path !== undefined ? onSelectFolder : onSelectCatalogueFolder
    const move = node.path !== undefined ? onMove : onMoveCatalogueMaterial
    const folderSelected = path !== undefined && selected?.toLowerCase() === path.toLowerCase()
    const parentOfFolder = path !== undefined && !!selected && (!path || selected.toLowerCase().startsWith(`${path.toLowerCase()}/`))
    const expansion = expanded[node.key]
    const revealCatalogueSelection = node.cataloguePath !== undefined && (parentOfFolder || folderSelected) && expansion?.selection !== selected
    const open = !!search.trim() || revealCatalogueSelection || (expansion?.open ?? (depth === 0 || contains(node, selectedId) || parentOfFolder || folderSelected))
    const setOpen = (open: boolean) => setExpanded(value => ({ ...value, [node.key]: { open, selection: selected } }))
    return <li key={node.key}>
      <div className={`material-folder-row${folderSelected ? ' is-selected' : ''}`} data-folder-path={node.path}
        onDragOver={event => { if (move && path !== undefined && event.dataTransfer.types.includes(dragType)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
        onDrop={event => { const id = event.dataTransfer.getData(dragType); if (move && path !== undefined && id) { event.preventDefault(); move(id, path) } }}>
        <button type="button" className="material-folder-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`} aria-expanded={open}
          onClick={() => setOpen(!open)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d={open ? 'M4 7l6 6 6-6' : 'M7 4l6 6-6 6'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="material-folder-label" aria-label={`Folder: ${node.path !== undefined ? 'My materials' : 'Catalogue'}${path ? `/${path}` : ''}`}
          aria-pressed={select ? folderSelected : undefined}
          onClick={() => {
            if (path !== undefined && select) { select(path); setOpen(true) }
            else setOpen(!open)
          }}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 5h6l2 2h8v9H2z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          <span title={node.path ?? node.name}>{node.name}</span><small>{count(node)}</small>
        </button>
      </div>
      {open && <ul>
        {node.folders.map(child => render(child, depth + 1))}
        {node.materials.map(material => <li key={material.id}>
          <button type="button" className="material-tree-item" data-material-id={material.id} aria-pressed={material.id === selectedId}
            draggable={!!move} onDragStart={event => {
              if (!move) return
              event.dataTransfer.setData(dragType, material.id); event.dataTransfer.effectAllowed = 'move'
            }}
            onClick={() => onSelect(material)} title={material.productName}>
            <MaterialSwatch colour={material.pbr.baseColor} url={loadCatalogueSwatches || isLocalMaterial(material) ? material.pbr.baseColorTextureUrl : undefined} />
            <span>{material.productName}{!isLocalMaterial(material) && layout.entries[material.id]?.removed ? ' (removed)' : ''}</span>
          </button>
        </li>)}
        {!node.folders.length && !node.materials.length && <li className="material-tree-empty">Empty folder</li>}
      </ul>}
    </li>
  }
  return <div className="material-tree">
    <input type="search" aria-label="Search materials" placeholder="Search materials..." value={search} onChange={event => setSearch(event.target.value)} />
    <nav aria-label="Material folders" className="material-library-list"><ul>{nodes.map(node => render(node, 0))}</ul>
      {!nodes.length && <p className="material-tree-empty">No matching materials</p>}
    </nav>
  </div>
}
