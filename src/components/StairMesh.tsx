import { useContext, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react'
import { Mesh, type Group, type MeshStandardMaterial, type Object3D } from 'three'
import { createStairGeometry, disposeStairGeometry, stairGeometryKey } from '../stairGeometry'
import { getStairFinish, type StairDesign, type StairPart } from '../stairDesign'
import { PbrEnvironmentContext } from '../pbrEnvironmentContext'

export function StairMesh({ design, active = true, castsShadow = true, wireframe = false, onObject, materialRevision = '', children }: {
  design: StairDesign; active?: boolean; castsShadow?: boolean; wireframe?: boolean;
  onObject?: (object: Object3D) => () => void; materialRevision?: string; children?: (group: Group) => ReactNode
}) {
  const environment = useContext(PbrEnvironmentContext)
  const key = stairGeometryKey(design)
  // Finish changes retain the generated geometry and GPU/acceleration buffers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => createStairGeometry(design), [key])
  const finishesKey = JSON.stringify(design.finishes)
  const finishes = useMemo<StairDesign['finishes']>(() => JSON.parse(finishesKey), [finishesKey])
  const object = useMemo(() => {
    const root = geometry.clone(true)
    root.traverse(child => {
      if (!(child instanceof Mesh)) return
      const original = child.material as MeshStandardMaterial
      const f = getStairFinish({ ...design, finishes }, child.userData.stairPart as StairPart)
      child.material = original.clone()
      const material = child.material as MeshStandardMaterial
      material.color.set(f.color); material.roughness = f.roughness; material.metalness = f.metalness
    })
    root.userData.stairDesign = { ...root.userData.stairDesign, finishes }
    return root
    // New materials restore the original finish when a catalog override is removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, finishes, materialRevision])
  useLayoutEffect(() => {
    const overrides = JSON.parse(materialRevision || '{}') as Record<string, string>
    object.traverse(child => {
      if (!(child instanceof Mesh)) return
      const material = child.material as MeshStandardMaterial
      if (!overrides[material.name]) { material.envMap = environment.map; material.envMapIntensity = environment.intensity }
      material.wireframe = wireframe; material.transparent = !active; material.opacity = active ? 1 : .24
      material.needsUpdate = true
      child.castShadow = active && castsShadow; child.receiveShadow = active
    })
  }, [object, active, castsShadow, wireframe, environment, materialRevision])
  useEffect(() => onObject?.(object), [object, onObject])
  useEffect(() => () => { object.traverse(child => { if (child instanceof Mesh) (child.material as MeshStandardMaterial).dispose() }) }, [object])
  useEffect(() => () => disposeStairGeometry(geometry), [geometry])
  return <><primitive object={object} />{children?.(object)}</>
}
