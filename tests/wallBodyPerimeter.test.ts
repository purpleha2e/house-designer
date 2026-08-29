import assert from 'node:assert/strict'
import test from 'node:test'
import type { Point, Wall } from '../src/types.ts'
import { buildWallBodyPerimeters } from '../src/wallEngine/wallBodyPerimeter.ts'

function wall(overrides: Partial<Wall> & Pick<Wall, 'id'>): Wall {
  return {
    end: { x: 4, y: 0 },
    height: 2.4,
    id: overrides.id,
    kind: 'internal',
    start: { x: 0, y: 0 },
    thickness: 0.2,
    ...overrides,
  }
}

function roundedRing(points: Point[]) {
  return points.map((point) => [
    Number(point.x.toFixed(3)),
    Number(point.y.toFixed(3)),
  ])
}

function ringArea(points: Point[]) {
  return Math.abs(
    points.reduce((area, point, index) => {
      const nextPoint = points[(index + 1) % points.length]

      return area + point.x * nextPoint.y - nextPoint.x * point.y
    }, 0) / 2,
  )
}

function perimeterSnapshot(walls: Wall[]) {
  return buildWallBodyPerimeters(walls).perimeters
    .map((perimeter) => ({
      holes: perimeter.holes.map(roundedRing),
      outline: roundedRing(perimeter.outline),
      wallIds: perimeter.wallIds,
    }))
    .sort((first, second) => first.wallIds.join('|').localeCompare(second.wallIds.join('|')))
}

test('builds a canonical perimeter for an isolated wall', () => {
  const result = buildWallBodyPerimeters([wall({ id: 'wall' })])

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.wallBodies.length, 1)
  assert.equal(result.perimeters.length, 1)
  assert.deepEqual(result.perimeters[0].wallIds, ['wall'])
  assert.deepEqual(roundedRing(result.perimeters[0].outline), [
    [0, 0.1],
    [4, 0.1],
    [4, -0.1],
    [0, -0.1],
  ])
})

test('builds one clean mitered body for two endpoint-snapped walls', () => {
  const horizontal = wall({ id: 'horizontal' })
  const vertical = wall({
    end: { x: 4, y: 3 },
    id: 'vertical',
    start: { x: 4, y: 0 },
  })
  const result = buildWallBodyPerimeters([horizontal, vertical])

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.deepEqual(result.perimeters[0].wallIds, ['horizontal', 'vertical'])
  assert.deepEqual(roundedRing(result.perimeters[0].outline), [
    [0, 0.1],
    [3.9, 0.1],
    [3.9, 3],
    [4.1, 3],
    [4.1, -0.1],
    [0, -0.1],
  ])
})

test('does not compare same local sides for external endpoint joins', () => {
  const horizontal = wall({
    end: { x: 5.15, y: 0 },
    id: 'horizontal',
    kind: 'external',
    thickness: 0.3,
  })
  const diagonal = wall({
    end: { x: 8.827, y: 3.677 },
    id: 'diagonal',
    kind: 'external',
    start: { x: 5.15, y: 0 },
    thickness: 0.3,
  })
  const result = buildWallBodyPerimeters([horizontal, diagonal])

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.deepEqual(
    result.wallBodies
      .flatMap((body) => body.points)
      .filter((point) => point.x > 5 && point.x < 5.3)
      .map((point) => [
        Number(point.x.toFixed(6)),
        Number(point.y.toFixed(6)),
      ])
      .sort((first, second) => first[0] - second[0] || first[1] - second[1]),
    [
      [5.087868, 0.15],
      [5.087868, 0.15],
      [5.212132, -0.15],
      [5.212132, -0.15],
    ],
  )
})

test('preserves a hole for a closed wall loop', () => {
  const walls = [
    wall({ id: 'bottom' }),
    wall({ id: 'right', start: { x: 4, y: 0 }, end: { x: 4, y: 3 } }),
    wall({ id: 'top', start: { x: 4, y: 3 }, end: { x: 0, y: 3 } }),
    wall({ id: 'left', start: { x: 0, y: 3 }, end: { x: 0, y: 0 } }),
  ]
  const result = buildWallBodyPerimeters(walls)

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.equal(result.perimeters[0].holes.length, 1)
  assert.ok(ringArea(result.perimeters[0].outline) > 12)
  assert.ok(ringArea(result.perimeters[0].holes[0]) < 12)
})

