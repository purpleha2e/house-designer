import { prepareMaterialImage } from './prepareMaterialImage'

// Decode, resize and encode away from the editor's input/render thread.
self.onmessage = async (event: MessageEvent<{ id: number; file: File }>) => {
  const { id, file } = event.data
  try {
    self.postMessage({ id, ...await prepareMaterialImage(file) })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Could not read this image.' })
  }
}
