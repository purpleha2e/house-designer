import { planLayout, type RevisionGuidance } from './layoutPlanner.ts'
import { validateProposal } from './proposalValidation.ts'
import { planDimensionedExtension, planSecondStorey } from './extensionPlacement.ts'
import type { DimensionedExtension } from './extensionBrief.ts'
import type { Requirements } from './intent.ts'
import type { DesignProposal } from './proposal.ts'
import { captureArchitecturalScene, type SceneSnapshot, type SceneSource } from './scene.ts'

export type AssistantJob = { type: 'capture'; source: SceneSource } |
  { type: 'plan'; floor: 'current' | 'upstairs'; requirements: Requirements; revision?: RevisionGuidance } |
  { type: 'plan-extension'; brief: DimensionedExtension } |
  { type: 'plan-second-storey'; previous: DesignProposal | null; baseWallId?: string } |
  { type: 'validate'; proposal: DesignProposal }

let source: SceneSource | undefined
let scene: SceneSnapshot | undefined

self.onmessage = ({ data }: MessageEvent<AssistantJob>) => {
  try {
    if (data.type === 'capture') {
      source = data.source
      scene = captureArchitecturalScene(source)
      self.postMessage({ value: scene })
      return
    }
    if (!source || !scene) throw new Error('The architectural context could not be read.')
    if (data.type === 'plan-extension') {
      self.postMessage({ value: planDimensionedExtension(source, scene, data.brief) })
      return
    }
    if (data.type === 'plan-second-storey') {
      self.postMessage({ value: planSecondStorey(source, scene, data.previous, data.baseWallId) })
      return
    }
    if (data.type === 'plan') {
      self.postMessage({ value: planLayout(source, scene, data.floor, data.requirements, data.revision) })
      return
    }
    const floor = scene.floors.find(level => level.id === data.proposal.floorId)
    self.postMessage({ value: floor ? validateProposal(source, floor, data.proposal) : null })
  } catch (error) {
    console.warn('[House Designer assistant] Geometry check failed', error)
    self.postMessage({ error: 'I couldn’t check the geometry for this floor. Check the floor outline and stair, then try again.' })
  }
}
