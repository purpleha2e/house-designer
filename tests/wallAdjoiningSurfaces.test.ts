import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall, WallSurfaceFragmentReference } from '../src/types.ts'
import {
  appendExternalWallCapFragmentsToGroups,
  buildConnectedExternalWallSurfaceGroups,
  buildRoomWallSurfaceGroups,
  createWallSurfacePickTarget,
  getAdjoiningWallSurfaceSelection,
  isExteriorWallSurfaceFragment,
} from '../src/wallAdjoiningSurfaces.ts'

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  kind: Wall['kind'] = 'external',
): Wall {
  return {
    end: { x: end[0], y: end[1] },
    height: 2.4,
    id,
    kind,
    start: { x: start[0], y: start[1] },
    thickness: kind === 'external' ? 0.3 : 0.1,
  }
}

function fragment(
  wallId: string,
  side: -1 | 1,
): WallSurfaceFragmentReference {
  return { fragmentId: `${wallId}-${side}`, side, wallId }
}

test('uses the detected exterior side when room sampling misses both sides', () => {
  assert.equal(
    isExteriorWallSurfaceFragment({
      detectedExteriorSide: -1,
      hasAdjacentRoom: false,
      hasOppositeRoom: false,
      side: -1,
      wallKind: 'external',
    }),
    true,
  )
  assert.equal(
    isExteriorWallSurfaceFragment({
      detectedExteriorSide: -1,
      hasAdjacentRoom: false,
      hasOppositeRoom: false,
      side: 1,
      wallKind: 'external',
    }),
    false,
  )
})

test('room evidence takes priority when classifying an exterior fragment', () => {
  assert.equal(
    isExteriorWallSurfaceFragment({
      detectedExteriorSide: 1,
      hasAdjacentRoom: false,
      hasOppositeRoom: true,
      side: -1,
      wallKind: 'external',
    }),
    true,
  )
  assert.equal(
    isExteriorWallSurfaceFragment({
      detectedExteriorSide: -1,
      hasAdjacentRoom: true,
      hasOppositeRoom: false,
      side: -1,
      wallKind: 'external',
    }),
    false,
  )
})

test('groups a connected exterior perimeter without crossing to reverse faces', () => {
  const walls = [
    wall('bottom', [0, 0], [4, 0]),
    wall('right', [4, 4], [4, 0]),
    wall('top', [4, 4], [0, 4]),
    wall('left', [0, 0], [0, 4]),
  ]
  const fragments = [
    fragment('bottom', -1),
    fragment('right', 1),
    fragment('top', -1),
    fragment('left', 1),
  ]
  const groups = buildConnectedExternalWallSurfaceGroups({
    fragments,
    walls,
  })

  assert.deepEqual(
    groups.get('bottom:-1:bottom--1')?.map((entry) => `${entry.wallId}:${entry.side}`),
    ['bottom:-1', 'left:1', 'right:1', 'top:-1'],
  )
  assert.equal(groups.has('bottom:1:bottom-1'), false)
})

test('does not cross to a detached perimeter or an attached internal wall', () => {
  const walls = [
    wall('external-a', [0, 0], [4, 0]),
    wall('external-b', [4, 0], [4, 4]),
    wall('internal', [4, 0], [2, 2], 'internal'),
    wall('detached', [10, 0], [12, 0]),
  ]
  const fragments = [
    fragment('external-a', -1),
    fragment('external-b', 1),
    fragment('detached', -1),
  ]
  const groups = buildConnectedExternalWallSurfaceGroups({
    fragments,
    walls,
  })

  assert.deepEqual(
    groups.get('external-a:-1:external-a--1')?.map((entry) => entry.wallId),
    ['external-a', 'external-b'],
  )
  assert.deepEqual(
    groups.get('detached:-1:detached--1')?.map((entry) => entry.wallId),
    ['detached'],
  )
  assert.equal(groups.has('internal:1'), false)
})

