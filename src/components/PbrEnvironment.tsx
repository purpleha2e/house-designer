import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import { useThree } from '@react-three/fiber'
import { PMREMGenerator } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import { PbrEnvironmentContext } from '../pbrEnvironmentContext'

export function PbrEnvironmentProvider({ children, intensity }: { children: ReactNode; intensity: number }) {
  const { gl, invalidate, scene } = useThree()
  const resources = useMemo(() => {
    const environmentScene = new RoomEnvironment()
    const generator = new PMREMGenerator(gl)
    const target = generator.fromScene(environmentScene, 0.04)
    return { environmentScene, generator, target }
  }, [gl])
  useLayoutEffect(() => {
    // Lighting is opt-in per material, including after a hot reload.
    // eslint-disable-next-line react-hooks/immutability -- Three.js scene resources are updated imperatively in effects.
    scene.environment = null
    invalidate()
    return () => {
      resources.target.dispose()
      resources.environmentScene.dispose()
      resources.generator.dispose()
    }
  }, [resources, invalidate, scene])
  const value = useMemo(() => ({ intensity, map: resources.target.texture }), [resources, intensity])
  return <PbrEnvironmentContext.Provider value={value}>{children}</PbrEnvironmentContext.Provider>
}
