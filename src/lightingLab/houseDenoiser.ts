import { initUNetFromBuffer, type UNet } from 'oidn-webgpu'
import { filterIsolatedFireflies, flipImageRows } from './houseDenoisePixels'

const modelPath = `${import.meta.env.BASE_URL}render-models/oidn/rt_hdr_calb_cnrm.tza`

/** Local HDR OIDN, with clean albedo/normal guides. Model weights are served by
 * this application; rendered images are never uploaded to a denoising service. */
export class HouseDenoiser {
  private device?: GPUDevice
  private model?: UNet
  private disposed = false
  private abortFetch = new AbortController()
  private abortWork?: () => void
  private rejectWork?: (error: unknown) => void
  filteredPixels = 0

  async initialize() {
    if (!navigator.gpu) throw Error('HQ denoising requires WebGPU in this browser. Raw reference rendering is still available with denoising switched off.')
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw Error('No WebGPU adapter is available for HQ denoising')
    if (this.disposed) throw new DOMException('Render cancelled', 'AbortError')
    const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('shader-f16') ? ['shader-f16'] : [] })
    this.device = device
    if (this.disposed) { device.destroy(); throw new DOMException('Render cancelled', 'AbortError') }
    const response = await fetch(modelPath, { signal: this.abortFetch.signal })
    if (!response.ok) throw Error(`Could not load the denoising model (${response.status})`)
    const model = await initUNetFromBuffer(await response.arrayBuffer(), { device }, {
      hdr: true, aux: true, precision: 'auto', engine: 'wgsl', maxTileSize: 256, dynamicTile: false,
    })
    if (this.disposed) { model.dispose(); throw new DOMException('Render cancelled', 'AbortError') }
    this.model = model
  }

  async denoise(colour: Float32Array, albedo: Float32Array, normal: Float32Array, width: number, height: number, progress: (fraction: number) => void) {
    if (!this.model || this.disposed) throw Error('The HQ denoiser is not available')
    const model = this.model
    const filtered = filterIsolatedFireflies(colour, albedo, normal, width, height)
    this.filteredPixels = filtered.changedPixels
    const input = (data: Float32Array) => ({ data: flipImageRows(data, width, height), width, height })
    return new Promise<Float32Array>((resolve, reject) => {
      const clear = () => { this.abortWork = undefined; this.rejectWork = undefined }
      this.rejectWork = reject
      try {
        this.abortWork = model.tileExecute({
          color: input(filtered.values), albedo: input(albedo), normal: input(normal), scheduling: 'animation-frame',
          progress: (_output, _tileData, _tile, index, total) => progress((index + 1) / total),
          done: output => { clear(); resolve(flipImageRows(output.data, width, height)) },
          error: error => { clear(); reject(error) },
        })
      } catch (error) { clear(); reject(error) }
    })
  }

  stats() { return this.model?.getRuntimeInfo() }
  dispose() {
    this.disposed = true; this.abortFetch.abort(); this.abortWork?.(); this.abortWork = undefined
    this.rejectWork?.(new DOMException('Render cancelled', 'AbortError')); this.rejectWork = undefined
    this.model?.dispose(); this.model = undefined; this.device?.destroy(); this.device = undefined
  }
}
