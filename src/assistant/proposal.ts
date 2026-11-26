import type { LayoutPriority, Requirements, RoomFunction } from './intent.ts'
import type { FloorLevel, Point, Room, Wall, PlacedModel } from '../types.ts'
import type { ModelDefinition } from '../models/modelLibrary.ts'
import type { ToolArguments } from './architecturalTools.ts'

export type Partition = { type: 'create-partition'; id: string; start: Point; end: Point; thickness: number; height: number }
export type Doorway = {
  type: 'create-doorway'; id: string; wallId: string; roomId: string; offset: number;
  position: Point; rotation: number; side: -1 | 1; width: number; height: number;
  exterior?: 'front' | 'patio';
}
export type RoomLabel = { type: 'label-room'; roomId: string; name: string; function: RoomFunction }
export type PartitionChange = { type: 'move-partition'; wallId: string; start: Point; end: Point } | { type: 'remove-partition'; wallId: string }
export type RemovedOpening = { type: 'remove-opening'; openingId: string }
export type NewWindow = { type: 'create-window'; id: string; wallId: string; offset: number; width: number; height: number; bottom: number; position: Point; rotation: number }
export type NewStair = { type: 'add-stair'; id: string; upperFloorId: string; position: Point; rotation: number;
  layout: 'straight' | 'l' | 'u'; turn: 'left' | 'right'; width: number }
export type ExtensionSpan = { wallId: string; depth: number }
export type NewExtension = { type: 'add-extension'; id: string; upperFloorId: string | null; spans: ExtensionSpan[] }
export type UpperExtension = { type: 'extend-above'; id: string; lowerFloorId: string; baseWallId: string }
export type ExtensionBasis = { floorId: string; operation: NewExtension | UpperExtension }
export type ModelVariantChange = { type: 'replace-model-variant'; floorId: string; instanceId: string; fromModelId: string; modelId: string }
export type DesignOperation = Partition | Doorway | RoomLabel | PartitionChange | RemovedOpening | NewWindow | NewStair | NewExtension | UpperExtension | ModelVariantChange

export type ProposedRoom = {
  id: string; name: string; function: RoomFunction; polygon: Point[]; labelPoint: Point;
  area: number; windowIds: string[];
}

export type RoomRedesign = {
  landingId: string;
  bedroomIds: string[];
  sharedBathroomId: string | null;
  ensuites: Array<{ bedroomId: string; bathroomId: string }>;
  home?: { kitchenDinerId: string | null; utilityId: string | null; utilityAccess?: 'hallway' | 'kitchen' };
}
export type WindowExclusion = NonNullable<FloorLevel['assistantWindowExclusion']>

export type DesignProposal = {
  version: 1; id: string; projectId: string; sourceRevision: string; floorId: string; floorName: string;
  method?: 'agent' | 'room-redesign' | 'stair-placement' | 'extension' | 'coordinated' | 'model-variants';
  coordinated?: ToolArguments<'compose_two_storey_layout'>;
  extensionBasis?: ExtensionBasis;
  redesign?: RoomRedesign;
  windowExclusion?: WindowExclusion;
  narrative?: { title: string; explanation: string; advantages: string[]; compromises: string[] };
  workspaceSignature: string; stairId: string; requirements: Requirements; priority: LayoutPriority;
  assumptions: string[]; rooms: ProposedRoom[]; operations: DesignOperation[];
  validation: { passed: true; checks: string[] }; warnings: string[]; tradeoff: string;
  preserved: { wallIds: string[]; openingIds: string[]; stairId: string; stairOpenings: Point[][] };
  metrics: { smallestBedroom: number; bedroomArea: number; bathroomArea: number; landingArea: number;
    circulationWidth: number; daylitBedrooms: number; landingDaylight: boolean; usableArea: number };
  landingRoute: Point[][];
  layoutAxis: number;
}

export type PlanningResult = { proposals: DesignProposal[]; message: string }
export type FloorChanges = { walls: Wall[]; models: PlacedModel[]; rooms: Room[]; removedWallIds?: string[]; removedModelIds?: string[];
  windowExclusion?: WindowExclusion; floorFootprints?: Point[][]; modelVariants?: ModelVariantChange[] }
export type FloorEdits = FloorChanges & {
  stair?: { definition: ModelDefinition; upperFloorId: string; openings: Point[][] }
  overlays?: Record<string, Pick<DesignProposal, 'operations' | 'rooms' | 'preserved'>>
  additionalFloors?: Array<{ floorId: string; edits: FloorChanges }>
}
export type DesignOption = { proposal: DesignProposal; edits: FloorEdits }

export function materializeFloorEdits(floor: FloorLevel, edits: FloorChanges): FloorLevel {
  if (edits.modelVariants) {
    const variants = new Map(edits.modelVariants.map(change => [change.instanceId, change]))
    return { ...floor,
      models: floor.models.map(model => {
        const change = variants.get(model.id)
        return change?.fromModelId === model.modelId ? { ...model, modelId: change.modelId } : model
      }),
      walls: floor.walls.map(wall => {
        let changed = false
        const openings = wall.openings?.map(opening => {
          const change = variants.get(opening.id) ?? variants.get(opening.id.split(':wall:')[0])
          if (change?.fromModelId !== opening.modelId) return opening
          changed = true
          return { ...opening, modelId: change.modelId }
        })
        return changed ? { ...wall, openings } : wall
      }),
    }
  }
  const changedWalls = new Map(edits.walls.map(wall => [wall.id, wall]))
  const removedWalls = new Set(edits.removedWallIds)
  const removedModels = new Set(edits.removedModelIds)
  const existingWallIds = new Set(floor.walls.map(wall => wall.id))
  const walls = floor.walls.filter(wall => !removedWalls.has(wall.id))
    .map(wall => changedWalls.get(wall.id) ?? wall)
    .concat(edits.walls.filter(wall => !existingWallIds.has(wall.id)))
  return { ...floor, walls, rooms: edits.rooms, assistantWindowExclusion: edits.windowExclusion ?? floor.assistantWindowExclusion,
    ...(edits.floorFootprints && { floorFootprints: edits.floorFootprints }),
    models: [...floor.models.filter(model => !removedModels.has(model.id)), ...edits.models] }
}

export function materializeProposalFloors(floors: FloorLevel[], floorId: string, edits: FloorEdits): FloorLevel[] | null {
  const changes = new Map([[floorId, edits], ...(edits.additionalFloors ?? []).map(({ floorId, edits }) => [floorId, edits] as const)])
  if (changes.size !== 1 + (edits.additionalFloors?.length ?? 0) ||
    [...changes.keys()].some(id => !floors.some(floor => floor.id === id))) return null
  return floors.map(floor => {
    const change = changes.get(floor.id)
    return change ? materializeFloorEdits(floor, change) : floor
  })
}
