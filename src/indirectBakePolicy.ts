/** A manual bake belongs to the exact authored input that requested it. Editing
 * cancels that permission; loading/saving a project never starts a bake. */
export function createIndirectBakePolicy() {
  let requestedInput: string | undefined, previousInput: string | undefined, request = 0, allowed = false
  return {
    update(input: string, nextRequest: number, automatic: boolean) {
      if (previousInput !== input) requestedInput = undefined
      previousInput = input
      if (nextRequest !== request) { request = nextRequest; requestedInput = input }
      allowed = automatic || requestedInput === input
      return allowed
    },
    get allowed() { return allowed },
    get request() { return request },
    cancel() { requestedInput = undefined; allowed = false },
  }
}
