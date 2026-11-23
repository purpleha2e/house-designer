import assert from 'node:assert/strict'
import test from 'node:test'
import { Ray, Vector3 } from 'three'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'
import type { FloorLevel, PlacedModel, Wall } from '../src/types.ts'
import { createStairDesign, getStairLayout } from '../src/stairDesign.ts'
import { getStairWallCutFaces } from '../src/stairWallCut.ts'
import { buildWallBodyPerimeterMeshFaces, type WallMeshFace } from '../src/wallEngine/wallMesh.ts'
import { createWallRoofClipInputJob, runWallRoofClipInputJob } from '../src/wallEngine/wallRoofClipJob.ts'

const stairDesign = { ...createStairDesign(), closedUnderside: true }
const definitions = new Map<string, ModelDefinition>([['stairs', {
  id: 'stairs', name: 'Stairs', objectType: 'stairs', category: 'My stairs', shape: 'box', color: '#a87948',
  height: stairDesign.totalRise, width: stairDesign.width, depth: stairDesign.riserCount * stairDesign.going, stairDesign,
}]])
const model: PlacedModel = { id: 'stair', modelId: 'stairs', position: { x: 0, y: 0 }, rotation: 0, scale: 1 }
const wall = (id: string, start: Wall['start'], end: Wall['end'], thickness = .12): Wall =>
  ({ id, start, end, kind: 'internal', height: 2.4, thickness })
const floor = (walls: Wall[], models = [model], elevation = 0): FloorLevel =>
  ({ id: 'floor', name: 'Floor', elevation, walls, models, rooms: [], roomHeight: 2.4, slabThickness: .2 })

function clip(level: FloorLevel, models = definitions) {
  const faces = buildWallBodyPerimeterMeshFaces(level.walls)
  return runWallRoofClipInputJob(structuredClone(createWallRoofClipInputJob(faces, {
    floorId: level.id, floorElevation: level.elevation, roofs: [], roomPolygons: [],
    walls: level.walls, wallFaces: faces, stairSoffits: getStairWallCutFaces(level, models),
  })))
}

function wallTop(faces: WallMeshFace[], x: number, z: number) {
  const ray = new Ray(new Vector3(x, 3, z), new Vector3(0, -1, 0))
  const hits = faces.flatMap(face => {
    const [a, b, c, d] = face.vertices.map(vertex => new Vector3(...vertex.position))
    return [ray.intersectTriangle(a, b, c, false, new Vector3()), ray.intersectTriangle(a, c, d, false, new Vector3())]
      .flatMap(hit => hit ? [hit.y] : [])
  })
  return Math.max(...hits)
}

test('a cross wall stops at the stair soffit and retains its full height on both sides', () => {
  const z = .09
  const level = floor([wall('crossing', { x: -1.2, y: z }, { x: 1.2, y: z })])
  const cut = clip(level), layout = getStairLayout(stairDesign)
  const expected = (z - layout.lower.z) * layout.riserHeight / stairDesign.going - .14
  assert.ok(Math.abs(wallTop(cut, .07, z) - expected) < 1e-6, 'the cut closes at the sloping wall top')
  assert.equal(wallTop(cut, -.8, z), 2.4)
  assert.equal(wallTop(cut, .8, z), 2.4)
  assert.equal(wallTop(clip({ ...level, models: [] }), .07, z), 2.4)
})

test('a wall flush against a stair keeps its inside face when its thickness is outside the stair footprint', () => {
  const adjacent = wall('adjacent', { x: .55, y: -.8 }, { x: .55, y: 1 }, .2)
  const level = floor([adjacent])
  assert.deepEqual(clip(level), clip({ ...level, models: [] }))
  const overlap = wall('covered', { x: .35, y: -.8 }, { x: .35, y: 1 }, .2)
  const cut = clip(floor([overlap]))
  assert.ok(cut.every(face => face.vertices.every(vertex => vertex.position[1] < 2.1)),
    'a flush side is trimmed when the rest of its wall lies within the stair footprint')
})

test('the wall cut follows scaled, flipped and mirrored stairs on a raised storey', () => {
  const placed = { ...model, position: { x: 10, y: 20 }, rotation: Math.PI / 2, scale: .8,
    widthScale: 1.5, depthScale: .75, flipped: true, mirrored: true }
  const x = 10.19
  const level = floor([wall('crossing', { x, y: 19 }, { x, y: 21 })], [placed], 2.6)
  const layout = getStairLayout(stairDesign)
  const localZ = (x - placed.position.x) / (placed.scale * placed.depthScale)
  const expected = ((localZ - layout.lower.z) * layout.riserHeight / stairDesign.going - .14) * placed.scale
  const cut = clip(level)
  assert.ok(Math.abs(wallTop(cut, x, 20.06) - expected) < 1e-6)
  assert.equal(wallTop(cut, x, 20.8), 2.4)
})

test('a turning stair trims beneath its separate flights and leaves the well between them intact', () => {
  const design = { ...stairDesign, layout: 'u' as const, turnType: 'winder' as const,
    riserCount: 18, stepsBeforeTurn: 6, winderCount: 6, wellWidth: .25 }
  const models = new Map([['stairs', { ...definitions.get('stairs')!, stairDesign: design }]])
  const layout = getStairLayout(design)
  const z = layout.lower.z + 1.1
  const level = floor([wall('crossing', { x: -1.5, y: z }, { x: 1.5, y: z })])
  const cut = clip(level, models)
  assert.ok(wallTop(cut, layout.lower.x, z) < 2)
  assert.ok(wallTop(cut, layout.upper.x, z) < 2.4)
  assert.equal(wallTop(cut, 0, z), 2.4)
})