test('joins an endpoint attached to the side of another wall', () => {
  const trunk = wall({ id: 'trunk' })
  const branch = wall({
    end: { x: 2, y: 2 },
    id: 'branch',
    start: { x: 2, y: 0 },
  })
  const result = buildWallBodyPerimeters([trunk, branch])

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.deepEqual(result.perimeters[0].wallIds, ['branch', 'trunk'])
  assert.ok(result.perimeters[0].outline.every((point) => point.y >= -0.101))
})

test('composes mixed internal and external walls in one component', () => {
  const external = wall({
    id: 'external',
    kind: 'external',
    thickness: 0.3,
  })
  const internal = wall({
    end: { x: 2, y: 2 },
    id: 'internal',
    kind: 'internal',
    start: { x: 2, y: 0 },
    thickness: 0.15,
  })
  const result = buildWallBodyPerimeters([external, internal])

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.deepEqual(result.perimeters[0].wallIds, ['external', 'internal'])
  assert.equal(result.perimeters[0].holes.length, 0)
})

test('uses target side and end edges for external end-cap quarter attachments', () => {
  const external = wall({
    end: { x: 3, y: 0 },
    id: 'external',
    kind: 'external',
    thickness: 0.3,
  })

  for (const quarterOffset of [-0.075, 0.075]) {
    const branch = wall({
      end: { x: 4, y: quarterOffset },
      id: 'branch',
      kind: 'internal',
      start: { x: 3, y: quarterOffset },
      thickness: 0.15,
    })
    const result = buildWallBodyPerimeters([external, branch])
    const branchBody = result.wallBodies.find((body) => body.wallId === 'branch')
    const joinedPoints =
      branchBody?.points.filter((point) => point.x < 3.1) ?? []

    assert.deepEqual(result.diagnostics, [])
    assert.equal(result.perimeters.length, 1)
    assert.equal(joinedPoints.length, 2)
    assert.ok(
      joinedPoints.every(
        (point) => Math.abs(point.y) <= external.thickness / 2 + 0.000001,
      ),
    )
    assert.ok(
      joinedPoints.filter(
        (point) =>
          Math.abs(Math.abs(point.y) - external.thickness / 2) < 0.000001,
      ).length >= 1,
    )
  }
})

test('external end-cap quarter attachments are independent of wall direction', () => {
  const external = wall({
    end: { x: 0, y: 0 },
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 4 },
    thickness: 0.3,
  })
  const forward = wall({
    end: { x: -0.075, y: 0 },
    id: 'branch',
    kind: 'internal',
    start: { x: -2, y: -2 },
    thickness: 0.15,
  })
  const reversed = {
    ...forward,
    end: forward.start,
    start: forward.end,
  }
  const forwardBody = buildWallBodyPerimeters([external, forward]).wallBodies.find(
    (body) => body.wallId === 'branch',
  )
  const reversedBody = buildWallBodyPerimeters([external, reversed]).wallBodies.find(
    (body) => body.wallId === 'branch',
  )
  const sortPoints = (points: Point[]) =>
    points
      .map((point) => [Number(point.x.toFixed(6)), Number(point.y.toFixed(6))])
      .sort((first, second) => first[0] - second[0] || first[1] - second[1])

  assert.ok(forwardBody)
  assert.ok(reversedBody)
  assert.deepEqual(sortPoints(forwardBody.points), sortPoints(reversedBody.points))
})

test('composes branches attached to opposite external end-cap quarters', () => {
  const walls = [
    wall({
      end: { x: 3, y: 0 },
      id: 'external',
      kind: 'external',
      thickness: 0.3,
    }),
    wall({
      end: { x: 2, y: 1 },
      id: 'left-branch',
      kind: 'internal',
      start: { x: 3, y: -0.075 },
      thickness: 0.15,
    }),
    wall({
      end: { x: 4, y: 1 },
      id: 'right-branch',
      kind: 'internal',
      start: { x: 3, y: 0.075 },
      thickness: 0.15,
    }),
  ]
  const result = buildWallBodyPerimeters(walls)

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.deepEqual(result.perimeters[0].wallIds, [
    'external',
    'left-branch',
    'right-branch',
  ])
})

