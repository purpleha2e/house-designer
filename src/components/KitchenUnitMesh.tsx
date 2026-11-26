import { useContext, useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Mesh, MeshPhysicalMaterial } from 'three'
import type { KitchenUnitDesign } from '../kitchenUnitDesign'
import { createKitchenUnitGeometry } from '../kitchenUnitGeometry'
import { applyImportedPbrEnvironment } from '../importedPbrMaterials'
import { PbrEnvironmentContext } from '../pbrEnvironmentContext'
import { ParametricObjectMesh, type ParametricObjectMeshProps } from './ParametricObjectMesh'

export function KitchenUnitMesh({ design, overriddenHandles, ...props }: ParametricObjectMeshProps & {
  design: KitchenUnitDesign; overriddenHandles?: boolean
}) {
  const group = useMemo(() => createKitchenUnitGeometry(design), [design])
  const { map, intensity } = useContext(PbrEnvironmentContext)
  const invalidate = useThree(state => state.invalidate)
  useEffect(() => {
    if (overriddenHandles) return
    const handle = group.getObjectByName(design.handleStyle === 'knob' ? 'knob' : 'handle-bar')
    if (handle instanceof Mesh && handle.material instanceof MeshPhysicalMaterial &&
      applyImportedPbrEnvironment(handle.material, map, intensity)) invalidate()
  }, [design.handleStyle, group, intensity, invalidate, map, overriddenHandles])
  return <ParametricObjectMesh group={group} {...props} />
}
