import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCoplanarWallSurfaceGroups } from '../src/wallEngine/wallSurfaceGroups.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'

function sideFace({
  end,
  id,
  normal = [0, 0, 1],
  side = 1,
  start,
  wallId,
  z = 0,
}: {
  end: number
  id: string
  normal?: [number, number, number]
  side?: -1 | 1
  start: number
  wallId: string
  z?: number
}): WallMeshFace {
  return {
    faceId: id,
    kind: 'side',
    materialSource: { side, wallId },
    normal,
    pickSource: { side, wallId },
    uvSource: { side, wallId },
    vertices: [
      { position: [start, 0, z], uv: [start, 0] },
      { position: [end, 0, z], uv: [end, 0] },
      { position: [end, 2.4, z], uv: [end, 2.4] },
      { position: [start, 2.4, z], uv: [start, 2.4] },
    ],
    wallId,
  }
}

test('groups touching coplanar wall fragments across wall ids', () => {
  const faces = [
    sideFace({ end: 2, id: 'left-face', start: 0, wallId: 'left-wall' }),
    sideFace({ end: 4, id: 'right-face', start: 2, wallId: 'right-wall' }),
  ]
  const groups = buildCoplanarWallSurfaceGroups(faces)

  assert.deepEqual(groups.get('left-face'), groups.get('right-face'))
  assert.deepEqual(groups.get('left-face'), [
    { fragmentId: 'left-face', side: 1, wallId: 'left-wall' },
    { fragmentId: 'right-face', side: 1, wallId: 'right-wall' },
  ])
})

test('does not group disconnected or oppositely oriented wall surfaces', () => {
  const faces = [
    sideFace({ end: 1, id: 'first', start: 0, wallId: 'first-wall' }),
    sideFace({ end: 3, id: 'gap', start: 2, wallId: 'gap-wall' }),
    sideFace({
      end: 1,
      id: 'opposite',
      normal: [0, 0, -1],
      side: -1,
      start: 0,
      wallId: 'opposite-wall',
    }),
  ]
  const groups = buildCoplanarWallSurfaceGroups(faces)

  assert.equal(groups.get('first')?.length, 1)
  assert.equal(groups.get('gap')?.length, 1)
  assert.equal(groups.get('opposite')?.length, 1)
})

test('wall selection includes touching reveals on its own side only', () => {
  const wall = sideFace({ id:'wall', wallId:'door-wall', start:0, end:1 })
  const reveal: WallMeshFace = { ...wall, faceId:'door-wall:opening:door:left:1', kind:'cap', normal:[1,0,0],
    vertices:[[1,0,0],[1,0,-0.15],[1,2,-0.15],[1,2,0]].map(position => ({position,uv:[0,0]})) as WallMeshFace['vertices'] }
  const otherSide = { ...reveal, faceId:'door-wall:opening:door:left:-1', pickSource:{wallId:'door-wall',side:-1 as const} }
  const detached = { ...reveal, faceId:'door-wall:opening:far:left:1',
    vertices:reveal.vertices.map(v => ({...v,position:[v.position[0]+4,v.position[1],v.position[2]]})) as WallMeshFace['vertices'] }
  const group = buildCoplanarWallSurfaceGroups([wall,reveal,otherSide,detached]).get('wall')!
  assert.deepEqual(group.map(f=>f.fragmentId).sort(), [reveal.faceId,wall.faceId].sort())
})
