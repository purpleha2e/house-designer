import { useContext, useEffect, useMemo } from 'react'
import { Mesh, type MeshStandardMaterial, type Object3D } from 'three'
import { createWindowGeometry, disposeWindowGeometry } from '../windowGeometry'
import type { WindowDesign } from '../windowDesign'
import { applyWindowFrameFinish } from '../windowFrameMaterial'
import { PbrEnvironmentContext } from '../pbrEnvironmentContext'

export function WindowMesh({ design, scale = 1, widthScale = 1, depthScale = 1, wireframe = false,
  active = true, onObject }: { design: WindowDesign; scale?: number; widthScale?: number;
    depthScale?: number; wireframe?: boolean; active?: boolean; onObject?: (object: Object3D) => () => void }) {
  const environment = useContext(PbrEnvironmentContext)
  const sx = Math.max(0.001, scale * widthScale), sy = Math.max(0.001, scale), sz = Math.max(0.001, scale * depthScale)
  const object = useMemo(() => {
    // Rebuild at physical dimensions, then cancel the containing model transform.
    // This preserves frame thickness and fixed top lights when an instance is resized.
    const group = createWindowGeometry({ ...design, width: design.width*sx, height: design.height*sy, depth: design.depth*sz })
    group.scale.set(1/sx, 1/sy, 1/sz)
    const materials = new Set<MeshStandardMaterial>()
    group.traverse(child => {
      if (child instanceof Mesh) {
        materials.add(child.material as MeshStandardMaterial)
      }
    })
    materials.forEach(material => {
      applyWindowFrameFinish(material, environment.map, environment.intensity)
      material.wireframe = wireframe
      if (!active) { material.opacity *= 0.24; material.transparent = true }
    })
    return group
  }, [design, sx, sy, sz, wireframe, active, environment])
  useEffect(() => onObject?.(object), [object, onObject])
  useEffect(() => () => disposeWindowGeometry(object), [object])
  return <primitive object={object} />
}