test('keeps the external wall in a join shared at one end-cap quarter point', () => {
  const walls = [
    wall({
      end: { x: 3, y: 0 },
      id: 'external',
      kind: 'external',
      thickness: 0.3,
    }),
    wall({
      end: { x: 2, y: 1 },
      id: 'left-branch',
      kind: 'internal',
      start: { x: 3, y: 0.075 },
      thickness: 0.15,
    }),
    wall({
      end: { x: 4, y: 1 },
      id: 'right-branch',
      kind: 'internal',
      start: { x: 3, y: 0.075 },
      thickness: 0.15,
    }),
  ]
  const result = buildWallBodyPerimeters(walls)

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.deepEqual(result.perimeters[0].wallIds, [
    'external',
    'left-branch',
    'right-branch',
  ])
  assert.ok(result.perimeters[0].outline.every((point) => Number.isFinite(point.x)))
  assert.ok(result.perimeters[0].outline.every((point) => Number.isFinite(point.y)))
})

test('produces identical perimeters regardless of wall input order', () => {
  const walls = [
    wall({ id: 'bottom' }),
    wall({ id: 'right', start: { x: 4, y: 0 }, end: { x: 4, y: 3 } }),
    wall({ id: 'top', start: { x: 4, y: 3 }, end: { x: 0, y: 3 } }),
    wall({ id: 'left', start: { x: 0, y: 3 }, end: { x: 0, y: 0 } }),
    wall({ id: 'branch', start: { x: 2, y: 0 }, end: { x: 2, y: 1.5 } }),
  ]

  assert.deepEqual(perimeterSnapshot(walls), perimeterSnapshot([...walls].reverse()))
})

test('keeps disconnected wall sets as separate perimeter components', () => {
  const first = wall({ id: 'first' })
  const second = wall({
    id: 'second',
    start: { x: 0, y: 2 },
    end: { x: 3, y: 2 },
  })
  const result = buildWallBodyPerimeters([first, second])

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 2)
  assert.deepEqual(
    result.perimeters.map((perimeter) => perimeter.wallIds),
    [['first'], ['second']],
  )
})

test('supports four walls sharing one endpoint without filler geometry', () => {
  const walls = [
    wall({ id: 'east', start: { x: 0, y: 0 }, end: { x: 2, y: 0 } }),
    wall({ id: 'north', start: { x: 0, y: 0 }, end: { x: 0, y: 2 } }),
    wall({ id: 'west', start: { x: 0, y: 0 }, end: { x: -2, y: 0 } }),
    wall({ id: 'south', start: { x: 0, y: 0 }, end: { x: 0, y: -2 } }),
  ]
  const result = buildWallBodyPerimeters(walls)

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.equal(result.perimeters[0].holes.length, 0)
  assert.deepEqual(result.perimeters[0].wallIds, ['east', 'north', 'south', 'west'])
})

test('banks each edge against its nearest angular target at a mixed three-way join', () => {
  const horizontal = wall({
    id: 'horizontal',
    kind: 'external',
    thickness: 0.3,
  })
  const vertical = wall({
    end: { x: 4, y: -3 },
    id: 'vertical',
    kind: 'external',
    start: { x: 4, y: 0 },
    thickness: 0.3,
  })
  const diagonal = wall({
    end: { x: 4, y: 0 },
    id: 'diagonal',
    kind: 'internal',
    start: { x: 1, y: 3 },
    thickness: 0.15,
  })
  const result = buildWallBodyPerimeters([horizontal, vertical, diagonal])
  const diagonalBody = result.wallBodies.find((body) => body.wallId === 'diagonal')
  const joinedPoints = diagonalBody?.points.filter((point) => point.x > 3.5) ?? []

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.equal(joinedPoints.length, 2)
  assert.deepEqual(
    joinedPoints.map((point) => [
      Number(point.x.toFixed(6)),
      Number(point.y.toFixed(6)),
    ]),
    [
      [4, -0.106066],
      [3.85, 0.256066],
    ],
  )
})

test('does not compare same local sides for external endpoint side attachments', () => {
  const external = wall({
    end: { x: 0, y: 3 },
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 0 },
    thickness: 0.3,
  })
  const branch = wall({
    end: { x: 1, y: 4 },
    id: 'branch',
    start: { x: 0.075, y: 3 },
    thickness: 0.15,
  })
  const result = buildWallBodyPerimeters([external, branch])
  const branchBody = result.wallBodies.find((body) => body.wallId === 'branch')

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.ok(branchBody)
  assert.ok(
    branchBody.points.some(
      (point) =>
        Number(point.y.toFixed(3)) === 3 &&
        Number(point.x.toFixed(3)) < external.thickness / 2,
    ),
  )
})

