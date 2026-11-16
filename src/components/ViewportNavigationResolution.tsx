import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Matrix4 } from 'three'
import { NavigationResolution } from '../navigationResolution'

export function ViewportNavigationResolution({ enabled, onChange }: {
  enabled: boolean; onChange: (scale: number) => void
}) {
  const controller = useRef(new NavigationResolution())
  const previousView = useRef(new Matrix4())
  const published = useRef(1)
  useEffect(() => {
    controller.current = new NavigationResolution()
    published.current = 1
    onChange(1)
  }, [enabled, onChange])
  useFrame(({ scene, camera, gl }, delta) => {
    if (!enabled || gl.xr.isPresenting || document.hidden) return
    camera.updateMatrixWorld()
    const moving = !previousView.current.equals(camera.matrixWorld)
    previousView.current.copy(camera.matrixWorld)
    const data = scene.userData
    const ready = data.progressiveStartup?.phase === 'full' && !data.shaderWarmupPending &&
      !data.indirectScanPending
    const scale = controller.current.sample(delta, moving, ready)
    data.navigationResolution = { scale, moving, ready }
    if (scale !== published.current) { published.current = scale; onChange(scale) }
  }, .5)
  return null
}
