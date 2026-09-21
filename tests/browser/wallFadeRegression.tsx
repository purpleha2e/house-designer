import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useThree } from '@react-three/fiber'
import { DoubleSide, type Mesh } from 'three'
import { WallViewFadeContext, isFadedWallSurface, useWallViewFade } from '../../src/components/WallViewFade'
import { buildWallBufferGeometryPayload } from '../../src/wallEngine/wallBuffer'
import { createWallBufferGeometry } from '../../src/wallEngine/wallThreeGeometry'
import type { WallMeshFace } from '../../src/wallEngine/wallMesh'
import type { Wall } from '../../src/types'

const polygon = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]
const walls: Wall[] = polygon.map((start, i) => ({ id: ['front', 'right', 'back', 'left'][i],
  start, end: polygon[(i + 1) % 4], height: 2.4, thickness: 0.2, kind: 'external' }))
const faces: WallMeshFace[] = walls.map(wall => ({
  wallId: wall.id, faceId: wall.id, kind: 'side',
  normal: [(wall.end.y - wall.start.y) / 4, 0, -(wall.end.x - wall.start.x) / 4],
  materialSource: { wallId: wall.id, side: 1 }, pickSource: { wallId: wall.id, side: 1 }, uvSource: { wallId: wall.id, side: 1 },
  vertices: [
    { position: [wall.start.x, 0, wall.start.y], uv: [0, 0] },
    { position: [wall.end.x, 0, wall.end.y], uv: [1, 0] },
    { position: [wall.end.x, 2.4, wall.end.y], uv: [1, 1] },
    { position: [wall.start.x, 2.4, wall.start.y], uv: [0, 1] },
  ],
}))
function TestWalls() {
  const meshRef = useRef<Mesh>(null!)
  const pickMeshRef = useRef<Mesh>(null!)
  const { camera, gl } = useThree()
  const payload = useMemo(() => buildWallBufferGeometryPayload(faces, { floorId: 'floor', materialBatchKey: () => 'same' }), [])
  const geometry = useMemo(() => createWallBufferGeometry(payload), [payload])
  useWallViewFade({ meshRef, pickMeshRef, geometry, payload, faces, elevation: 0, walls })
  useEffect(() => {
    camera.position.set(2, 1.6, -1)
    camera.lookAt(2, 0.8, 2)
    Object.assign(window, {
      wallFadeView: (view: 'near' | 'far' | 'inside' | 'away' | 'high') => {
        camera.position.set(2, view === 'high' ? 8 : 1.6, view === 'inside' ? 1 : view === 'far' ? -4 : -1)
        camera.lookAt(2, view === 'high' ? 1.2 : 1.6, view === 'away' ? -4 : view === 'inside' ? 0 : 2)
      },
      wallFadeSnapshot: () => ({
        dynamicColorBuffer: Boolean(geometry.getAttribute('color')),
        customFadeAttributes:
          Boolean(geometry.getAttribute('hdWallFadeSegment')) &&
          Boolean(geometry.getAttribute('hdWallFadeBounds')),
        groups: geometry.groups.length,
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        frontPickSkipped: isFadedWallSurface(pickMeshRef.current, { type: 'wall-face', wallId: 'front' }),
        backPickSkipped: isFadedWallSurface(pickMeshRef.current, { type: 'wall-face', wallId: 'back' }),
        fadedMaterialOpacities: (Array.isArray(meshRef.current.material)
          ? meshRef.current.material
          : [meshRef.current.material])
          .filter(material => material.transparent)
          .map(material => material.opacity),
        shaderErrors: gl.info.programs?.filter(p => p.diagnostics && !p.diagnostics.runnable).length,
      }),
    })
    return () => geometry.dispose()
  }, [camera, geometry, gl])
  return <>
    <mesh ref={meshRef} geometry={geometry}><meshStandardMaterial attach="material-0" color="#dddddd" side={DoubleSide} /></mesh>
    <mesh ref={pickMeshRef} visible={false} />
    <mesh position={[2, 0.5, 2]}><boxGeometry /><meshStandardMaterial color="red" /></mesh>
  </>
}
function Regression() {
  const [enabled, setEnabled] = useState(true)
  useEffect(() => { Object.assign(window, { wallFadeEnable: setEnabled }) }, [])
  return <Canvas><WallViewFadeContext.Provider value={enabled}>
    <ambientLight intensity={2} /><TestWalls />
  </WallViewFadeContext.Provider></Canvas>
}
createRoot(document.getElementById('root')!).render(<Regression />)
