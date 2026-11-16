import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { isViewportNavigating } from '../viewportScheduling'
import { ViewerResolution } from './viewerResolution'

export function ViewerAdaptiveResolution({ enabled, onChange }: {
  enabled: boolean; onChange: (scale: number) => void
}) {
  const controller = useRef(new ViewerResolution())
  const published = useRef(1)
  useEffect(() => {
    controller.current = new ViewerResolution()
    published.current = 1
    onChange(1)
  }, [enabled, onChange])
  useFrame(({ scene, gl }, delta) => {
    if (!enabled || gl.xr.isPresenting || document.hidden) return
    const data = scene.userData, gi = data.indirectLighting
    const ready = data.progressiveStartup?.phase === 'full' && !data.shaderWarmupPending &&
      !data.indirectScanPending && (gi?.state === 'ready' || gi?.state === 'fallback' || gi?.enabled === false) &&
      (!data.exteriorSkyOcclusion || data.exteriorSkyOcclusion.state === 'ready')
    const scale = controller.current.sample(delta, isViewportNavigating(), ready)
    data.viewerResolution = { scale, ready }
    if (scale !== published.current) { published.current = scale; onChange(scale) }
  })
  return null
}
