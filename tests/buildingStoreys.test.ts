import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareBuildingStoreys, type BuildingPreparationRequest } from '../src/buildingPreparation.ts'
import { prepareRenderedFloorData } from '../src/threeDLevelPreparation.ts'
import type { FloorLevel } from '../src/types.ts'

test('worker storey preparation preserves slabs and responds to opening edits without mutating the saved floor', () => {
  const corners = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]
  const floor = (id: string, elevation: number): FloorLevel => ({ id, name: id, elevation, roomHeight: 2.4,
    slabThickness: .3, models: [], rooms: [], walls: corners.map((start, i) => ({
      id: `${id}-${i}`, start, end: corners[(i + 1) % corners.length], kind: 'external', thickness: .3, height: 2.4,
      openings: i === 0 ? [{ id: 'window', modelId: 'window', center: 1, width: 1, height: 1, bottom: 1 }] : [],
    })) })
  const floors = [floor('ground', 0), floor('first', 2.7)]
  const before = structuredClone(floors)
  const request = (floors: FloorLevel[]): Extract<BuildingPreparationRequest, { kind: 'storeys' }> => ({ kind: 'storeys',
    floors: floors.map(f => ({ data: prepareRenderedFloorData(f), exteriorSides: new Map(f.walls.map(w => [w.id, -1])), openingDepths: new Map([['window', .15]]) })),
    assemblyFloorIds: ['ground'], roofContacts: [], wallBodyPerimeters: true, roomSurfaces: true,
  })
  const original = prepareBuildingStoreys(structuredClone(request(floors)))
  const moved = structuredClone(floors)
  moved[0].walls[0].openings![0].bottom = .8
  const updated = prepareBuildingStoreys(structuredClone(request(moved)))
  assert.equal(original.get('ground')?.assembly?.bottom, 2.4)
  assert.equal(original.get('ground')?.assembly?.top, 2.7)
  assert.ok(original.get('ground')!.wallFaces.length > 0)
  assert.notDeepEqual(updated.get('ground')!.wallFaces, original.get('ground')!.wallFaces)
  assert.deepEqual(updated.get('first'), original.get('first'))
  assert.deepEqual(floors, before)
})
