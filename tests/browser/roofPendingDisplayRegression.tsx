import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useThree } from '@react-three/fiber'
import { SceneRenderer } from '../../src/components/SceneRenderer'

const noop = () => {}
function Fixture() {
  const [created, setCreated] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [geometryPending, setGeometryPending] = useState(false)
  const composer = useRef(null)
  const state = useThree()
  Object.assign(window, { roofDisplay: {
    create: () => { setCreated(true); setBlocked(true); setGeometryPending(true) },
    geometryReady: () => setGeometryPending(false),
    finish: () => setBlocked(false),
    state,
  } })
  return <>
    <ambientLight intensity={2} />
    <mesh position={[0, -1, 0]}><boxGeometry args={[5, 2, 4]} /><meshStandardMaterial color="#888888" /></mesh>
    <mesh key={String(created)} position={[0, 1, 0]} rotation={[0, 0, .3]} userData={{houseDesignerRole: created ? 'roof-top' : 'roof-placement-preview'}}>
      <boxGeometry args={[5, .15, 4]} />
      <meshStandardMaterial color={created ? '#4b5563' : '#3b82f6'} transparent={!created} opacity={created ? 1 : .2} />
    </mesh>
    <SceneRenderer blocked={blocked} geometryPending={geometryPending} contentRevision={created ? 'created' : 'placement'}
      offscreen={false} composer={composer} editing={false} wireframe={false} selectionRevision="" opaquePending={blocked}
      onOpaqueReady={noop} lightingStarted={false} onLightingReady={noop} onSceneReady={noop} />
  </>
}
createRoot(document.getElementById('root')!).render(<Canvas camera={{position:[8,6,8]}} onCreated={({camera}) => camera.lookAt(0,0,0)}><Fixture /></Canvas>)
