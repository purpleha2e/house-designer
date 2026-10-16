import { CubeTexture, DataTexture, HalfFloatType, LinearFilter, LinearSRGBColorSpace, PMREMGenerator, RGBAFormat, WebGLRenderer } from 'three'
let renderer: WebGLRenderer | undefined, generator: PMREMGenerator | undefined
self.onmessage = async ({ data }: MessageEvent<{ id: number; size: number; faces: Uint16Array[] }>) => {
  const textures = data.faces.map(face => new DataTexture(face, data.size, data.size, RGBAFormat, HalfFloatType))
  const cube = new CubeTexture(textures)
  cube.type = HalfFloatType; cube.format = RGBAFormat; cube.colorSpace = LinearSRGBColorSpace
  cube.minFilter = cube.magFilter = LinearFilter; cube.generateMipmaps = false; cube.needsUpdate = true
  try {
    renderer ??= new WebGLRenderer({ canvas: new OffscreenCanvas(1,1) })
    generator ??= new PMREMGenerator(renderer)
    renderer.initTexture(cube)
    // Captured cube images already use the render-target orientation. Upload
    // first, then preserve that convention through PMREM's environment flip.
    cube.isRenderTargetTexture = true
    const target = generator.fromCubemap(cube)
    try {
      const pixels = new Uint16Array(target.width * target.height * 4)
      await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height, pixels)
      self.postMessage({ id: data.id, ok: true, width: target.width, height: target.height, pixels }, { transfer: [pixels.buffer] })
    } finally { target.dispose() }
  } catch (error) { self.postMessage({ id: data.id, ok: false, error: error instanceof Error ? error.message : String(error) }) }
  finally { cube.dispose(); textures.forEach(texture => texture.dispose()) }
}
