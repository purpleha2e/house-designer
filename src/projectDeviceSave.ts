export type ProjectFileHandle = {
  name: string
  createWritable: () => Promise<{
    write: (contents: string) => Promise<void>
    close: () => Promise<void>
    abort: () => Promise<void>
  }>
}

type SavePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<ProjectFileHandle>

/** Invoke synchronously from the click, before serializing a large project can
 * consume the browser's transient user activation. Never silently download. */
export function chooseProjectSaveFile(fileName: string, host: { showSaveFilePicker?: SavePicker }, signal?: AbortSignal): Promise<ProjectFileHandle> {
  signal?.throwIfAborted()
  if (!host.showSaveFilePicker) return Promise.reject(new Error(
    'A Save As dialog is not available in this browser at this address. Use Chrome or Edge on localhost or HTTPS. Alternatively, enable “Ask where to save each file before downloading” in your browser’s download settings, then use Download copy.',
  ))
  const selection = host.showSaveFilePicker({ suggestedName: fileName,
    types: [{ description: 'House Designer model', accept: { 'application/json': ['.json'] } }] })
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new DOMException('Save cancelled', 'AbortError'))
    signal?.addEventListener('abort', cancel, { once: true })
    selection.then(handle => { signal?.removeEventListener('abort', cancel); resolve(handle) },
      error => { signal?.removeEventListener('abort', cancel); reject(error) })
    if (signal?.aborted) cancel()
  })
}

export async function writeProjectFile(handle: ProjectFileHandle, contents: string) {
  const stream = await handle.createWritable()
  try {
    await stream.write(contents)
    await stream.close()
  } catch (error) {
    await stream.abort().catch(() => {})
    throw error
  }
}

export function browserProjectSaveFile(fileName: string, signal?: AbortSignal) {
  return chooseProjectSaveFile(fileName, window as Window & { showSaveFilePicker?: SavePicker }, signal)
}
