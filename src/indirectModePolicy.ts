/** Suspend the legacy solver without treating a display-mode change as an edit.
 * Edits made while suspended invalidate its export once and resume as one job. */
export function createIndirectModePolicy() {
  let suspended = false, previousInput: string | undefined, dirty = false, interrupted = false
  return {
    update(modelling: boolean, input: string, pending: boolean) {
      const changed = previousInput !== undefined && previousInput !== input
      previousInput = input
      if (modelling) {
        const suspend = !suspended
        suspended = true
        interrupted ||= suspend && pending
        const invalidate = changed && !dirty
        dirty ||= changed
        return { suspend, invalidate, resume: false }
      }
      const resume = suspended && (dirty || interrupted)
      suspended = false; dirty = false; interrupted = false
      return { suspend: false, invalidate: false, resume }
    },
    defer() {
      if (!suspended || dirty) return false
      dirty = true
      return true
    },
    get suspended() { return suspended },
    get dirty() { return dirty },
  }
}
