import type { ModelDefinition } from '../models/modelLibrary.ts'
import type { FloorLevel, Point, Room, Wall } from '../types.ts'
import { getFloorSlabFootprints } from '../ceilingSlabFootprint.ts'
import { getStairLandingPosition } from '../stairLandings.ts'
import { getStairSlabOpenings } from '../stairSlabOpenings.ts'
import { buildWallTopology } from '../wallTopology.ts'
import { isPlanDoor } from '../doorPlan.ts'
import { BIFOLD_DOOR_MODELS, modelVariantIds } from './modelVariants.ts'

export const ASSISTANT_DOOR_MODEL = 'panel-interior-door-closed'
export const ASSISTANT_WINDOW_MODEL = 'window-large-single-pane'
export const ASSISTANT_EXTERIOR_DOOR_MODELS = { front: 'front-door', patio: BIFOLD_DOOR_MODELS.closed } as const

export type SceneSource = {
  projectId: string
  revision: string
  floors: FloorLevel[]
  models: ModelDefinition[]
  selection: { floorId: string; roomSignature: string | null; wallIds: string[]; modelIds: string[]; roofId: string | null }
  partitionThickness: number
  wallMaterials?: Array<{ wallId: string; materialId: string }>
  roofIdsByFloor?: Array<{ floorId: string; ids: string[] }>
}

type Opening = {
  id: string; modelId: string; kind: 'door' | 'window' | 'opening'; wallId: string;
  center: number; position: Point; bottom: number; height: number; width: number
}

export type SceneRoom = {
  id: string; signature: string; name: string | null; function?: Room['function']; polygon: Point[]; area: number
}

export type SceneStair = {
  id: string; sourceFloorId: string; openings: Point[][]; upperEdge: Point;
  upperDirection: Point; clearWidth: number; riseMismatch: number
}

export type SceneFloor = {
  id: string; name: string; elevation: number; roomHeight: number; slabThickness: number;
  footprint: Point[][]; walls: Array<Pick<Wall, 'id' | 'kind' | 'start' | 'end' | 'height' | 'thickness'>>;
  openings: Opening[]; rooms: SceneRoom[]; stairsFromBelow: SceneStair[]; stairIds: string[];
  lockedObjectIds: string[]; roofIds: string[]
}

export type SceneSnapshot = {
  version: 1; projectId: string; revision: string; units: 'metres';
  coordinateSystem: 'plan x/y; elevation maps to world y';
  selection: SceneSource['selection']; floors: SceneFloor[]; constraints: string[]
}

/** Copy only data used by the architectural worker. Keep image data, meshes and surface assets out. */
export function makeSceneSource(input: Omit<SceneSource, 'floors' | 'models'> & {
  floors: FloorLevel[]; models: ReadonlyMap<string, ModelDefinition>
}): SceneSource {
  const definitions = new Map<string, ModelDefinition>()
  const floors = input.floors.map(floor => ({
    id: floor.id, name: floor.name, elevation: floor.elevation, roomHeight: floor.roomHeight,
    slabThickness: floor.slabThickness, walls: floor.walls, floorFootprints: floor.floorFootprints,
    assistantWindowExclusion: floor.assistantWindowExclusion,
    rooms: floor.rooms, roofs: floor.roofs,
    models: floor.models.flatMap(model => {
      const definition = input.models.get(model.modelId)
      if (definition?.objectType !== 'stairs' && !model.wallAttachment) return []
      if (definition) definitions.set(definition.id, definition)
      const { id, modelId, position, rotation, scale, flipped, mirrored, widthScale, depthScale, wallAttachment } = model
      return [{ id, modelId, position, rotation, scale, flipped, mirrored, widthScale, depthScale, wallAttachment }]
    }),
  }))
  for (const id of [ASSISTANT_DOOR_MODEL, ASSISTANT_WINDOW_MODEL, ASSISTANT_EXTERIOR_DOOR_MODELS.front, ...modelVariantIds]) {
    const model = input.models.get(id)
    if (model) definitions.set(id, model)
  }
  const models = [...definitions.values()].map(definition => {
    const { id, name, category, color, height, width, depth, shape, wallMount, objectType, stairDesign,
      stairFootprint, stairLandings, stairLandingDirections, localBounds, normalizeToDimensions,
      openingCenterOffset, openingWidth, doorLeafCount } = definition
    return { id, name, category, color, height, width, depth, shape, wallMount, objectType, stairDesign,
      stairFootprint, stairLandings, stairLandingDirections, localBounds, normalizeToDimensions,
      openingCenterOffset, openingWidth, doorLeafCount }
  })
  return { ...input, floors, models }
}

