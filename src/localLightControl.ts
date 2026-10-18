/** Uniform preview for an editor's installed lamps. Persisted state and GI still
 * follow the normal model update, without delaying the direct light switch. */
export function createLocalLightControl() {
  const listeners = new Map<string, Set<(enabled: boolean) => void>>()
  return {
    setEnabled(id: string, enabled: boolean) { listeners.get(id)?.forEach(listener => listener(enabled)) },
    subscribe(id: string, listener: (enabled: boolean) => void) {
      let group = listeners.get(id)
      if (!group) { group = new Set(); listeners.set(id, group) }
      group.add(listener)
      return () => { if (group.delete(listener) && !group.size && listeners.get(id) === group) listeners.delete(id) }
    },
  }
}
export type LocalLightControl = ReturnType<typeof createLocalLightControl>