test('does not extend external end-cap corners to branch cap-ray intersections', () => {
  const external = wall({
    end: { x: 0, y: 3 },
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 0 },
    thickness: 0.3,
  })
  const branch = wall({
    end: { x: 1, y: 2.1 },
    id: 'branch',
    start: { x: 0.075, y: 3 },
    thickness: 0.15,
  })
  const result = buildWallBodyPerimeters([external, branch])
  const externalBody = result.wallBodies.find((body) => body.wallId === 'external')

  assert.deepEqual(result.diagnostics, [])
  assert.ok(externalBody)
  assert.deepEqual(
    externalBody.points.map((point) => [
      Number(point.x.toFixed(3)),
      Number(point.y.toFixed(3)),
    ]),
    [
      [0.15, 0],
      [0.15, 3],
      [-0.15, 3],
      [-0.15, 0],
    ],
  )
})

test('fills the perimeter between an external endpoint and branch C intersection', () => {
  const external = wall({
    end: { x: 0, y: 3 },
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 0 },
    thickness: 0.3,
  })
  const branch = wall({
    end: { x: 1, y: 2.1 },
    id: 'branch',
    start: { x: 0.075, y: 3 },
    thickness: 0.15,
  })
  const result = buildWallBodyPerimeters([external, branch])

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.ok(
    result.perimeters[0].outline.some(
      (point) =>
        Number(point.x.toFixed(6)) === 0.182549 &&
        Number(point.y.toFixed(6)) === 3,
    ),
  )
})

test('keeps independently solved endpoints in one connected perimeter', () => {
  const middle = wall({ id: 'middle' })
  const left = wall({
    end: { x: 0, y: 0 },
    id: 'left',
    start: { x: 0, y: -2 },
  })
  const right = wall({
    end: { x: 4, y: 2 },
    id: 'right',
    start: { x: 4, y: 0 },
  })
  const result = buildWallBodyPerimeters([middle, left, right])
  const middleBody = result.wallBodies.find((body) => body.wallId === 'middle')

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.ok(middleBody)
  assert.deepEqual(
    middleBody.points.map((point) => [
      Number(point.x.toFixed(6)),
      Number(point.y.toFixed(6)),
    ]),
    [
      [0.1, -0.1],
      [4.1, -0.1],
      [4.1, 0.1],
      [0.1, 0.1],
    ],
  )
})

test('limits a shallow endpoint convergence to the chamfer threshold', () => {
  const source = wall({ id: 'source' })
  const angle = Math.PI / 36
  const shallow = wall({
    end: {
      x: 4 + Math.cos(angle) * 3,
      y: Math.sin(angle) * 3,
    },
    id: 'shallow',
    start: { x: 4, y: 0 },
  })
  const result = buildWallBodyPerimeters([source, shallow], {
    chamferThreshold: 1,
  })
  const sourceBody = result.wallBodies.find((body) => body.wallId === 'source')

  assert.deepEqual(result.diagnostics, [])
  assert.ok(sourceBody)
  assert.ok(
    sourceBody.points.every(
      (point) => point.x <= source.end.x + 1 + 0.000001,
    ),
  )
})

test('reports zero-length walls instead of passing them to polygon clipping', () => {
  const result = buildWallBodyPerimeters([
    wall({ id: 'zero', end: { x: 1, y: 1 }, start: { x: 1, y: 1 } }),
  ])

  assert.deepEqual(result.perimeters, [])
  assert.deepEqual(result.diagnostics, [
    {
      code: 'degenerate-wall',
      componentId: 'zero',
      wallIds: ['zero'],
    },
  ])
})

test('connects side-attached wall bodies with overlap instead of point contact', () => {
  const angledExternal = wall({
    end: { x: 9.430812653335941, y: 3.9509867778284367 },
    id: 'angled-external',
    kind: 'external',
    start: { x: 11.116666666666669, y: 8.75 },
    thickness: 0.3,
  })
  const horizontalInternal = wall({
    end: { x: 0.5833333333333334, y: 8.728954569828076 },
    id: 'horizontal-internal',
    kind: 'internal',
    start: { x: 10.95028731137017, y: 8.728954569828076 },
    thickness: 0.15,
  })
  const verticalInternal = wall({
    end: { x: 0.5083333333333333, y: 8.728954569828076 },
    id: 'vertical-internal',
    kind: 'internal',
    start: { x: 0.5083333333333333, y: 7.183333333333334 },
    thickness: 0.15,
  })
  const result = buildWallBodyPerimeters([
    angledExternal,
    horizontalInternal,
    verticalInternal,
  ])

  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.perimeters.length, 1)
  assert.deepEqual(result.perimeters[0].wallIds, [
    'angled-external',
    'horizontal-internal',
    'vertical-internal',
  ])
})