export function stairsEnteringFloor(floor: FloorLevel, source: SceneSource): SceneStair[] {
  const lower = source.floors.filter(other => other.elevation < floor.elevation - 0.001)
    .sort((a, b) => b.elevation - a.elevation)[0]
  if (!lower) return []
  const definitions = new Map(source.models.map(model => [model.id, model]))
  return source.floors.filter(level => level.elevation <= lower.elevation + 0.001).flatMap(level =>
    level.models.flatMap(model => {
      const definition = definitions.get(model.modelId)
      if (definition?.objectType !== 'stairs') return []
      const openings = getStairSlabOpenings(lower, floor, [{ ...level, models: [model] }], definitions)
      if (!openings.length) return []
      const placement = definition.stairDesign && model.flipped ? { ...model, rotation: model.rotation + Math.PI } : model
      const upperEdge = getStairLandingPosition(placement, definition, 'upper')
      const outward = getStairLandingPosition(placement, definition, 'upper', -1)
      const length = Math.hypot(outward.x - upperEdge.x, outward.y - upperEdge.y)
      if (length < 0.001) return []
      const upperDirection = { x: (outward.x - upperEdge.x) / length, y: (outward.y - upperEdge.y) / length }
      return [{ id: model.id, sourceFloorId: level.id, openings, upperEdge, upperDirection,
        clearWidth: (definition.stairDesign?.width ?? (definition.stairLandings ? Math.min(0.85, definition.width) : definition.width)) *
          (model.scale || 1) * (model.widthScale || 1),
        riseMismatch: Math.abs(level.elevation + definition.height * (model.scale || 1) - floor.elevation) }]
    }))
}

export function captureArchitecturalScene(source: SceneSource): SceneSnapshot {
  const definitions = new Map(source.models.map(model => [model.id, model]))
  return {
    version: 1, projectId: source.projectId, revision: source.revision, units: 'metres',
    coordinateSystem: 'plan x/y; elevation maps to world y', selection: source.selection,
    constraints: ['A floor redesign can change internal partitions and openings. An extension preview can add exterior walls and slabs. Both preserve existing stairs and roofs.', 'Room polygons come from the editor’s wall topology.'],
    floors: source.floors.map(floor => {
      const topology = buildWallTopology(floor.walls, { floorFootprints: floor.floorFootprints })
      const metadata = new Map(floor.rooms.map(room => [room.signature, room]))
      const openings = floor.walls.flatMap(wall => (wall.openings ?? []).flatMap(opening => {
        const mounted = floor.models.find(model => model.id === opening.id.split(':wall:')[0])
        const definition = definitions.get(mounted?.modelId ?? opening.modelId)
        const axis = topology.renderedWallsById.get(wall.id)?.wall ?? wall
        const dx = axis.end.x - axis.start.x, dy = axis.end.y - axis.start.y
        const length = Math.hypot(dx, dy)
        if (length < 0.001) return []
        const kind = definition?.wallMount === 'window' || opening.bottom > 0.05 ? 'window'
          : definition && isPlanDoor(definition) ? 'door' : 'opening'
        return [{ ...opening, kind, wallId: wall.id, position: {
          x: axis.start.x + dx / length * opening.center,
          y: axis.start.y + dy / length * opening.center,
        } } satisfies Opening]
      }))
      const stairsFromBelow = stairsEnteringFloor(floor, source)
      const stairIds = floor.models.filter(model => definitions.get(model.modelId)?.objectType === 'stairs').map(model => model.id)
      const roofIds = floor.roofs?.map(roof => roof.id) ?? source.roofIdsByFloor?.find(level => level.floorId === floor.id)?.ids ?? []
      return {
        id: floor.id, name: floor.name, elevation: floor.elevation, roomHeight: floor.roomHeight,
        slabThickness: floor.slabThickness, footprint: getFloorSlabFootprints(floor),
        walls: [...topology.renderedWallsById.values()].map(({ wall }) => {
          const { id, kind, start, end, height, thickness } = wall
          return { id, kind, start, end, height, thickness }
        }), openings, stairsFromBelow, stairIds, roofIds,
        rooms: topology.rooms.map(room => {
          const saved = metadata.get(room.signature)
          return { ...room, id: saved?.id ?? `${floor.id}:${room.id}`, name: saved?.name ?? null, function: saved?.function }
        }),
        lockedObjectIds: [...new Set([...floor.walls.map(wall => wall.id), ...openings.map(opening => opening.id),
          ...floor.models.filter(model => model.wallAttachment).map(model => model.id),
          ...stairIds, ...stairsFromBelow.map(stair => stair.id), ...roofIds])],
      }
    }),
  }
}
