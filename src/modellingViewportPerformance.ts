export const MODELLING_IDLE_DRAW_INTERVAL_MS = 500

const motionGraceMs = 200
const qualityHoldMs = 1200
const resolutionLevels = [1, .8, .65, .5]

/** Match the resolution to sustained rendering cost. Keep it steady through
 * brief pauses, and never use a single stalled frame to set the budget. */
export class ModellingViewportPerformance {
  private scale = 1
  private lastMotion = -Infinity
  private lastDraw: number | undefined
  private lastChange = -Infinity
  private fastSince: number | undefined
  private frameTimes: number[] = []

  update(now: number, motion: boolean, ready: boolean) {
    if (motion) this.lastMotion = now
    const sinceMotion = now - this.lastMotion
    const moving = sinceMotion < motionGraceMs
    const measure = moving && ready
    if (!measure) this.resetSamples()
    return { moving, measure, resolution: sinceMotion < qualityHoldMs ? this.scale : 1 }
  }

  presented(now: number) {
    const previous = this.lastDraw
    this.lastDraw = now
    if (previous === undefined) return
    const duration = now - previous
    // Browser long tasks, focus changes and sleep can leave a large gap
    // without revealing anything about the cost of a viewport draw.
    if (duration >= 500) {
      this.resetSamples()
      this.lastDraw = now
      return
    }
    this.frameTimes.push(duration)
    if (this.frameTimes.length > 8) this.frameTimes.shift()
    if (this.frameTimes.length < 4 || now - this.lastChange < 700) return
    const sorted = [...this.frameTimes].sort((a, b) => a - b)
    const typical = sorted[Math.floor((sorted.length - 1) / 2)]
    const lower = typical >= 85 ? .5 : typical >= 55 ? .65 : typical >= 43 && sorted.length === 8 ? .8 : 1
    if (lower < this.scale) {
      this.changeScale(lower, now)
      return
    }
    if (this.scale === 1) return
    const higher = resolutionLevels[resolutionLevels.indexOf(this.scale) - 1]
    // Leave headroom for the pixels the next tier would add. A frame rate
    // that is only just fast enough at half resolution is not a recovery.
    const recoveryBudget = Math.min(21, 33 * (this.scale / higher) ** 2)
    if (typical > recoveryBudget || duration > recoveryBudget * 1.5) {
      this.fastSince = undefined
      return
    }
    this.fastSince ??= now
    if (now - this.fastSince >= 1800) this.changeScale(higher, now)
  }

  private resetSamples() {
    this.lastDraw = this.fastSince = undefined
    this.frameTimes.length = 0
  }

  private changeScale(scale: number, now: number) {
    this.scale = scale
    this.lastChange = now
    this.resetSamples()
  }
}
