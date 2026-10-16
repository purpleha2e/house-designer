import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLoader, useThree } from '@react-three/fiber'
import { CubeUVReflectionMapping, DataTexture, FileLoader, HalfFloatType, LinearFilter, LinearSRGBColorSpace, Loader, RGBAFormat } from 'three'
import environmentSize from '../assets/environments/roomEnvironment.json'
import { prepareTextureUpload } from '../textureUpload'

import { PbrEnvironmentContext } from '../pbrEnvironmentContext'

class EnvironmentLoader extends Loader<ArrayBuffer> {
  load(url: string, onLoad: (data: ArrayBuffer) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void) {
    new FileLoader(this.manager).setResponseType('arraybuffer').load(url,data=>{
      const buffer=data as ArrayBuffer,header=new Uint8Array(buffer,0,Math.min(2,buffer.byteLength))
      // Static hosts may apply Content-Encoding for .gz files themselves.
      const decoded=header[0]===0x1f&&header[1]===0x8b
        ?new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
        :Promise.resolve(buffer)
      void decoded.then(bytes=>{
        if(bytes.byteLength!==environmentSize.width*environmentSize.height*4*2)throw new Error('Invalid reflection environment asset')
        onLoad(bytes)
      }).catch(onError)
    },onProgress,onError)
  }
}

export function PbrEnvironmentProvider({ children, intensity, disabled = false, onReady }: {
  children: ReactNode; intensity: number; disabled?: boolean; onReady?: () => void
}) {
  const [map, setMap] = useState<DataTexture | null>(null)
  const loaded = useCallback((texture: DataTexture | null) => { setMap(texture); if (texture) onReady?.() }, [onReady])
  const value = useMemo(() => ({ intensity: disabled ? 0 : intensity, map: disabled ? null : map }), [disabled, intensity, map])
  // Keep this provider and its children mounted while the loader suspends.
  // Switching wrapper components here would rebuild every mesh and reset controls.
  return <PbrEnvironmentContext.Provider value={value}>
    {children}
    <Suspense fallback={null}>{!disabled && <LoadedPbrEnvironment onLoaded={loaded} />}</Suspense>
  </PbrEnvironmentContext.Provider>
}
function LoadedPbrEnvironment({ onLoaded }: { onLoaded: (texture: DataTexture | null) => void }) {
  const { gl, invalidate, scene } = useThree()
  const bytes = useLoader(EnvironmentLoader, new URL('../assets/environments/roomEnvironment.bin.gz', import.meta.url).href)
  const resources = useMemo(() => {
    // The exact RoomEnvironment/.04 PMREM is built offline by the browser bake
    // script. Runtime generation submitted dozens of blocking GL draws.
    const texture = new DataTexture(new Uint16Array(bytes), environmentSize.width, environmentSize.height, RGBAFormat, HalfFloatType)
    texture.mapping = CubeUVReflectionMapping; texture.colorSpace = LinearSRGBColorSpace
    texture.minFilter = texture.magFilter = LinearFilter; texture.generateMipmaps = false
    texture.flipY = false; texture.needsUpdate = true
    return texture
  }, [bytes])
  useEffect(() => {
    let cancelled = false
    scene.environment = null
    void prepareTextureUpload(gl, resources, () => cancelled).then(ready => {
      if (!cancelled && ready) { onLoaded(resources); invalidate() }
    })
    return () => { cancelled = true; onLoaded(null) }
  }, [gl, resources, invalidate, onLoaded, scene])
  useEffect(() => () => resources.dispose(), [resources])
  return null
}
