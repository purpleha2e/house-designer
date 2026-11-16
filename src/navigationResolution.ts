/** Reduce pixel work only during slow navigation; retain full detail at rest. */
export class NavigationResolution {
  private movingScale = 1
  private elapsed = 0
  private frames = 0
  private idle = Infinity
  private fastWindows = 0
  private wasMoving = false

  sample(delta: number, moving: boolean, ready: boolean) {
    if (!ready || !Number.isFinite(delta) || delta <= 0 || delta >= .5) {
      this.elapsed = this.frames = this.fastWindows = 0
      this.wasMoving = false
      return 1
    }
    if (!moving) {
      this.idle += delta
      this.elapsed = this.frames = this.fastWindows = 0
      this.wasMoving = false
      return this.idle >= .2 ? 1 : this.movingScale
    }
    this.idle = 0
    // The first delta belongs to the previous stationary frame, which might
    // have been expensive precisely because it was drawn at full resolution.
    if (!this.wasMoving) { this.wasMoving = true; return this.movingScale }
    this.elapsed += delta
    this.frames++
    if (this.elapsed >= .7 && this.frames >= 4) {
      const fps = this.frames / this.elapsed
      const levels = [1, .85, .7, .6, .5]
      const index = levels.indexOf(this.movingScale)
      this.fastWindows = fps > 55 ? this.fastWindows + 1 : 0
      if (fps < 28 && index < levels.length - 1) {
        this.movingScale = levels[index + 1]
        this.fastWindows = 0
      } else if (this.fastWindows >= 8 && index > 0) {
        this.movingScale = levels[index - 1]
        this.fastWindows = 0
      }
      this.elapsed = this.frames = 0
    }
    return this.movingScale
  }
}
