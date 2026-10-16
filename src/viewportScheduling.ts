/** Keep background render work out of active navigation, including the gap
 * between an input event and the frame that consumes it. */
let navigationUntil = 0
let preparations = 0
const preparationListeners = new Set<() => void>()
export const isViewportPreparationPending = () => preparations > 0
export function subscribeViewportPreparation(listener: () => void) {
  preparationListeners.add(listener)
  return () => { preparationListeners.delete(listener) }
}
function updatePreparation(delta: number) {
  const wasPending = preparations > 0
  preparations += delta
  if (wasPending !== (preparations > 0)) preparationListeners.forEach(listener => listener())
}
/** Bounded renderer-side preparation shares the retained-display gate with workers. */
export async function runViewportPreparation<T>(steps: Generator<void,T>, cancelled: () => boolean) {
  updatePreparation(1)
  try { return await runViewportTask(steps, cancelled) }
  finally { updatePreparation(-1) }
}
/** A worker finishing must not start an expensive React update during a walk. */
export function publishViewportUpdate(apply: () => void, cancelled: () => boolean) {
  return runViewportPreparation((function* () { yield; apply(); return true })(), cancelled)
}
export function markViewportNavigation(now = performance.now()) { navigationUntil = now + 200 }
export function isViewportNavigating(now = performance.now()) { return now < navigationUntil }

/** Yield a task, allowing input and a display frame before the next CPU batch. */
export function yieldToViewport() {
  return new Promise<void>(resolve => setTimeout(resolve, 0))
}

export async function waitForViewportIdle(cancelled: () => boolean = () => false) {
  await yieldToViewport()
  while (!cancelled() && isViewportNavigating()) await new Promise(resolve => setTimeout(resolve, 50))
  return !cancelled()
}

export async function runViewportTask<T>(steps: Generator<void,T>, cancelled: () => boolean) {
  while (await waitForViewportIdle(cancelled)) {
    const start = performance.now()
    do {
      const next = steps.next()
      if (next.done) return next.value
    } while (performance.now()-start<3)
  }
  steps.return(undefined!)
  return undefined
}

/** Navigation is real-time input, never a simulation that catches up lost time.
 * Reject events created during a blocked frame; always process key/button releases. */
export class CameraInputTiming {
  private lastFrame: number
  private discardBefore = -Infinity
  constructor(now = performance.now()) { this.lastFrame = now }
  frame(delta: number, now = performance.now()) {
    if (!Number.isFinite(delta) || delta < 0 || delta > .1) {
      this.discardBefore = now
      this.lastFrame = now
      return 0
    }
    this.lastFrame = now
    return Math.min(delta, .05)
  }
  accepts(timeStamp: number, now = performance.now()) {
    return now - this.lastFrame <= 100 && timeStamp >= this.discardBefore && now - timeStamp <= 100
  }
}
