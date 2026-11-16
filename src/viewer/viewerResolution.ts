/** Measure movement only: idle frames and startup work must not lower quality. */
export class ViewerResolution {
  scale = 1
  private elapsed = 0
  private frames = 0
  private cooldown = 0
  private fastWindows = 0

  sample(delta: number, moving: boolean, ready: boolean): number {
    if (!moving || !ready || !Number.isFinite(delta) || delta <= 0 || delta > .25) {
      this.elapsed = this.frames = this.fastWindows = 0
      return this.scale
    }
    this.cooldown = Math.max(0, this.cooldown - delta)
    this.elapsed += delta
    this.frames++
    if (this.elapsed < 1 || this.frames < 8) return this.scale
    const fps = this.frames / this.elapsed
    this.elapsed = this.frames = 0
    const levels = [1, .85, .7, .6]
    const index = levels.indexOf(this.scale)
    this.fastWindows = fps > 55 ? this.fastWindows + 1 : 0
    if (fps < 28 && !this.cooldown && index < levels.length - 1) {
      this.scale = levels[index + 1]
      this.cooldown = 2
      this.fastWindows = 0
    } else if (this.fastWindows >= 6 && !this.cooldown && index > 0) {
      this.scale = levels[index - 1]
      this.cooldown = 8
      this.fastWindows = 0
    }
    return this.scale
  }
}
