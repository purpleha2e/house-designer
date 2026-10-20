import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { ACESFilmicToneMapping, MeshStandardMaterial, NoColorSpace, PMREMGenerator, RepeatWrapping,
  SRGBColorSpace, TextureLoader, type Texture } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { SurfaceMaterialProduct } from '../types'

export type MaterialPreviewShape = 'sphere' | 'tile' | 'corner'
export type MaterialPreviewLighting = 'studio' | 'daylight' | 'grazing'

// Three resources are mutable GPU objects, owned and disposed by this preview.
function configureTexture(texture: Texture, repeatX: number, repeatY: number, rotation: number) {
  texture.repeat.set(repeatX, repeatY); texture.center.set(.5, .5)
  texture.rotation = rotation * Math.PI / 180; texture.updateMatrix()
}

function configureSurface(surface: MeshStandardMaterial, pbr: SurfaceMaterialProduct['pbr'],
  maps: Record<'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'displacementMap', Texture | null>,
  environment: Texture | null, lighting: MaterialPreviewLighting) {
  let changed = false
  for (const key of Object.keys(maps) as Array<keyof typeof maps>) {
    if (surface[key] !== maps[key]) { surface[key] = maps[key]; changed = true }
  }
  surface.color.set(pbr.baseColor ?? '#ffffff')
  surface.roughness = pbr.roughness ?? .7; surface.metalness = pbr.metalness ?? 0
  const strength = pbr.normalStrength ?? 1
  surface.normalScale.set(strength, strength * (pbr.normalFlipY ? -1 : 1))
  surface.displacementScale = pbr.displacementScale ?? .003
  const nextEnvironment = pbr.imageBasedLighting ? environment : null
  if (surface.envMap !== nextEnvironment) { surface.envMap = nextEnvironment; changed = true }
  surface.envMapIntensity = lighting === 'daylight' ? .8 : .55
  if (changed) surface.needsUpdate = true
}

function useMap(url: string | undefined, colour: boolean, repeatX: number, repeatY: number, rotation: number) {
  const invalidate = useThree(state => state.invalidate)
  const [loaded, setLoaded] = useState<{ url: string; texture: Texture }>()
  useEffect(() => {
    if (!url) return
    let cancelled = false
    const texture = new TextureLoader().load(url, next => {
      if (cancelled) return
      next.colorSpace = colour ? SRGBColorSpace : NoColorSpace
      next.wrapS = next.wrapT = RepeatWrapping
      next.needsUpdate = true
      setLoaded({ url, texture: next }); invalidate()
    })
    return () => { cancelled = true; texture.dispose() }
  }, [url, colour, invalidate])
  const texture = loaded && loaded.url === url ? loaded.texture : null
  useLayoutEffect(() => {
    if (!texture) return
    configureTexture(texture, repeatX, repeatY, rotation); invalidate()
  }, [texture, repeatX, repeatY, rotation, invalidate])
  return texture
}

function PreviewSurface({ material, shape, lighting }: {
  material: SurfaceMaterialProduct; shape: MaterialPreviewShape; lighting: MaterialPreviewLighting
}) {
  const { gl, invalidate } = useThree()
  const [environment, setEnvironment] = useState<Texture | null>(null)
  useEffect(() => {
    let target: ReturnType<PMREMGenerator['fromScene']> | undefined
    const timer = setTimeout(() => {
      const room = new RoomEnvironment(), generator = new PMREMGenerator(gl)
      target = generator.fromScene(room, .04, .1, 10)
      setEnvironment(target.texture); invalidate(); generator.dispose(); room.dispose()
    }, 0)
    return () => { clearTimeout(timer); target?.dispose() }
  }, [gl, invalidate])
  const pbr = material.pbr
  // Flat samples span one metre; sphere UVs span its circumference and half-circumference.
  const repeatX = (shape === 'sphere' ? Math.PI : 1) * (pbr.repeatX ?? 1) / Math.max(.001, pbr.realWorldWidthMeters ?? 1)
  const repeatY = (shape === 'sphere' ? Math.PI / 2 : 1) * (pbr.repeatY ?? 1) / Math.max(.001, pbr.realWorldHeightMeters ?? 1)
  const map = useMap(pbr.baseColorTextureUrl, true, repeatX, repeatY, pbr.rotation ?? 0)
  const normalMap = useMap(pbr.normalTextureUrl, false, repeatX, repeatY, pbr.rotation ?? 0)
  const roughnessMap = useMap(pbr.roughnessTextureUrl, false, repeatX, repeatY, pbr.rotation ?? 0)
  const metalnessMap = useMap(pbr.metalnessTextureUrl, false, repeatX, repeatY, pbr.rotation ?? 0)
  const aoMap = useMap(pbr.ambientOcclusionTextureUrl, false, repeatX, repeatY, pbr.rotation ?? 0)
  const displacementMap = useMap(pbr.displacementTextureUrl, false, repeatX, repeatY, pbr.rotation ?? 0)
  const surface = useMemo(() => new MeshStandardMaterial(), [])
  useEffect(() => () => surface.dispose(), [surface])
  useLayoutEffect(() => {
    configureSurface(surface, pbr, { map, normalMap, roughnessMap, metalnessMap, aoMap, displacementMap }, environment, lighting)
    invalidate()
  }, [surface, pbr, map, normalMap, roughnessMap, metalnessMap, aoMap, displacementMap, environment, lighting, invalidate])
  return <>
    <color attach="background" args={[lighting === 'daylight' ? '#ccd8df' : '#242c38']} />
    <hemisphereLight args={['#e6efff', '#3d322c', lighting === 'grazing' ? .4 : 1.1]} />
    <directionalLight position={lighting === 'grazing' ? [-3, .4, 1] : [3, 4, 3]}
      intensity={lighting === 'daylight' ? 3 : 2.5} color={lighting === 'daylight' ? '#fff1db' : '#ffffff'} />
    <directionalLight position={[-3, 1, -2]} intensity={.7} color="#bfdbfe" />
    {shape === 'sphere' ? <mesh material={surface}><sphereGeometry args={[.5, 96, 64]} /></mesh> :
      shape === 'tile' ? <mesh material={surface}><planeGeometry args={[1, 1, 80, 80]} /></mesh> :
        <group>
          <mesh position={[0, 0, -.5]} material={surface}><planeGeometry args={[1, 1, 64, 64]} /></mesh>
          <mesh position={[-.5, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={surface}><planeGeometry args={[1, 1, 64, 64]} /></mesh>
          <mesh position={[0, -.5, 0]} rotation={[-Math.PI / 2, 0, 0]} material={surface}><planeGeometry args={[1, 1, 64, 64]} /></mesh>
        </group>}
    <OrbitControls makeDefault enablePan={false} enableDamping={false} minDistance={1} maxDistance={6} />
  </>
}

export function MaterialPreview({ material, shape, lighting }: {
  material: SurfaceMaterialProduct; shape: MaterialPreviewShape; lighting: MaterialPreviewLighting
}) {
  return <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: [1.4, .9, 2], fov: 42 }}
    gl={{ antialias: true, toneMapping: ACESFilmicToneMapping }}
    fallback={<p>3D preview needs WebGL. You can still edit and save the material.</p>}>
    <PreviewSurface material={material} shape={shape} lighting={lighting} />
  </Canvas>
}

