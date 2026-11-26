import type { ModelDefinition } from '../models/modelLibrary.ts'
import type { ToolArguments } from './architecturalTools.ts'
import type { DesignProposal, FloorChanges, FloorEdits, ModelVariantChange } from './proposal.ts'
import type { SceneSource } from './scene.ts'

export const BIFOLD_DOOR_MODELS = {
  closed: 'patio-doors-bifold-three-pane-closed',
  open: 'patio-doors-bifold-three-pane-open',
} as const

// A variant pair uses the same wall aperture and model origin in either state.
const variantPairs = [{ name: 'Three-pane bifold patio door', models: BIFOLD_DOOR_MODELS }]
export const modelVariantIds = variantPairs.flatMap(pair => Object.values(pair.models))

export function requestsModelVariants(prompt: string) {
  return /\b(?:bi[ -]?fold|patio doors?|model variants?)\b/i.test(prompt) && /\b(?:open|opened|close|closed|shut)\b/i.test(prompt) &&
    !/\b(?:add|install|new)\b/i.test(prompt)
}

function fitsSameOpening(from: ModelDefinition, to: ModelDefinition) {
  return !!from.wallMount && from.wallMount === to.wallMount && from.height === to.height &&
    (from.openingWidth ?? from.width) === (to.openingWidth ?? to.width) &&
    (from.openingCenterOffset ?? 0) === (to.openingCenterOffset ?? 0)
}

export function findModelVariants(source: SceneSource, { query, floorId }: ToolArguments<'find_model_variants'>) {
  const normalize = (text: string) => text.toLowerCase().replace(/\bbi[ -]fold\b/g, 'bifold').replace(/[^a-z\d ]/g, ' ')
  const words = normalize(query).match(/[a-z\d]+/g) ?? []
  const definitions = new Map(source.models.map(model => [model.id, model]))
  const candidates = variantPairs.flatMap(({ name, models }) => {
    const closed = definitions.get(models.closed), open = definitions.get(models.open)
    if (!closed || !open || !fitsSameOpening(closed, open)) return []
    if (!words.every(word => normalize(`${name} ${closed.name} ${open.name}`).includes(word))) return []
    return [{ name, variants: [{ modelId: closed.id, state: 'closed' }, { modelId: open.id, state: 'open' }] }]
  })
  const matchingIds = new Set(candidates.flatMap(candidate => candidate.variants.map(variant => variant.modelId)))
  const instances = source.floors.filter(floor => floorId === null || floor.id === floorId).flatMap(floor =>
    floor.models.flatMap(model => model.wallAttachment && matchingIds.has(model.modelId) ? [{
      instanceId: model.id, modelId: model.modelId, floorId: floor.id, wallId: model.wallAttachment.wallId,
      at: [model.position.x, model.position.y], selected: source.selection.modelIds.includes(model.id),
    }] : []))
  instances.sort((a, b) => Number(b.selected) - Number(a.selected))
  return { candidates, instances: instances.slice(0, 24), totalInstances: instances.length }
}

export function validateModelVariantProposal(source: SceneSource, proposal: DesignProposal): FloorEdits | null {
  if (proposal.version !== 1 || proposal.projectId !== source.projectId || proposal.sourceRevision !== source.revision ||
    !proposal.operations.length || proposal.operations.length > 24) return null
  const definitions = new Map(source.models.map(model => [model.id, model]))
  const floorEdits = new Map<string, FloorChanges & { modelVariants: ModelVariantChange[] }>()
  for (const operation of proposal.operations) {
    if (operation.type !== 'replace-model-variant') return null
    const { floorId, instanceId, fromModelId, modelId } = operation
    const floor = source.floors.find(level => level.id === floorId)
    const instance = floor?.models.find(model => model.id === instanceId)
    const from = definitions.get(fromModelId), to = definitions.get(modelId)
    if (!floor || !instance?.wallAttachment || instance.modelId !== fromModelId || !from || !to || from === to ||
      !variantPairs.some(pair => {
        const { open, closed } = pair.models
        return fromModelId === open && modelId === closed || fromModelId === closed && modelId === open
      }) || !fitsSameOpening(from, to) || !floor.walls.some(wall => wall.id === instance.wallAttachment?.wallId) ||
      !floor.walls.some(wall => wall.openings?.some(opening => opening.modelId === fromModelId &&
        (opening.id === instanceId || opening.id.startsWith(`${instanceId}:wall:`))))) return null
    const edits = floorEdits.get(floorId) ?? { rooms: floor.rooms, walls: [], models: [], modelVariants: [] }
    if (edits.modelVariants.some(change => change.instanceId === instanceId)) return null
    edits.modelVariants.push(operation)
    floorEdits.set(floorId, edits)
  }
  const primary = floorEdits.get(proposal.floorId)
  if (!primary) return null
  floorEdits.delete(proposal.floorId)
  return { ...primary, additionalFloors: [...floorEdits].map(([floorId, edits]) => ({ floorId, edits })) }
}

export function proposeModelVariants(source: SceneSource, { replacements }: ToolArguments<'propose_model_variants'>, id: string): DesignProposal | null {
  const operations: ModelVariantChange[] = replacements.map(({ floorId, instanceId, modelId }) => ({
    type: 'replace-model-variant', floorId, instanceId, modelId,
    fromModelId: source.floors.find(floor => floor.id === floorId)?.models.find(model => model.id === instanceId)?.modelId ?? '',
  }))
  const primaryId = replacements.some(change => change.floorId === source.selection.floorId) ? source.selection.floorId : replacements[0]?.floorId
  const primary = source.floors.find(floor => floor.id === primaryId)
  if (!primary) return null
  const count = operations.length
  const title = operations.every(op => op.modelId === BIFOLD_DOOR_MODELS.open) ? 'Open bifold doors' :
    operations.every(op => op.modelId === BIFOLD_DOOR_MODELS.closed) ? 'Close bifold doors' : 'Change model variants'
  const explanation = `Preview ${count === 1 ? 'the replacement door model' : `${count} replacement door models`} in the 3D view. The existing doorway dimensions and positions are retained.`
  const proposal: DesignProposal = {
    version: 1, method: 'model-variants', id, projectId: source.projectId, sourceRevision: source.revision,
    floorId: primary.id, floorName: primary.name, operations, rooms: [], stairId: '', workspaceSignature: 'model-variants',
    requirements: { bedrooms: 1, bathrooms: 1, landing: 'standard', bathroom: 'standard', primaryBedroom: 'standard', oppositeBedroom: null },
    priority: 'landing', assumptions: [], warnings: [],
    validation: { passed: true, checks: ['Replacement models are available and fit the existing openings'] },
    narrative: { title, explanation, advantages: [], compromises: [] }, tradeoff: '',
    preserved: { wallIds: primary.walls.map(wall => wall.id), openingIds: primary.walls.flatMap(wall => (wall.openings ?? []).map(opening => opening.id)), stairId: '', stairOpenings: [] },
    metrics: { smallestBedroom: 0, bedroomArea: 0, bathroomArea: 0, landingArea: 0, circulationWidth: 0,
      daylitBedrooms: 0, landingDaylight: false, usableArea: 0 },
    landingRoute: [], layoutAxis: 0,
  }
  return validateModelVariantProposal(source, proposal) ? proposal : null
}
