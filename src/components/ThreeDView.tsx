import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { EffectComposer, N8AO } from '@react-three/postprocessing'
import { Color } from 'three'
import type { Wall } from '../types'
import { getRenderedWalls, type RenderedWall } from '../wallGeometry'

type ThreeDViewProps = {
  walls: Wall[]
}

const ambientOcclusionColor = new Color('black')

function WallMesh({ renderedWall }: { renderedWall: RenderedWall }) {
  const { wall, startExtension, endExtension } = renderedWall
  const dx = wall.end.x - wall.start.x
  const dz = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dz)
  const renderedLength = length + startExtension + endExtension
  const unitX = length === 0 ? 0 : dx / length
  const unitZ = length === 0 ? 0 : dz / length
  const centerX =
    (wall.start.x + wall.end.x) / 2 + unitX * ((endExtension - startExtension) / 2)
  const centerZ =
    (wall.start.y + wall.end.y) / 2 + unitZ * ((endExtension - startExtension) / 2)
  const rotationY = -Math.atan2(dz, dx)

  return (
    <mesh
      position={[centerX, wall.height / 2, centerZ]}
      rotation={[0, rotationY, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[renderedLength, wall.height, wall.thickness]} />
      <meshStandardMaterial color="#d7dde5" roughness={0.72} />
    </mesh>
  )
}

export function ThreeDView({ walls }: ThreeDViewProps) {
  const renderedWalls = getRenderedWalls(walls)

  return (
    <section className="editor-pane">
      <div className="pane-header">
        <h2>3D View</h2>
        <span>Orbit enabled</span>
      </div>

      <div className="three-host">
        <Canvas
          shadows
          camera={{ position: [6, 5, 8], fov: 45 }}
          gl={{ antialias: true }}
        >
          <color attach="background" args={['#eef2f7']} />
          <ambientLight intensity={0.55} />
          <directionalLight
            position={[4, 8, 6]}
            intensity={1.3}
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />

          <gridHelper args={[14, 14, '#94a3b8', '#cbd5e1']} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[14, 14]} />
            <meshStandardMaterial color="#f8fafc" />
          </mesh>

          {renderedWalls.map((renderedWall) => (
            <WallMesh key={renderedWall.wall.id} renderedWall={renderedWall} />
          ))}

          <OrbitControls makeDefault target={[3, 1.2, 3]} />
          <EffectComposer multisampling={0}>
            <N8AO
              aoRadius={0.75}
              distanceFalloff={0.45}
              intensity={3.2}
              quality="high"
              aoSamples={32}
              denoiseSamples={8}
              denoiseRadius={8}
              color={ambientOcclusionColor}
            />
          </EffectComposer>
        </Canvas>
      </div>
    </section>
  )
}
