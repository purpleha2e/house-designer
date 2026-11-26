/** Give callers a deadline even when an underlying transport never settles its promise. */
export function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cleanUp = () => signal.removeEventListener('abort', abort)
    const fail = (error: unknown) => { cleanUp(); reject(error) }
    const abort = () => fail(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    try { work().then(value => { cleanUp(); resolve(value) }, fail) }
    catch (error) { fail(error) }
  })
}
