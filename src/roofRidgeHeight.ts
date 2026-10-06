import type { RoofJunctionInput } from './roofJunctions.ts'
import { buildRoofProfileFaces } from './roofProfile.ts'
import { alignRoofHeight, type RoofHeightAlignmentStatus } from './roofHeightAlignment.ts'

export type RoofRidgeHeightLink = { state: 'linked' | 'unresolved'; targetRoofId: string; message?: string }

/** Height links are evaluated before joins and wall abutments. A bad link
 * keeps the authored height; neither loading nor resolution mutates it. */
export function resolveRoofRidgeHeights(inputs: RoofJunctionInput[]) {
  const byId = new Map(inputs.map(input => [input.roof.id, input]))
  const links = new Map<string, RoofRidgeHeightLink>()
  const alignments = new Map<string, RoofHeightAlignmentStatus>()
  const resolved = new Map<string, RoofJunctionInput>()
  const cyclic = new Set<string>()
  const visit = (input: RoofJunctionInput, path: string[]): RoofJunctionInput => {
    const id = input.roof.id
    if (path.includes(id)) {
      path.slice(path.indexOf(id)).forEach(candidate => cyclic.add(candidate))
      return input
    }
    if (resolved.has(id)) return resolved.get(id)!
    const targetRoofId = input.roof.type === 'up-and-over' && input.roof.asymmetricSides
      ? input.roof.ridgeHeightTargetRoofId : undefined
    let result = input
    if (targetRoofId) {
      const target = byId.get(targetRoofId)
      if (!target) links.set(id, { state: 'unresolved', targetRoofId, message: 'The ridge-height target is missing. Using the manual height.' })
      else {
        const receiving = visit(target, [...path, id])
        if (cyclic.has(id) || links.get(targetRoofId)?.state === 'unresolved' || alignments.get(targetRoofId)?.state === 'unresolved') {
          links.set(id, { state: 'unresolved', targetRoofId, message: 'The ridge-height link is circular or unresolved. Using the manual height.' })
        } else {
          const peak = Math.max(...buildRoofProfileFaces(receiving.roof, receiving.extents, receiving.support).flat().map(p => p[1]))
          const ridgeHeight = receiving.elevation + (receiving.roof.heightOffset ?? 0) + peak -
            input.elevation - (input.roof.heightOffset ?? 0)
          result = { ...input, roof: { ...input.roof, ridgeHeight } }
          // Matching ridge height must not introduce an unauthored pitch break
          // at the eaves. Undefined overhang pitch follows each side's slope.
          links.set(id, { state: 'linked', targetRoofId })
        }
      }
    }
    const alignment = input.roof.heightAlignment
    if (alignment) {
      const target = byId.get(alignment.targetRoofId)
      const receiving = target ? visit(target, [...path, id]) : undefined
      if (!receiving || cyclic.has(id) || links.get(alignment.targetRoofId)?.state === 'unresolved' ||
        alignments.get(alignment.targetRoofId)?.state === 'unresolved') {
        alignments.set(id, { state: 'unresolved', targetRoofId: alignment.targetRoofId,
          message: receiving ? 'The roof alignment is circular or unresolved. Using manual settings.' : 'The alignment target is missing. Using manual settings.' })
      } else {
        const aligned = alignRoofHeight(result, receiving)
        if (aligned.roof) result = { ...result, roof: aligned.roof }
        alignments.set(id, { state: aligned.roof ? 'linked' : 'unresolved', targetRoofId: alignment.targetRoofId, message: aligned.message })
      }
    }
    if (cyclic.has(id)) {
      result = input
      if (targetRoofId) links.set(id, { state: 'unresolved', targetRoofId,
        message: 'The roof height link is circular. Using the manual height.' })
    }
    resolved.set(id, result)
    return result
  }
  return { inputs: inputs.map(input => visit(input, [])), links, alignments }
}
