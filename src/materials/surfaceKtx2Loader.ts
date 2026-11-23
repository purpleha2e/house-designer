import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import type { CompressedTexture } from 'three'

export class SurfaceKtx2Loader extends KTX2Loader {
  private arbitrarySize?: KTX2Loader

  override parse(buffer: ArrayBuffer, onLoad?: (texture: CompressedTexture) => void, onError?: (error: unknown) => void) {
    if (!this.workerConfig || buffer.byteLength < 28) return super.parse(buffer, onLoad, onError)
    const header = new DataView(buffer)
    const basis = header.getUint32(12, true) === 0
    const width = header.getUint32(20, true), height = header.getUint32(24, true)
    const requiresAlignedBlocks = this.workerConfig.dxtSupported || this.workerConfig.bptcSupported
    if (!basis || !requiresAlignedBlocks || (width % 4 === 0 && height % 4 === 0)) {
      return super.parse(buffer, onLoad, onError)
    }

    // WebGL rejects BC/S3TC storage when the base dimensions are not a
    // multiple of four. Keep the authored dimensions and transcode those
    // images through an available ETC/ASTC format or the RGBA fallback.
    this.arbitrarySize ??= new KTX2Loader(this.manager).setWorkerLimit(1)
    this.arbitrarySize.workerConfig = { ...this.workerConfig, dxtSupported: false, bptcSupported: false }
    return this.arbitrarySize.parse(buffer, onLoad, onError)
  }

  override dispose() {
    this.arbitrarySize?.dispose()
    this.arbitrarySize = undefined
    return super.dispose()
  }
}
