import { validateAndMaterialize } from './layoutValidation.ts'
import { validateRoomRedesign } from './roomRedesign.ts'
import type { DesignProposal } from './proposal.ts'
import { captureArchitecturalScene, type SceneFloor, type SceneSource } from './scene.ts'
import { validateStairProposal } from './stairPlacement.ts'
import { validateExtensionProposal, validateUpperExtensionProposal } from './extensionPlacement.ts'
import { validateCoordinatedLayout } from './coordinatedLayout.ts'
import { validateModelVariantProposal } from './modelVariants.ts'

export function validateProposal(source: SceneSource, floor: SceneFloor, proposal: DesignProposal) {
  if (proposal.method === 'model-variants') return validateModelVariantProposal(source, proposal)
  if (proposal.method === 'coordinated') return validateCoordinatedLayout(source, floor, proposal)
  if (proposal.method === 'extension') {
    const operation = proposal.operations[0]
    if (operation?.type === 'extend-above') {
      const lower = captureArchitecturalScene(source).floors.find(item => item.id === operation.lowerFloorId)
      return lower ? validateUpperExtensionProposal(source, lower, floor, proposal) : null
    }
    if (operation?.type !== 'add-extension') return null
    const upper = operation.upperFloorId === null ? undefined :
      captureArchitecturalScene(source).floors.find(item => item.id === operation.upperFloorId)
    return validateExtensionProposal(source, floor, upper, proposal)
  }
  if (proposal.method === 'stair-placement') {
    const operation = proposal.operations[0]
    if (operation?.type !== 'add-stair') return null
    const upper = captureArchitecturalScene(source).floors.find(item => item.id === operation.upperFloorId)
    return validateStairProposal(source, floor, proposal, upper)
  }
  return proposal.method === 'room-redesign' ? validateRoomRedesign(source, floor, proposal) : validateAndMaterialize(source, floor, proposal)
}
