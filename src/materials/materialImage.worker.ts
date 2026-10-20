// Decode, resize and encode away from the editor's input/render thread.
self.onmessage = async (event: MessageEvent<{ id: number; file: File }>) => {
  const { id, file } = event.data
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.')
    const image = await createImageBitmap(file)
    let blob: Blob
    let width: number, height: number
    try {
      const scale = Math.min(1, 2048 / Math.max(image.width, image.height))
      width = Math.max(1, Math.round(image.width * scale)); height = Math.max(1, Math.round(image.height * scale))
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image processing is unavailable in this browser.')
      context.drawImage(image, 0, 0, width, height)
      blob = await canvas.convertToBlob({ type: 'image/png' })
    } finally { image.close() }
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    self.postMessage({ id, url, hash, width, height })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Could not read this image.' })
  }
}
