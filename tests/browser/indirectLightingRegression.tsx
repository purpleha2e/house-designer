/* eslint-disable react-refresh/only-export-components -- Standalone browser regression entry. */
import { StrictMode, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, _roots, useThree } from '@react-three/fiber'
import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { ACESFilmicToneMapping, DoubleSide, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three'
import { IndirectLighting } from '../../src/components/IndirectLighting'
import { PbrEnvironmentProvider } from '../../src/components/PbrEnvironment'
import { configureAmbientOcclusionPass } from '../../src/ambientOcclusionResources'
import { createRoomLightMask } from '../../src/roomLightMask'
import { applyRoomLightShader, createRoomLightMaskTexture, createRoomLightShaderUniforms } from '../../src/roomLightShader'
const localMode = new URLSearchParams(location.search).has('local')
const open = new URLSearchParams(location.search).has('open')
const lights = [{ kind: 'point' as const, position: [2, 2, 2] as [number, number, number],
  target: [2, 0, 2] as [number, number, number], color: '#ff3010', power: 60, distance: 10, falloff: 2, angle: 1, penumbra: .5 }]
const polygon = (x: number) => [{ x, y: 0 }, { x: x + 4, y: 0 }, { x: x + 4, y: 4 }, { x, y: 4 }]
const floors = [{ id: 'ground', elevation: 0, height: 3, rooms: [
  { signature: 'window', polygon: polygon(0) }, { signature: 'sealed', polygon: polygon(4) },
] }]
function Box({ position, size, colour = '#ffffff' }: { position: [number, number, number]; size: [number, number, number]; colour?: string }) {
  return <mesh position={position} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={colour} roughness={.55} /></mesh>
}
function OtherFloorLightMask() {
  const { scene } = useThree()
  useLayoutEffect(() => {
    const mask = createRoomLightMask(floors[0].rooms, { minX: 0, minZ: 0, size: 8 }, 32)
    const texture = createRoomLightMaskTexture(mask), uniforms = createRoomLightShaderUniforms(texture)
    uniforms.enabled.value = 1; uniforms.floorRange.value.set(10, 13)
    uniforms.maskBounds.value.set(0, 0, 8, 8); uniforms.pointRoomIds.value.fill(1)
    const restorers: (() => void)[] = []
    scene.traverse(o => { if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])
      if(m instanceof MeshStandardMaterial)restorers.push(applyRoomLightShader(m, uniforms)) })
    return () => { restorers.forEach(restore => restore()); texture.dispose() }
  }, [scene])
  return null
}
function App() {
  const [ao, setAo] = useState(false), [revision, setRevision] = useState(0)
  Object.assign(window, { lightingState: () => [..._roots.values()][0]?.store.getState(),
    toggleAO: () => setAo(v => !v), changeLighting: () => setRevision(v => v + 1) })
  return <Canvas shadows camera={{ position: [open ? 4 : 2, 1.5, open ? 2.85 : 3.5], fov: 60 }} style={{ width: 800, height: 600 }}
    onCreated={({ gl, camera }) => { gl.outputColorSpace = SRGBColorSpace; gl.toneMapping = ACESFilmicToneMapping; camera.lookAt(open ? 4 : 2, 1.5, 0) }}>
    <PbrEnvironmentProvider intensity={.55}>
      <color attach="background" args={['#eef2f7']} />
      <ambientLight intensity={.8} />
      <directionalLight position={[2, 5, -3]} intensity={localMode ? 0 : revision ? 2 : 1} castShadow shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-camera-far={30} shadow-normalBias={.01} />
      <Box position={[4, -.1, 2]} size={[8.4, .2, 4.4]} />
      <Box position={[4, 3.1, 2]} size={[8.4, .2, 4.4]} />
      <Box position={[0, 1.5, 2]} size={[.2, 3, 4.2]} />
      {open ? <>
        <Box position={[4, 1.5, .5]} size={[.2, 3, 1]} />
        <Box position={[4, 1.5, 3.5]} size={[.2, 3, 1]} />
        <Box position={[4, 2.8, 2]} size={[.2, .4, 2]} />
        {/* One finish spans the semantic boundary inside a real opening. */}
        <Box position={[4, 1.5, 2]} size={[1.5, .6, .05]} />
      </> : <Box position={[4, 1.5, 2]} size={[.2, 3, 4.2]} />}
      <Box position={[8, 1.5, 2]} size={[.2, 3, 4.2]} />
      <Box position={[4, 1.5, 4]} size={[8.2, 3, .2]} />
      <Box position={[6, 1.5, 0]} size={[4, 3, .2]} />
      <Box position={[.5, 1.5, 0]} size={[1, 3, .2]} />
      <Box position={[3.5, 1.5, 0]} size={[1, 3, .2]} />
      <Box position={[2, .25, 0]} size={[2, .5, .2]} />
      <Box position={[2, 2.75, 0]} size={[2, .5, .2]} />
      <Box position={[2, 1.5, 3.8]} size={[3.5, 2.5, .1]} colour="#a02020" />
      {/* Editor picking helpers must stay invisible after offscreen captures. */}
      <mesh position={[2, 1.5, 1]}>
        <planeGeometry args={[40, 40]} />
        <meshBasicMaterial color="#000000" transparent opacity={0} depthWrite={false} side={DoubleSide} />
      </mesh>
      {localMode && <pointLight position={[2, 2, 2]} color="#ff3010" power={60} distance={10} decay={2} />}
      {localMode && <OtherFloorLightMask />}
      <IndirectLighting floors={floors} revision={String(revision)} blocked={false} enabled indoorFill={.03}
        daylight={!localMode} localLights={localMode ? lights : undefined} />
      {ao && <EffectComposer multisampling={0}><N8AO intensity={0} ref={configureAmbientOcclusionPass} /><ToneMapping mode={ToneMappingMode.ACES_FILMIC} /></EffectComposer>}
    </PbrEnvironmentProvider>
  </Canvas>
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('strict') ? <StrictMode><App /></StrictMode> : <App />)
