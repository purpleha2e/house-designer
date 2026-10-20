import type { Object3D } from 'three'

type Position = { x: number; y: number; z: number }
type Target = { visible: boolean }
type Rule = (position: Position) => boolean
const rules = new WeakMap<Target, Rule>()

/** Camera-hidden surfaces still belong to a navigable prepared scene. */
export function registerViewportSurfaceVisibility(target: Target, rule: Rule) {
  rules.set(target, rule)
  return () => { if (rules.get(target) === rule) rules.delete(target) }
}
export const hasViewportSurfaceVisibility = (target: Target) => rules.has(target)
export function includeViewportObject(object: Object3D) {
  for (let parent: Object3D | null = object; parent; parent = parent.parent) {
    if (!parent.visible && !rules.has(parent)) return false
  }
  return true
}

/** Capture rules with the snapshot so even replaced editor geometry can be viewed from either storey. */
export function createViewportSurfaceVisibility() {
  const bindings: { target: Target; rules: Rule[] }[] = []
  return {
    bindObject(source: Object3D, target: Object3D) {
      const inherited: Rule[] = []
      for (let parent: Object3D | null = source; parent; parent = parent.parent) {
        const rule = rules.get(parent)
        if (rule) inherited.push(rule)
      }
      if (inherited.length) bindings.push({ target, rules: inherited })
    },
    bindMaterial(source: Target, target: Target) {
      const rule = rules.get(source)
      if (rule) bindings.push({ target, rules: [rule] })
    },
    sync(position: Position) {
      let changed = false
      for (const binding of bindings) {
        const visible = binding.rules.every(rule => rule(position))
        if (binding.target.visible !== visible) { binding.target.visible = visible; changed = true }
      }
      return changed
    },
  }
}
