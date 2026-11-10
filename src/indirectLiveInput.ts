import type { IndirectLocalLight } from './components/IndirectLighting.tsx'

/** Lamp uniforms can reach the renderer before a deferred house reconciliation. */
export function createIndirectLiveInput() {
  let snapshot = { key: '', lights: [] as IndirectLocalLight[] }
  const listeners = new Set<() => void>()
  return {
    get: () => snapshot,
    set(lights: IndirectLocalLight[]) {
      const key = JSON.stringify(lights)
      if (key === snapshot.key) return
      snapshot = { key, lights }; listeners.forEach(listener => listener())
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}
export type IndirectLiveInput = ReturnType<typeof createIndirectLiveInput>

/** Moving/adding lamps requires new exact visibility; only uniforms bypass it. */
export function sameIndirectLightLayout(a: IndirectLocalLight[], b: IndirectLocalLight[]) {
  return a.length === b.length && a.every((light,i) => light.kind === b[i].kind &&
    light.position.every((value,axis) => value === b[i].position[axis]) &&
    light.target.every((value,axis) => value === b[i].target[axis]))
}
