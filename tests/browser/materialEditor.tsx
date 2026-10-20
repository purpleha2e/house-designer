import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { _roots } from '@react-three/fiber'
import { MaterialEditor } from '../../src/components/MaterialEditor'
import { collectLocalMaterialDefinitions, loadLocalMaterials, saveLocalMaterial } from '../../src/materials/localMaterials'
import type { SurfaceMaterialProduct } from '../../src/types'
import '../../src/index.css'

const initial = await loadLocalMaterials()
declare global {
  interface Window {
    materialEditorSaved?: SurfaceMaterialProduct
    materialEditorHouse?: { materialDefinitions: SurfaceMaterialProduct[] }
    materialPreviewState: () => unknown
  }
}
window.materialPreviewState = () => [..._roots.values()][0]?.store.getState()
function Harness() {
  const [materials, setMaterials] = useState(initial)
  return <MaterialEditor materials={materials} onClose={() => {}} onSave={async material => {
    await saveLocalMaterial(material)
    setMaterials(values => [...values.filter(value => value.id !== material.id), material])
    window.materialEditorSaved = material
    window.materialEditorHouse = { materialDefinitions: collectLocalMaterialDefinitions(
      { surfaceAssignments: [{ materialId: material.id }] }, [material]) }
  }} />
}
createRoot(document.getElementById('root')!).render(<Harness />)
