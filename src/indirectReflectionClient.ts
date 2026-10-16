import { CubeUVReflectionMapping, DataTexture, HalfFloatType, LinearFilter, LinearSRGBColorSpace, RGBAFormat,
  type WebGLCubeRenderTarget, type WebGLRenderer } from 'three'

/** Reflection filtering has its own WebGL context in a worker. PMREM shader
 * compilation and convolution must never run inside a display-frame callback. */
export class IndirectReflectionClient {
  private worker: Worker | undefined
  private nextId = 0
  private epoch = 0
  private pending = new Map<number, { resolve: (value: { width: number; height: number; pixels: Uint16Array }) => void; reject: (error: Error) => void }>()
  async filter(renderer: WebGLRenderer, cube: WebGLCubeRenderTarget) {
    const epoch = this.epoch
    const faces = Array.from({ length: 6 }, () => new Uint16Array(cube.width * cube.height * 4))
    const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel()
    let reads: Promise<unknown>[]
    try {
      renderer.setRenderTarget(null)
      reads = faces.map((data, index) => renderer.readRenderTargetPixelsAsync(cube, 0, 0, cube.width, cube.height, data, index))
    } finally { renderer.setRenderTarget(target, face, mip) }
    await Promise.all(reads)
    if (this.epoch !== epoch) throw new Error('Reflection filtering cancelled')
    const result = await this.request(cube.width, faces)
    const texture = new DataTexture(result.pixels, result.width, result.height, RGBAFormat, HalfFloatType)
    texture.mapping = CubeUVReflectionMapping; texture.colorSpace = LinearSRGBColorSpace
    texture.minFilter = texture.magFilter = LinearFilter; texture.generateMipmaps = false; texture.flipY = false; texture.needsUpdate = true
    return { texture, dispose() { texture.dispose() } }
  }
  private request(size: number, faces: Uint16Array[]) {
    return new Promise<{ width: number; height: number; pixels: Uint16Array }>((resolve, reject) => {
      if (!this.worker) {
        this.worker = new Worker(new URL('./indirectReflection.worker.ts', import.meta.url), { type: 'module' })
        this.worker.onmessage = ({ data }) => {
          const job = this.pending.get(data.id); this.pending.delete(data.id)
          if (data.ok) job?.resolve(data); else job?.reject(new Error(data.error))
        }
        this.worker.onerror = event => this.dispose(new Error(event.message || 'Reflection filtering failed'))
        this.worker.onmessageerror = () => this.dispose(new Error('Reflection filtering response could not be read'))
      }
      const id = ++this.nextId
      this.pending.set(id, { resolve, reject })
      try { this.worker.postMessage({ id, size, faces }, faces.map(data => data.buffer)) }
      catch (error) { this.pending.delete(id); reject(error) }
    })
  }
  dispose(error = new Error('Reflection filtering cancelled')) {
    this.epoch++
    this.worker?.terminate(); this.worker = undefined
    this.pending.forEach(job => job.reject(error)); this.pending.clear()
  }
}
