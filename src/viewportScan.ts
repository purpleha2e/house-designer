/** Wake scene scans after an edit without waiting for the fallback poll. One
 * scan owns its mutations at a time; edits arriving mid-scan get a fresh pass. */
export function createViewportScanScheduler(scan: () => Promise<void>, interval = 500) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false, requested = false, disposed = false
  const run = async () => {
    timer = undefined
    if (disposed) return
    running = true
    try {
      do { requested = false; await scan() } while (requested && !disposed)
    } finally {
      running = false
      if (!disposed) timer = setTimeout(() => { void run() }, interval)
    }
  }
  return {
    request() {
      if (disposed) return
      requested = true
      clearTimeout(timer)
      if (!running) timer = setTimeout(() => { void run() }, 0)
    },
    dispose() { disposed = true; clearTimeout(timer) },
  }
}
