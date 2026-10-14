import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Matrix4 } from 'three'
import type { EffectComposer } from 'postprocessing'
import { shouldRenderSceneFrame } from '../sceneRenderSchedule'

/** Own the display draw so asset/shader preparation cannot trigger synchronous
 * first-use compilation, and static display frames do not compete with GI. */
export function SceneRenderer({ blocked, geometryPending, offscreen, composer, editing, wireframe, selectionRevision }: {
  blocked: boolean; offscreen: boolean; composer: RefObject<EffectComposer | null>
  editing: boolean; wireframe: boolean; geometryPending: boolean
  selectionRevision: string
}) {
  const lastDraw = useRef(-Infinity)
  const view = useRef(new Matrix4()), projection = useRef(new Matrix4())
  const dimensions = useRef('')
  const selection = useRef('')
  useFrame(({ camera, gl, scene, size }, delta) => {
    if (((blocked || scene.userData.shaderWarmupPending) && !gl.xr.isPresenting) || wireframe) return
    camera.updateMatrixWorld()
    const nextDimensions = `${size.width}:${size.height}:${gl.getPixelRatio()}`
    const changed = !view.current.equals(camera.matrixWorld) || !projection.current.equals(camera.projectionMatrix) ||
      dimensions.current !== nextDimensions || selection.current !== selectionRevision
    const now = performance.now()
    if (!gl.xr.isPresenting && !shouldRenderSceneFrame(now, lastDraw.current, changed, editing, scene.userData.indirectLighting, geometryPending)) return
    if (offscreen && !composer.current) return
    const autoClear = gl.autoClear
    try {
      gl.autoClear = true
      if (offscreen) composer.current!.render(delta)
      else gl.render(scene, camera)
    } finally { gl.autoClear = autoClear }
    lastDraw.current = now
    view.current.copy(camera.matrixWorld); projection.current.copy(camera.projectionMatrix)
    dimensions.current = nextDimensions
    selection.current = selectionRevision
  }, 1)
  return null
}
