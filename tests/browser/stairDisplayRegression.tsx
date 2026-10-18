import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useThree } from '@react-three/fiber'
import { Group, type Scene } from 'three'
import type { EffectComposer } from 'postprocessing'
import { StairMesh } from '../../src/components/StairMesh'
import { ModelSelectionHighlight } from '../../src/components/ModelSelectionHighlight'
import { SceneRenderer } from '../../src/components/SceneRenderer'
import { createStairDesign } from '../../src/stairDesign'

function Fixture() {
  const { gl, scene, camera, invalidate } = useThree()
  const root = useRef<Group>(null), composer = useRef<EffectComposer | null>(null)
  const lastDisplay = useRef<Scene | null>(null)
  const [blocked, setBlocked] = useState(true)
  const [pose, setPose] = useState({ rotation: 0, mirror: false, flip: false, x: 0, z: 0, sx: 1, sy: 1, sz: 1 })
  const design = useMemo(() => ({ ...createStairDesign(), layout: 'l' as const, stepsBeforeTurn: 6 }), [])
  useEffect(() => {
    const render = gl.render
    gl.render = function(display, camera) { lastDisplay.current = display; render.call(this, display, camera) }
    camera.lookAt(0, 1.2, 0); invalidate()
    Object.assign(window, { stairDisplay: {
      get: () => ({ source: scene, display: lastDisplay.current, model: root.current, renderer: gl }),
      pose: setPose, block: setBlocked,
    } })
    return () => { gl.render = render }
  }, [gl, scene, camera, invalidate])
  return <>
    <color attach="background" args={['#e8eef3']} /><ambientLight intensity={1} /><directionalLight position={[4, 7, -3]} intensity={2} />
    <group ref={root} name="model-transform-regression" rotation={[0, pose.rotation, 0]} position={[pose.x, 0, pose.z]} scale={[pose.sx, pose.sy, pose.sz]}>
      <group name="model-local-transform-regression" scale={[pose.mirror ? -1 : 1, 1, 1]} rotation={[0, pose.flip ? Math.PI : 0, 0]}>
        <StairMesh design={design} />
      </group>
      <ModelSelectionHighlight object={root} />
    </group>
    <SceneRenderer blocked={blocked} geometryPending={false} offscreen={false} composer={composer} editing={false}
      wireframe={false} selectionRevision="stairs" opaquePending={false} onOpaqueReady={() => {}}
      lightingStarted={false} onLightingReady={() => {}} />
  </>
}
createRoot(document.getElementById('root')!).render(<Canvas camera={{ position: [6, 5, -8], fov: 43 }}><Fixture /></Canvas>)
