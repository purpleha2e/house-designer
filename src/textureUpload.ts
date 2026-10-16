import { Box2, Box3, Data3DTexture, DataTexture, Vector2, Vector3, type TypedArray, type WebGLRenderer } from 'three'
import { waitForViewportIdle } from './viewportScheduling.ts'
const uploads = new WeakMap<WebGLRenderer, WeakMap<DataTexture | Data3DTexture, number>>()

/** Allocate without uploading the entire CPU array, then copy bounded regions
 * between input/display tasks. Keep the old lighting published until complete. */
export async function prepareTextureUpload(renderer: WebGLRenderer, texture: DataTexture | Data3DTexture,
  cancelled: () => boolean = () => false) {
  const image = texture.image, version = texture.version
  let uploadedVersions = uploads.get(renderer)
  if (!uploadedVersions) { uploadedVersions = new WeakMap(); uploads.set(renderer,uploadedVersions) }
  const data = image.data as unknown as ArrayBufferView
  const stopped = () => cancelled() || texture.version !== version
  if (stopped()) return false
  if (uploadedVersions.get(texture) === version && renderer.properties.has(texture)) return true
  if (data.byteLength <= 128 * 1024) { renderer.initTexture(texture); uploadedVersions.set(texture,version); return !stopped() }
  const initialize = () => {
    const ready = texture.source.dataReady
    texture.source.dataReady = false
    try { renderer.initTexture(texture) }
    finally { texture.source.dataReady = ready }
  }
  // A currently displayed texture must acknowledge the new version before
  // yielding, or the next display draw would upload its entire array itself.
  const existing = renderer.properties.has(texture)
  if (existing) initialize()
  if (!await waitForViewportIdle(stopped)) return false
  if (!existing) initialize()
  const depth = texture instanceof Data3DTexture ? texture.image.depth : 1
  const bytesPerRow = data.byteLength / (depth * image.height)
  const rows = Math.max(1, Math.floor(64 * 1024 / bytesPerRow))
  // An unregistered source selects Three's CPU-array upload path. Reusing the
  // destination object here would select a framebuffer-to-itself GPU copy.
  const source = texture instanceof Data3DTexture ? new Data3DTexture() : new DataTexture()
  source.image = image; source.type = texture.type; source.format = texture.format
  let batchStarted = performance.now(), batchBytes = 0
  try { for (let z = 0; z < depth; z++) for (let y = 0; y < image.height; y += rows) {
    // Yield per bounded batch, not per 64 KB copy. Nested browser timers have
    // a minimum delay; a timer for every small slice adds seconds to GI uploads.
    if (batchBytes >= 512 * 1024 || performance.now() - batchStarted >= 2) {
      if (!await waitForViewportIdle(stopped)) return false
      batchStarted = performance.now(); batchBytes = 0
    }
    if (stopped()) return false
    const end = Math.min(image.height, y + rows)
    if (texture instanceof Data3DTexture) renderer.copyTextureToTexture(source, texture,
      new Box3(new Vector3(0,y,z), new Vector3(image.width,end,z+1)), new Vector3(0,y,z))
    else renderer.copyTextureToTexture(source, texture,
      new Box2(new Vector2(0,y), new Vector2(image.width,end)), new Vector2(0,y))
    batchBytes += (end - y) * bytesPerRow
  }
  if (stopped()) return false
  uploadedVersions.set(texture,version)
  return true } finally { source.dispose() }
}

export function prepareTextureReplacement(renderer: WebGLRenderer, previous: Data3DTexture, cancelled: () => boolean, data?: TypedArray): Promise<Data3DTexture|undefined>
export function prepareTextureReplacement(renderer: WebGLRenderer, previous: DataTexture, cancelled: () => boolean, data?: TypedArray): Promise<DataTexture|undefined>
export async function prepareTextureReplacement(renderer: WebGLRenderer, previous: DataTexture|Data3DTexture, cancelled: () => boolean, data?: TypedArray) {
  const texture=previous instanceof Data3DTexture
    ?new Data3DTexture(data??previous.image.data,previous.image.width,previous.image.height,previous.image.depth)
    :new DataTexture(data??previous.image.data,previous.image.width,previous.image.height)
  texture.type=previous.type;texture.format=previous.format;texture.colorSpace=previous.colorSpace
  texture.mapping=previous.mapping;texture.internalFormat=previous.internalFormat
  texture.minFilter=previous.minFilter;texture.magFilter=previous.magFilter;texture.unpackAlignment=previous.unpackAlignment
  texture.wrapS=previous.wrapS;texture.wrapT=previous.wrapT;texture.flipY=previous.flipY;texture.generateMipmaps=false;texture.needsUpdate=true
  if(texture instanceof Data3DTexture&&previous instanceof Data3DTexture)texture.wrapR=previous.wrapR
  if(!await prepareTextureUpload(renderer,texture,cancelled)){texture.dispose();return undefined}
  return texture
}
