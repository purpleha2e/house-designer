import { useEffect, useState } from 'react'
import { DoubleSide, SRGBColorSpace, Texture, TextureLoader } from 'three'
import type { GroundImage } from '../types'

export function GroundImage3D({ image, elevation, floorId }: { image: GroundImage; elevation: number; floorId: string }) {
  const [texture, setTexture] = useState<Texture | null>(null)
  useEffect(() => {
    let cancelled = false
    const loaded = new TextureLoader().load(image.dataUrl, result => {
      if (cancelled) { result.dispose(); return }
      result.colorSpace = SRGBColorSpace
      setTexture(result)
    }, undefined, () => { if (!cancelled) setTexture(null) })
    return () => { cancelled = true; loaded.dispose() }
  }, [image.dataUrl])
  if (!image.visible || !texture) return null
  return <mesh name="ground-image-3d" position={[image.position.x + image.width / 2, elevation + 0.015, image.position.y + image.length / 2]}
    rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}
    userData={{ houseDesignerRole: 'floor-image', floorId }}>
    <planeGeometry args={[image.width, image.length]} />
    <meshBasicMaterial map={texture} transparent opacity={image.opacity} depthWrite={false} side={DoubleSide}
      polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
  </mesh>
}