test('groups every wall face adjoining the same room without crossing sides', () => {
  const roomAEntries = [
    { fragment: fragment('external', 1), roomSignature: 'room-a' },
    { fragment: fragment('internal-a', -1), roomSignature: 'room-a' },
    { fragment: fragment('internal-b', 1), roomSignature: 'room-a' },
  ]
  const groups = buildRoomWallSurfaceGroups([
    ...roomAEntries,
    { fragment: fragment('internal-a', 1), roomSignature: 'room-b' },
  ])

  assert.deepEqual(
    groups
      .get('internal-a:-1:internal-a--1')
      ?.map((entry) => `${entry.wallId}:${entry.side}`),
    ['external:1', 'internal-a:-1', 'internal-b:1'],
  )
  assert.deepEqual(
    groups
      .get('internal-a:1:internal-a-1')
      ?.map((entry) => `${entry.wallId}:${entry.side}`),
    ['internal-a:1'],
  )
})

test('shift selection uses the exact picked fragment instead of a coplanar canonical fragment', () => {
  const picked = fragment('clicked-room-wall', 1)
  const adjoiningFragments = [
    picked,
    fragment('another-wall-in-clicked-room', -1),
  ]
  const selection = getAdjoiningWallSurfaceSelection({
    adjoiningFragments,
    floorId: 'floor-0',
    fragmentId: 'canonical-face-in-next-room',
    fragments: [
      fragment('next-room-wall', 1),
      picked,
    ],
    pickedFragment: picked,
    side: 1,
    type: 'wall-surface-fragment',
    wallId: 'next-room-wall',
  })

  assert.equal(selection.wallId, 'clicked-room-wall')
  assert.equal(selection.fragmentId, 'clicked-room-wall-1')
  assert.deepEqual(selection.fragments, adjoiningFragments)
})

test('shift selection falls back to only the exact picked fragment', () => {
  const picked = fragment('clicked-wall', -1)
  const selection = getAdjoiningWallSurfaceSelection({
    floorId: 'floor-0',
    fragmentId: 'canonical-neighbour',
    fragments: [fragment('neighbour', -1), picked],
    pickedFragment: picked,
    side: -1,
    type: 'wall-surface-fragment',
    wallId: 'neighbour',
  })

  assert.deepEqual(selection.fragments, [picked])
})

test('pick targets keep the exact face identity when coplanar faces cross rooms', () => {
  const clickedFragment = {
    fragmentId: 'clicked-face',
    side: 1 as const,
    wallId: 'clicked-wall',
  }
  const clicked = {
    floorId: 'floor-0',
    fragmentId: 'clicked-face',
    side: 1 as const,
    type: 'wall-surface-fragment' as const,
    wallId: 'clicked-wall',
  }
  const target = createWallSurfacePickTarget({
    adjoiningFragments: [clickedFragment],
    coplanarFragments: [
      fragment('canonical-wall-in-next-room', 1),
      clickedFragment,
    ],
    target: clicked,
  })

  assert.equal(target.wallId, 'clicked-wall')
  assert.equal(target.fragmentId, 'clicked-face')
  assert.equal(target.pickedFragment, clicked)
  assert.deepEqual(target.fragments, [clickedFragment])
})

test('adds perimeter side faces marked as caps to an external adjoining group', () => {
  const exteriorWall = wall('external', [0, 0], [4, 0])
  const exteriorFragment = fragment('external', -1)
  const groups = buildConnectedExternalWallSurfaceGroups({
    fragments: [exteriorFragment],
    walls: [exteriorWall],
  })
  const capFragmentId = 'perimeter:external:outline:0:side:1'

  appendExternalWallCapFragmentsToGroups({
    classifiedFragments: [
      {
        fragment: exteriorFragment,
        isExterior: true,
      },
    ],
    faces: [
      {
        faceId: capFragmentId,
        kind: 'side',
        pickSource: {
          role: 'cap',
          side: -1,
          wallId: 'external',
        },
      },
    ],
    groups,
    walls: [exteriorWall],
  })

  assert.deepEqual(
    groups
      .get(`external:-1:${exteriorFragment.fragmentId}`)
      ?.map((entry) => entry.fragmentId),
    [exteriorFragment.fragmentId, capFragmentId],
  )
  assert.deepEqual(
    groups.get(`external:-1:${capFragmentId}`)?.map((entry) => entry.fragmentId),
    [exteriorFragment.fragmentId, capFragmentId],
  )
})

