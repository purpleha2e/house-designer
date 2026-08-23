import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getClippedInternalWallRenderExtensions,
  getClippedInternalWallFootprints,
  getExternalWallRenderExtensions,
  unionMiteredWallFootprints,
  unionWallFootprints,
} from '../src/wallBooleanGeometry.ts'
import type { Point, Wall } from '../src/types.ts'

function wall(overrides: Partial<Wall> & Pick<Wall, 'id' | 'kind'>): Wall {
  return {
    height: 2.4,
    openings: undefined,
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
    thickness: overrides.kind === 'external' ? 0.3 : 0.15,
    ...overrides,
  }
}

function ringArea(points: Point[]) {
  return (
    Math.abs(
      points.reduce((area, point, index) => {
        const nextPoint = points[(index + 1) % points.length]

        return area + point.x * nextPoint.y - nextPoint.x * point.y
      }, 0),
    ) / 2
  )
}

function footprintBounds(points: Point[]) {
  return {
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
  }
}

test('unions snapped external wall footprints into one polygon', () => {
  const horizontal = wall({
    id: 'horizontal',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const vertical = wall({
    id: 'vertical',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 4, y: 3 },
  })

  const footprints = unionWallFootprints([horizontal, vertical])

  assert.equal(footprints.length, 1)
  assert.equal(footprints[0].holes.length, 0)
  assert.ok(footprints[0].outline.length > 4)
})

test('union removes overlapping wall area at external corners', () => {
  const horizontal = wall({
    id: 'horizontal',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const vertical = wall({
    id: 'vertical',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 4, y: 3 },
  })

  const [footprint] = unionWallFootprints([horizontal, vertical])
  const naiveArea =
    (4 + vertical.thickness / 2) * horizontal.thickness +
    (3 + horizontal.thickness / 2) * vertical.thickness

  assert.ok(ringArea(footprint.outline) < naiveArea)
})

test('mitered external wall footprints extend render rectangles before unioning', () => {
  const horizontal = wall({
    id: 'horizontal',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const angled = wall({
    id: 'angled',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 6, y: 2 },
  })

  const [footprint] = unionMiteredWallFootprints([horizontal, angled])
  const maxX = Math.max(...footprint.outline.map((point) => point.x))

  assert.ok(maxX > horizontal.end.x)
})

test('mitered external wall footprints handle obtuse joins without side spikes', () => {
  const horizontal = wall({
    id: 'horizontal',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const angled = wall({
    id: 'angled',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 2.5, y: 2 },
  })

  const [footprint] = unionMiteredWallFootprints([horizontal, angled])
  const maxY = Math.max(...footprint.outline.map((point) => point.y))
  const minY = Math.min(...footprint.outline.map((point) => point.y))

  assert.ok(maxY - minY < 2.6)
})

test('external opening walls expose render extensions for legacy aperture mesh', () => {
  const openingWall = wall({
    id: 'opening-wall',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
    openings: [
      {
        bottom: 0.9,
        center: 2,
        height: 1.2,
        id: 'window',
        modelId: 'window',
        width: 1,
      },
    ],
  })
  const adjoining = wall({
    id: 'adjoining',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 6, y: 2 },
  })

  const extensions = getExternalWallRenderExtensions(openingWall, [
    openingWall,
    adjoining,
  ])

  assert.ok(extensions.endExtension > 0)
  assert.equal(extensions.startExtension, 0)
})

test('plain external CSG walls use opening external walls as miter context', () => {
  const openingWall = wall({
    id: 'opening-wall',
    kind: 'external',
    openings: [
      {
        bottom: 0.9,
        center: 2,
        height: 1.2,
        id: 'window',
        modelId: 'window',
        width: 1,
      },
    ],
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const plainWall = wall({
    id: 'plain-wall',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 6, y: 2 },
  })

  const [footprint] = unionMiteredWallFootprints([plainWall], [
    openingWall,
    plainWall,
  ])
  const minX = Math.min(...footprint.outline.map((point) => point.x))

  assert.ok(minX < plainWall.start.x)
})

test('external CSG supports three external walls meeting at one endpoint', () => {
  const left = wall({
    id: 'left',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const up = wall({
    id: 'up',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 4, y: 3 },
  })
  const diagonal = wall({
    id: 'diagonal',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 6, y: 2 },
  })

  const footprints = unionMiteredWallFootprints([left, up, diagonal])
  const bounds = footprintBounds(footprints.flatMap((footprint) => footprint.outline))

  assert.equal(footprints.length, 1)
  assert.equal(footprints[0].holes.length, 0)
  assert.ok(bounds.minX >= -0.2)
  assert.ok(bounds.maxX <= 6.2)
  assert.ok(bounds.minY >= -0.2)
  assert.ok(bounds.maxY <= 3.2)
})

test('external opening walls expose bounded extensions in three-way external joins', () => {
  const openingWall = wall({
    id: 'opening-wall',
    kind: 'external',
    openings: [
      {
        bottom: 0.9,
        center: 2,
        height: 1.2,
        id: 'window',
        modelId: 'window',
        width: 1,
      },
    ],
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const up = wall({
    id: 'up',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 4, y: 3 },
  })
  const diagonal = wall({
    id: 'diagonal',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 6, y: 2 },
  })

  const extensions = getExternalWallRenderExtensions(openingWall, [
    openingWall,
    up,
    diagonal,
  ])

  assert.equal(extensions.startExtension, 0)
  assert.ok(extensions.endExtension >= 0)
  assert.ok(extensions.endExtension <= openingWall.thickness * 4)
})

test('mitered external right-angle joins keep corner body connected with openings', () => {
  const openingWall = wall({
    id: 'opening-wall',
    kind: 'external',
    openings: [
      {
        bottom: 0.9,
        center: 2,
        height: 1.2,
        id: 'window',
        modelId: 'window',
        width: 1,
      },
    ],
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const returnWall = wall({
    id: 'return-wall',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 4, y: 3 },
  })

  const footprints = unionMiteredWallFootprints([openingWall, returnWall])
  const points = footprints.flatMap((footprint) => footprint.outline)
  const bounds = footprintBounds(points)
  const coversOutsideCorner = points.some(
    (point) =>
      Math.abs(point.x - (returnWall.start.x + returnWall.thickness / 2)) <
        0.001 &&
      Math.abs(point.y - (openingWall.start.y - openingWall.thickness / 2)) <
        0.001,
  )

  assert.equal(footprints.length, 1)
  assert.ok(bounds.maxX >= returnWall.start.x + returnWall.thickness / 2 - 0.001)
  assert.ok(bounds.minY <= openingWall.start.y - openingWall.thickness / 2 + 0.001)
  assert.ok(coversOutsideCorner)
})

test('mitered external angled joins can trim side intersections', () => {
  const openingWall = wall({
    id: 'opening-wall',
    kind: 'external',
    openings: [
      {
        bottom: 0.9,
        center: 2,
        height: 1.2,
        id: 'window',
        modelId: 'window',
        width: 1,
      },
    ],
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const angledWall = wall({
    id: 'angled-wall',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 2.5, y: 2.6 },
  })

  const [footprint] = unionMiteredWallFootprints([openingWall, angledWall])
  const hasUntrimmedEndCapStep = footprint.outline.some(
    (point) =>
      Math.abs(point.x - openingWall.end.x) < 0.001 &&
      Math.abs(point.y + openingWall.thickness / 2) < 0.001,
  )

  assert.equal(footprint.outline.length, 6)
  assert.equal(hasUntrimmedEndCapStep, false)
})

test('clipped internal wall footprints stop at external wall body', () => {
  const external = wall({
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const internal = wall({
    id: 'internal',
    kind: 'internal',
    start: { x: 2, y: 0 },
    end: { x: 2, y: 2 },
    thickness: 0.15,
  })

  const [group] = getClippedInternalWallFootprints([external, internal])
  const minY = Math.min(...group.footprints.flatMap((footprint) =>
    footprint.outline.map((point) => point.y),
  ))

  assert.equal(group.wallId, internal.id)
  assert.ok(minY >= external.thickness / 2 - 0.001)
})

test('internal opening walls expose clipped render extensions for legacy aperture mesh', () => {
  const external = wall({
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const openingWall = wall({
    id: 'internal-opening',
    kind: 'internal',
    openings: [
      {
        bottom: 0,
        center: 1,
        height: 2.1,
        id: 'door',
        modelId: 'door',
        width: 0.8,
      },
    ],
    start: { x: 2, y: 0 },
    end: { x: 2, y: 2 },
    thickness: 0.15,
  })

  const extensions = getClippedInternalWallRenderExtensions(openingWall, [
    external,
    openingWall,
  ])

  assert.ok(extensions.startExtension < 0)
  assert.equal(extensions.endExtension, 0)
})

test('clipped internal wall footprints remove deterministic internal overlaps', () => {
  const firstInternal = wall({
    id: 'a-internal',
    kind: 'internal',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
    thickness: 0.15,
  })
  const secondInternal = wall({
    id: 'b-internal',
    kind: 'internal',
    start: { x: 2, y: 0 },
    end: { x: 2, y: 2 },
    thickness: 0.15,
  })

  const groups = getClippedInternalWallFootprints([secondInternal, firstInternal])
  const clippedSecond = groups.find((group) => group.wallId === secondInternal.id)
  const minY = Math.min(...(clippedSecond?.footprints ?? []).flatMap((footprint) =>
    footprint.outline.map((point) => point.y),
  ))

  assert.ok(clippedSecond)
  assert.ok(minY >= firstInternal.thickness / 2 - 0.001)
})

test('internal opening walls expose deterministic internal owner clipping', () => {
  const firstInternal = wall({
    id: 'a-internal',
    kind: 'internal',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
    thickness: 0.15,
  })
  const openingWall = wall({
    id: 'b-internal-opening',
    kind: 'internal',
    openings: [
      {
        bottom: 0,
        center: 1,
        height: 2.1,
        id: 'door',
        modelId: 'door',
        width: 0.8,
      },
    ],
    start: { x: 2, y: 0 },
    end: { x: 2, y: 2 },
    thickness: 0.15,
  })

  const extensions = getClippedInternalWallRenderExtensions(openingWall, [
    openingWall,
    firstInternal,
  ])

  assert.ok(extensions.startExtension < 0)
  assert.equal(extensions.endExtension, 0)
})

test('plain internal CSG walls use opening internal walls as clipping owners', () => {
  const openingOwner = wall({
    id: 'a-internal-opening',
    kind: 'internal',
    openings: [
      {
        bottom: 0,
        center: 1,
        height: 2.1,
        id: 'door',
        modelId: 'door',
        width: 0.8,
      },
    ],
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
    thickness: 0.15,
  })
  const plainWall = wall({
    id: 'b-internal',
    kind: 'internal',
    start: { x: 2, y: 0 },
    end: { x: 2, y: 2 },
    thickness: 0.15,
  })

  const [group] = getClippedInternalWallFootprints([plainWall], [
    plainWall,
    openingOwner,
  ])
  const minY = Math.min(...group.footprints.flatMap((footprint) =>
    footprint.outline.map((point) => point.y),
  ))

  assert.ok(minY >= openingOwner.thickness / 2 - 0.001)
})

test('plain internal CSG walls clip against external walls with openings', () => {
  const openingExternal = wall({
    id: 'opening-external',
    kind: 'external',
    openings: [
      {
        bottom: 0.9,
        center: 2,
        height: 1.2,
        id: 'window',
        modelId: 'window',
        width: 1,
      },
    ],
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const internal = wall({
    id: 'internal',
    kind: 'internal',
    start: { x: 2, y: 0 },
    end: { x: 2, y: 2 },
    thickness: 0.15,
  })

  const [group] = getClippedInternalWallFootprints([internal], [
    openingExternal,
    internal,
  ])
  const minY = Math.min(...group.footprints.flatMap((footprint) =>
    footprint.outline.map((point) => point.y),
  ))

  assert.equal(group.wallId, internal.id)
  assert.ok(minY >= openingExternal.thickness / 2 - 0.001)
})

test('internal opening walls clip against internal walls without changing owner wall', () => {
  const owner = wall({
    id: 'a-owner',
    kind: 'internal',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
    thickness: 0.15,
  })
  const openingWall = wall({
    id: 'b-opening',
    kind: 'internal',
    openings: [
      {
        bottom: 0,
        center: 1,
        height: 2.1,
        id: 'door',
        modelId: 'door',
        width: 0.8,
      },
    ],
    start: { x: 2, y: 0 },
    end: { x: 2, y: 2 },
    thickness: 0.15,
  })

  const extensions = getClippedInternalWallRenderExtensions(openingWall, [
    owner,
    openingWall,
  ])

  assert.ok(extensions.startExtension < 0)
  assert.equal(extensions.endExtension, 0)
})
