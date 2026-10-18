import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import { createStairDesign, getStairFinish, getStairLayout, stairParts, stairTurnSteps, validateStairDesign, type StairDesign } from '../src/stairDesign.ts'
import { createStairGeometry, createStairSpindleGeometry, disposeStairGeometry, stairGeometryKey } from '../src/stairGeometry.ts'
import { NodeIO } from '@gltf-transform/core'
import { createStairHandrail, getStairRailPath } from '../src/stairRailings.ts'

const near = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`)
const area = (p: { x: number; z: number }[]) => Math.abs(p.reduce((sum, a, i) => {
  const b = p[(i + 1) % p.length]; return sum + a.x * b.z - b.x * a.z
}, 0)) / 2
function bent(layout: StairDesign['layout'], turnType: StairDesign['turnType'], turn: StairDesign['turn'] = 'right') {
  return { ...createStairDesign(), layout, turnType, turn, winderCount: layout === 'u' ? 6 : 3,
    stepsBeforeTurn: layout === 'u' && turnType === 'winder' ? 4 : 6 }
}

test('straight, L and U layouts have equal rises, connected flights, and the requested total rise', () => {
  for (const shape of ['straight', 'l', 'u'] as const) for (const turnType of ['landing', 'winder'] as const) {
    const d = bent(shape, turnType), layout = getStairLayout(d)
    assert.equal(validateStairDesign(d), null)
    const steps = layout.surfaces.filter(s => !s.landing || s.riser)
    assert.equal(steps.length, d.riserCount - (layout.compactLanding ? 1 : 0))
    steps.forEach((s, i) => { near(s.top, (i + 1) * layout.riserHeight); assert.ok(area(s.polygon) > .001) })
    near(steps.at(-1)!.top, d.totalRise - (layout.compactLanding ? layout.riserHeight : 0))
    near(layout.flights[0].left[0].y, layout.compactLanding ? layout.riserHeight : 0)
    near(layout.flights.at(-1)!.left.at(-1)!.y, d.totalRise)
    assert.equal(layout.surfaces.filter(s => s.landing).length, shape !== 'straight' && turnType === 'landing' ? 1 : 0)
    for (const side of [layout.left, layout.right]) for (let i = 1; i < side.length; i++) {
      assert.ok(side[i].y >= side[i - 1].y - 1e-6, 'rail follows a continuously ascending pitch line')
    }
  }
})

test('left-handed turns mirror every tread, landing and end point exactly', () => {
  for (const shape of ['l', 'u'] as const) for (const turnType of ['landing', 'winder'] as const) {
    const right = getStairLayout(bent(shape, turnType)), left = getStairLayout(bent(shape, turnType, 'left'))
    right.surfaces.forEach((surface, i) => surface.polygon.forEach((p, j) => {
      near(left.surfaces[i].polygon[j].x, -p.x); near(left.surfaces[i].polygon[j].z, p.z)
    }))
    near(left.lower.x, -right.lower.x); near(left.upper.x, -right.upper.x); near(left.upper.z, right.upper.z)
    near(left.left[0].x - left.lower.x, -.45)
    near(left.right[0].x - left.lower.x, .45)
  }
})

test('fan treads tile the complete square turn without missing corners or overlapping', () => {
  for (const shape of ['l', 'u'] as const) for (const winderCount of [2, 3, 5, 6, 8]) {
    const d = { ...bent(shape, 'winder'), winderCount, riserCount: 24 }, layout = getStairLayout(d)
    const winders = layout.surfaces.slice(d.stepsBeforeTurn, d.stepsBeforeTurn + winderCount)
    const inner = shape === 'u' ? d.wellWidth / 2 : 0, outer = d.width + inner
    near(winders.reduce((sum, s) => sum + area(s.polygon), 0), (outer ** 2 - inner ** 2) * (shape === 'u' ? 2 : 1))
    for (let i = 1; i < winders.length; i++) {
      const end = winders[i - 1].polygon[winders[i - 1].polygon.length / 2]
      near(end.x, winders[i].front[0].x)
      near(end.z, winders[i].front[0].z)
    }
  }
})

test('all layout variants generate finite, shadowed PBR meshes with one draw per material', () => {
  for (const shape of ['straight', 'l', 'u'] as const) for (const turnType of ['landing', 'winder'] as const) for (const turn of ['left', 'right'] as const) {
    const d = { ...bent(shape, turnType, turn), closedRisers: true }
    const object = createStairGeometry(d)
    try {
      assert.equal(object.children.length, 6)
      assert.equal(object.getObjectByName('stair-stringers'), undefined, 'closed side panels replace the separate beams')
      for (const part of stairParts.filter(p => p !== 'stringers')) {
        const mesh = object.getObjectByName(`stair-${part}`) as Mesh
        assert.ok(mesh)
        assert.equal(mesh.castShadow, true); assert.equal(mesh.receiveShadow, true)
        assert.equal(mesh.geometry.getAttribute('position').count % 3, 0)
        for (const attribute of Object.values(mesh.geometry.attributes)) assert.ok(Array.from(attribute.array).every(Number.isFinite))
        assert.equal(mesh.geometry.getAttribute('uv').count, mesh.geometry.getAttribute('position').count)
        const material = mesh.material as MeshStandardMaterial
        assert.equal(material.name, `stairs_${part}`)
        assert.equal(material.color.getHexString(), getStairFinish(d, part).color.slice(1))
      }
      const bounds = new Box3().setFromObject(object)
      assert.ok(bounds.min.y >= -.001, 'supports stay above the lower floor')
      assert.ok(bounds.max.y > d.totalRise && bounds.max.y < d.totalRise + d.railHeight + .1)
    } finally { disposeStairGeometry(object) }
  }
})

test('banisters, handrails, risers and supporting woodwork are independently optional', () => {
  const d = createStairDesign()
  d.banisters = { left: false, right: false }; d.handrails = { left: true, right: false }; d.stringers = false
  d.closedRisers = false; d.closedUnderside = false
  const object = createStairGeometry(d)
  try {
    assert.deepEqual(object.children.map(o => o.name), ['stair-treads', 'stair-handrails'])
  } finally { disposeStairGeometry(object) }
  const colored = structuredClone(d)
  colored.finishes.treads.color = '#224466'; colored.finishes.handrails.metalness = .8
  assert.equal(stairGeometryKey(d), stairGeometryKey(colored), 'finishes do not invalidate generated geometry')
  assert.notEqual(stairGeometryKey(d), stairGeometryKey({ ...d, width: 1.2 }))
})

test('enclosed stairs have a sloped underside under every flight and landing without filling the room below', () => {
  for (const shape of ['straight', 'l', 'u'] as const) for (const turnType of ['landing', 'winder'] as const) for (const turn of ['left', 'right'] as const) {
    const design = bent(shape, turnType, turn), object = createStairGeometry(design), layout = getStairLayout(design)
    try {
      object.updateMatrixWorld(true)
      const underside = object.getObjectByName('stair-underside') as Mesh
      assert.ok(underside, `${shape} ${turnType} ${turn} has a closed underside`)
      for (const surface of layout.surfaces) {
        const centre = surface.polygon.reduce((p, v) => ({ x: p.x + v.x / surface.polygon.length, z: p.z + v.z / surface.polygon.length }), { x: 0, z: 0 })
        const hits = new Raycaster(new Vector3(centre.x, -1, centre.z), new Vector3(0, 1, 0)).intersectObject(underside)
        assert.ok(hits.length, 'underside covers the walking footprint')
        assert.ok(hits[0].point.y < surface.top - design.treadThickness + 1e-6)
        if (surface.top > 1) assert.ok(hits[0].point.y > .5, 'higher flights leave usable space below')
      }
      const open = createStairGeometry({ ...design, closedRisers: false, closedUnderside: false })
      assert.equal(open.getObjectByName('stair-underside'), undefined)
      assert.equal(open.getObjectByName('stair-risers'), undefined)
      assert.ok(open.getObjectByName('stair-stringers'), 'open stairs retain their optional supports')
      disposeStairGeometry(open)
    } finally { disposeStairGeometry(object) }
  }
})

test('enclosed side panels have one surface along the soffit edge without an overlapping strip', () => {
  const d = createStairDesign(), layout = getStairLayout(d), object = createStairGeometry(d)
  try {
    const surface = layout.surfaces[5], fraction = .33
    const z = surface.front[0].z + d.going * fraction
    const y = surface.top - Math.max(.14, d.treadThickness + .04) - (1 - fraction) * layout.riserHeight + .0125
    const hits = new Raycaster(new Vector3(-d.width / 2 - .2, y, z), new Vector3(1, 0, 0))
      .intersectObject(object.getObjectByName('stair-underside')!).filter(hit => hit.distance < .201)
    assert.equal(hits.length, 1, 'one side surface at the lower edge, rather than two coplanar faces')
  } finally { disposeStairGeometry(object) }
})

test('older stair varieties keep their open underside and can opt into the new construction', () => {
  const legacy = createStairDesign()
  delete legacy.closedUnderside; delete legacy.finishes.underside
  legacy.closedRisers = false
  assert.equal(validateStairDesign(legacy), null)
  const open = createStairGeometry(legacy), enclosed = createStairGeometry({ ...legacy, closedRisers: true, closedUnderside: true })
  try {
    assert.equal(open.getObjectByName('stair-underside'), undefined)
    assert.ok(enclosed.getObjectByName('stair-underside'))
    assert.equal((enclosed.getObjectByName('stair-underside') as Mesh).material instanceof MeshStandardMaterial, true)
  } finally { disposeStairGeometry(open); disposeStairGeometry(enclosed) }
})

test('rail height is measured above tread nosings rather than the floor below the first step', () => {
  const d = createStairDesign(), object = createStairGeometry(d)
  try {
    const bounds = new Box3().setFromObject(object.getObjectByName('stair-handrails')!)
    const expected = d.totalRise / d.riserCount + d.railHeight
    assert.ok(bounds.min.y >= expected - d.handrailWidth, 'first rail is the requested height above the first tread')
    assert.ok(bounds.max.y <= d.totalRise + d.railHeight + d.handrailWidth / 2 + 1e-6)
    assert.ok(bounds.max.y > d.totalRise + d.railHeight - d.postWidth, 'pitched rail meets the top newel face')
  } finally { disposeStairGeometry(object) }
})

test('landing rails stay level and every flight rail has exactly the tread pitch, in either handedness', () => {
  for (const shape of ['straight', 'l', 'u'] as const) for (const turn of ['left', 'right'] as const)
    for (const dimensions of [{ width: .9, landingDepth: .9, going: .25 }, { width: .4, landingDepth: .4, going: .6 }]) {
    const d = { ...bent(shape, 'landing', turn), ...dimensions }, layout = getStairLayout(d)
    for (const side of ['left', 'right'] as const) {
      const path = getStairRailPath(d, layout, side)
      let slopes = 0
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], rise = b.y - a.y, run = Math.hypot(b.x - a.x, b.z - a.z)
        if (run < 1e-7) { near(rise, layout.riserHeight); continue } // Both levels terminate inside one newel.
        if (Math.abs(rise) > 1e-7) {
          near(rise / run, layout.riserHeight / d.going)
          slopes++
        }
      }
      assert.equal(slopes, shape === 'straight' ? 1 : 2, 'no secondary slope at either end of a flight')
      near(path[0].y, layout.riserHeight)
      near(path.at(-1)!.y, d.totalRise)
    }
  }
})

test('a flat landing includes the final rise without an extra tread, and equal U flights align', () => {
  const d = { ...bent('u', 'landing'), riserCount: 14, stepsBeforeTurn: 7, width: .79, landingDepth: .79, going: .2 }
  const layout = getStairLayout(d), landing = layout.surfaces.find(s => s.landing)!
  near(layout.bounds.maxZ - layout.bounds.minZ, 6 * .2 + .79)
  near(layout.lower.z, layout.upper.z, 1e-6)
  const lowerEnd = layout.flights[0].left.at(-1)!
  near(Math.max(...landing.polygon.map(p => p.z)) - lowerEnd.z, d.landingDepth)
  near(landing.front[0].z, lowerEnd.z)
  near(layout.flights[1].right[0].z, lowerEnd.z)
  assert.equal(layout.surfaces.filter(s => !s.landing).length, 12)
  near(landing.top, 7 * layout.riserHeight)
  const legacy = { ...d }; delete legacy.landingSteps
  const old = getStairLayout(legacy)
  near(old.bounds.maxZ - old.bounds.minZ, 7 * .2 + .79)
})

test('mid-landing profiles tile the landing with the requested internal risers and preserve the flight counts', () => {
  for (const shape of ['l', 'u'] as const) for (const turn of ['left', 'right'] as const)
    for (const landingSteps of [1, 2, 3] as const) {
      const d = { ...bent(shape, 'landing', turn), riserCount: 12 + landingSteps, stepsBeforeTurn: 6, landingSteps }
      const layout = getStairLayout(d), panels = layout.surfaces.filter(s => s.landing)
      assert.equal(stairTurnSteps(d), landingSteps)
      assert.equal(panels.length, landingSteps + 1)
      const width = shape === 'u' ? 2 * d.width + d.wellWidth : d.width
      near(panels.reduce((sum, s) => sum + area(s.polygon), 0), width * d.landingDepth)
      panels.forEach((s, i) => near(s.top, (6 + i) * layout.riserHeight))
      const fractions = landingSteps === 1 ? [.5] : landingSteps === 2 ? [.25, .75] : [.25, .5, .75]
      panels.slice(1).forEach((s, i) => {
        const [a, b] = s.front, dx = (b.x - a.x) * (turn === 'left' ? -1 : 1), dz = b.z - a.z
        near(Math.atan2(dz, -dx), fractions[i] * (shape === 'u' ? Math.PI : Math.PI / 2))
      })
      for (const side of ['left', 'right'] as const) {
        const path = getStairRailPath(d, layout, side)
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1], b = path[i], run = Math.hypot(b.x - a.x, b.z - a.z), rise = b.y - a.y
          const returnBetweenNewels = shape === 'u' && Math.abs(b.x - a.x) > 1e-7 && Math.abs(b.z - a.z) < 1e-7
          if (run > 1e-7 && Math.abs(rise) > 1e-7 && !returnBetweenNewels) near(rise / run, layout.riserHeight / d.going)
        }
      }
      const object = createStairGeometry(d)
      try {
        const treads = object.getObjectByName('stair-treads') as Mesh
        for (const s of panels) {
          const centre = s.polygon.reduce((p, v) => ({ x: p.x + v.x / s.polygon.length, z: p.z + v.z / s.polygon.length }), { x: 0, z: 0 })
          const hits = new Raycaster(new Vector3(centre.x, s.top + .05, centre.z), new Vector3(0, -1, 0)).intersectObject(treads)
          assert.ok(hits.length); near(hits[0].point.y, s.top)
        }
        for (const mesh of object.children as Mesh[]) for (const attribute of Object.values(mesh.geometry.attributes))
          assert.ok(Array.from(attribute.array).every(Number.isFinite))
      } finally { disposeStairGeometry(object) }
    }
})

test('handrail pitch and corner joints form a closed sweep without overlapping internal caps', () => {
  const path = [{ x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 1.5 },
    { x: 0, y: 2, z: 2.5 }, { x: 1.5, y: 2, z: 2.5 }, { x: 1.5, y: 3, z: 1 }]
  const geometry = createStairHandrail(path, .055)
  try {
    const p = geometry.getAttribute('position'), edges = new Map<string, number>()
    const point = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)].map(n => n.toFixed(6)).join(',')
    for (let i = 0; i < p.count; i += 3) for (let j = 0; j < 3; j++) {
      const key = [point(i + j), point(i + (j + 1) % 3)].sort().join('|')
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
    assert.ok([...edges.values()].every(count => count === 2), 'each edge belongs to exactly two faces')
    assert.equal(p.count / 3, (path.length - 1) * 8 + 4, 'only the two exposed rail ends have caps')
    const mesh = new Mesh(geometry, new MeshStandardMaterial())
    const hits = new Raycaster(new Vector3(.75, 4, 2.5), new Vector3(0, -1, 0)).intersectObject(mesh)
    near(hits[0].point.y, 2 + .055 / 2, 1e-6)
    mesh.material.dispose()
  } finally { geometry.dispose() }
})

test('newel tops clear the rail tops instead of leaving coplanar painted and wood faces', () => {
  const d = bent('u', 'landing'), layout = getStairLayout(d), object = createStairGeometry(d)
  try {
    const posts = object.getObjectByName('stair-posts') as Mesh
    for (const side of ['left', 'right'] as const) {
      const path = getStairRailPath(d, layout, side)
      for (const p of [path[0], path.at(-1)!]) {
        const hits = new Raycaster(new Vector3(p.x, 10, p.z), new Vector3(0, -1, 0)).intersectObject(posts)
        assert.ok(hits.length)
        assert.ok(hits[0].point.y - (p.y + d.railHeight + d.handrailWidth / 2) >= .025 - 1e-6)
      }
    }
  } finally { disposeStairGeometry(object) }
})

test('reused spindle retains the source Cylinder topology, dimensions and UVs', async () => {
  const document = await new NodeIO().read('src/models/assets/simple_floating_stairs_simple_banister.glb')
  const primitive = document.getRoot().listNodes().find(n => n.getName() === 'Cylinder')!.getMesh()!.listPrimitives()[0]
  const geometry = createStairSpindleGeometry()
  try {
    assert.equal(geometry.getAttribute('position').count, primitive.getAttribute('POSITION')!.getCount())
    assert.equal(geometry.index!.count / 3, 44)
    assert.deepEqual(Array.from(geometry.index!.array), Array.from(primitive.getIndices()!.getArray()!))
    assert.deepEqual(Array.from(geometry.getAttribute('uv').array), Array.from(primitive.getAttribute('TEXCOORD_0')!.getArray()!))
    geometry.computeBoundingBox(); const b = geometry.boundingBox!
    near(b.min.y, 0); near(b.max.y, 1.1); near(b.max.x - b.min.x, .04)
  } finally { geometry.dispose() }
})

test('invalid measurements and unsafe-to-generate saved designs are rejected', () => {
  const d = createStairDesign()
  for (const patch of [{ width: NaN }, { going: Infinity }, { riserCount: 2.5 }, { riserCount: 500 },
    { totalRise: 0 }, { treadThickness: .3 }, { layout: 'spiral' }, { finishes: {} }, { banisters: null }])
    assert.ok(validateStairDesign({ ...d, ...patch }))
  assert.match(validateStairDesign({ ...bent('l', 'winder'), stepsBeforeTurn: 13 })!, /before and after/)
  assert.match(validateStairDesign({ ...bent('u', 'landing'), landingDepth: .5 })!, /Landing depth/)
  assert.throws(() => createStairGeometry({ ...d, riserCount: 1000000 }), /risers/)
})
