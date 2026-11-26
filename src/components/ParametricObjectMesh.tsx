import { useEffect, type ReactNode } from 'react'
import { Mesh, type Group, type Material } from 'three'

export type ParametricObjectMeshProps = {
  castsShadow?: boolean
  onObject?: (object: Group) => (() => void) | undefined
  children?: (object: Group) => ReactNode
}

export function ParametricObjectMesh({ group, castsShadow = false, onObject, children }: ParametricObjectMeshProps & { group: Group }) {
  useEffect(() => () => {
    const materials = new Set<Material>()
    group.traverse(child => {
      if (!(child instanceof Mesh)) return
      child.geometry.dispose()
      for (const material of [child.material].flat()) materials.add(material)
    })
    materials.forEach(material => material.dispose())
  }, [group])
  useEffect(() => onObject?.(group), [group, onObject])
  useEffect(() => {
    group.traverse(child => {
      if (child instanceof Mesh) {
        child.castShadow = castsShadow
        child.receiveShadow = true
      }
    })
  }, [group, castsShadow])
  return <><primitive object={group} />{children?.(group)}</>
}