test('adds an external cap through its connected wall component when its own wall has no exterior anchor', () => {
  const capWall = wall('cap-wall', [0, 0], [4, 0])
  const adjoiningWall = wall('adjoining-wall', [4, 0], [4, 4])
  const adjoiningFragment = fragment('adjoining-wall', 1)
  const groups = buildConnectedExternalWallSurfaceGroups({
    fragments: [adjoiningFragment],
    walls: [capWall, adjoiningWall],
  })
  const capFragmentId = 'perimeter:cap-wall|adjoining-wall:outline:0:side:1'

  appendExternalWallCapFragmentsToGroups({
    classifiedFragments: [
      {
        fragment: adjoiningFragment,
        isExterior: true,
      },
    ],
    faces: [
      {
        faceId: capFragmentId,
        kind: 'side',
        pickSource: {
          role: 'cap',
          side: -1,
          wallId: 'cap-wall',
        },
      },
    ],
    groups,
    walls: [capWall, adjoiningWall],
  })

  assert.deepEqual(
    groups
      .get(`adjoining-wall:1:${adjoiningFragment.fragmentId}`)
      ?.map((entry) => entry.fragmentId),
    [adjoiningFragment.fragmentId, capFragmentId],
  )
  assert.deepEqual(
    groups.get(`cap-wall:-1:${capFragmentId}`)?.map((entry) => entry.fragmentId),
    [adjoiningFragment.fragmentId, capFragmentId],
  )
})

test('groups an external cap with its own wall side when room classification provides no exterior anchor', () => {
  const exteriorWall = wall('unclassified-external', [0, 0], [4, 0])
  const wallFragments = [
    {
      fragmentId: 'unclassified-external-side-part-a',
      side: -1 as const,
      wallId: exteriorWall.id,
    },
    {
      fragmentId: 'unclassified-external-side-part-b',
      side: -1 as const,
      wallId: exteriorWall.id,
    },
  ]
  const capFragmentId = 'perimeter:unclassified-external:outline:0:side:1'
  const groups = buildConnectedExternalWallSurfaceGroups({
    fragments: [],
    walls: [exteriorWall],
  })

  appendExternalWallCapFragmentsToGroups({
    classifiedFragments: wallFragments.map((wallFragment) => ({
      fragment: wallFragment,
      isExterior: false,
    })),
    faces: [
      {
        faceId: capFragmentId,
        kind: 'side',
        pickSource: {
          role: 'cap',
          side: -1,
          wallId: exteriorWall.id,
        },
      },
    ],
    groups,
    walls: [exteriorWall],
  })

  const expectedFragmentIds = [
    capFragmentId,
    'unclassified-external-side-part-a',
    'unclassified-external-side-part-b',
  ]

  assert.deepEqual(
    groups
      .get(`${exteriorWall.id}:-1:unclassified-external-side-part-a`)
      ?.map((entry) => entry.fragmentId),
    expectedFragmentIds,
  )
  assert.deepEqual(
    groups
      .get(`${exteriorWall.id}:-1:${capFragmentId}`)
      ?.map((entry) => entry.fragmentId),
    expectedFragmentIds,
  )
  assert.equal(
    groups.has(`${exteriorWall.id}:1:unclassified-external-side-part-a`),
    false,
  )
})
