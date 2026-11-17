/** Keep the latest switch intent while deferred scene commits catch up. A
 * one-shot event can be overwritten by an older pooled-light React commit.
 * Project/history restoration replaces these intents with its own switches. */
export function createLocalLightControl() {
  const listeners = new Map<string, Set<() => void>>()
  const enabledById = new Map<string, boolean>()
  return {
    getEnabled(id: string) { return enabledById.get(id) },
    setEnabled(id: string, enabled: boolean) {
      enabledById.set(id, enabled)
      listeners.get(id)?.forEach(listener => listener())
    },
    restore(switches: Iterable<readonly [string, boolean]>) {
      enabledById.clear()
      for (const [id, enabled] of switches) enabledById.set(id, enabled)
      listeners.forEach(group => group.forEach(listener => listener()))
    },
    subscribe(id: string, listener: () => void) {
      let group = listeners.get(id)
      if (!group) { group = new Set(); listeners.set(id, group) }
      group.add(listener)
      return () => { if (group.delete(listener) && !group.size && listeners.get(id) === group) listeners.delete(id) }
    },
  }
}
export type LocalLightControl = ReturnType<typeof createLocalLightControl>
