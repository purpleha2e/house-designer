import { memo, useMemo, useState } from 'react'
import type { SurfaceMaterialProduct } from '../types'
import { buildMaterialFolderTree, filterMaterialFolderTree, type MaterialFolderNode } from '../materials/materialFolders'
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

export function MaterialLibraryTree({ materials, folders, selectedId, selectedFolder, onSelect, onSelectFolder, onMove }: {
  materials: SurfaceMaterialProduct[]
  folders: string[]
  selectedId: string
  selectedFolder?: string
  onSelect: (material: SurfaceMaterialProduct) => void
  onSelectFolder?: (path: string) => void
  onMove?: (id: string, path: string) => void
}) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const nodes = useMemo(() => filterMaterialFolderTree(buildMaterialFolderTree(materials, folders), search), [materials, folders, search])
  const render = (node: MaterialFolderNode, depth: number) => {
    const folderSelected = node.path !== undefined && selectedFolder?.toLowerCase() === node.path.toLowerCase()
    const parentOfFolder = node.path !== undefined && !!selectedFolder && selectedFolder.toLowerCase().startsWith(`${node.path.toLowerCase()}/`)
    const open = !!search.trim() || (expanded[node.key] ?? (depth === 0 || contains(node, selectedId) || parentOfFolder || folderSelected))
    return <li key={node.key}>
      <div className={`material-folder-row${folderSelected ? ' is-selected' : ''}`} data-folder-path={node.path}
        onDragOver={event => { if (onMove && node.path !== undefined && event.dataTransfer.types.includes(dragType)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
        onDrop={event => { const id = event.dataTransfer.getData(dragType); if (onMove && node.path !== undefined && id) { event.preventDefault(); onMove(id, node.path) } }}>
        <button type="button" className="material-folder-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`} aria-expanded={open}
          onClick={() => setExpanded(value => ({ ...value, [node.key]: !open }))}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d={open ? 'M4 7l6 6 6-6' : 'M7 4l6 6-6 6'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="material-folder-label" aria-label={`Folder: ${node.path !== undefined ? `My materials${node.path ? `/${node.path}` : ''}` : node.name}`}
          onClick={() => { if (node.path !== undefined && onSelectFolder) { onSelectFolder(node.path); setExpanded(value => ({ ...value, [node.key]: true })) }
            else setExpanded(value => ({ ...value, [node.key]: !open })) }}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 5h6l2 2h8v9H2z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          <span title={node.path ?? node.name}>{node.name}</span><small>{count(node)}</small>
        </button>
      </div>
      {open && <ul>
        {node.folders.map(child => render(child, depth + 1))}
        {node.materials.map(material => <li key={material.id}>
          <button type="button" className="material-tree-item" data-material-id={material.id} aria-pressed={material.id === selectedId}
            draggable={!!onMove} onDragStart={event => { event.dataTransfer.setData(dragType, material.id); event.dataTransfer.effectAllowed = 'move' }}
            onClick={() => onSelect(material)} title={material.productName}>
            <MaterialSwatch colour={material.pbr.baseColor} url={material.pbr.baseColorTextureUrl} />
            <span>{material.productName}</span>
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
