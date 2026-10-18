import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, DoubleSide, FrontSide, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import { createStairDesign, getStairLayout, validateStairDesign } from '../src/stairDesign.ts'
import { createStairGeometry, disposeStairGeometry, stairGeometryKey } from '../src/stairGeometry.ts'
import { createStairRiser } from '../src/stairRiser.ts'
import { getStairSpindlePositions } from '../src/stairSpindlePlacement.ts'
import { createStairTread } from '../src/stairTread.ts'

test('stepped landing soffits do not overlap their risers or form paired coplanar bridges', () => {
  for (const layout of ['l', 'u'] as const) for (const turn of ['left', 'right'] as const) for (const landingSteps of [1, 2, 3] as const) {
    const d = { ...createStairDesign(), layout, turn, landingSteps }, object = createStairGeometry(d)
    try {
      const panels = getStairLayout(d).surfaces.filter(s => s.landing)
      const underside = object.getObjectByName('stair-underside') as Mesh
      ;(underside.material as MeshStandardMaterial).side = DoubleSide // Include hidden overlapping caps.
      for (const s of panels.slice(1)) {
        const [a, b] = s.front, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz)
        const centre = s.polygon.reduce((p, v) => ({ x: p.x + v.x / s.polygon.length, z: p.z + v.z / s.polygon.length }), { x: 0, z: 0 })
        const normal = new Vector3(-dz / length, 0, dx / length), midpoint = new Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2)
        if (normal.x * (centre.x - midpoint.x) + normal.z * (centre.z - midpoint.z) > 0) normal.negate()
        midpoint.y = s.top - d.totalRise / d.riserCount + .01
        const ray = new Raycaster(midpoint.clone().addScaledVector(normal, .03), normal.clone().negate())
        assert.equal(ray.intersectObject(underside).filter(h => h.distance < .03001).length, 0, 'no underside bridge in the riser face')
        midpoint.y = s.top - d.totalRise / d.riserCount - d.treadThickness - .01
        ray.set(midpoint.clone().addScaledVector(normal, .03), normal.clone().negate())
        const hits = ray.intersectObject(underside).filter(h => Math.abs(h.distance - .03) < 1e-6)
        assert.ok(hits.length <= 1, 'at most one soffit face below the previous tread')
      }
    } finally { disposeStairGeometry(object) }
  }
})

test('rounded tread nosing has six curved faces, continuous normals and metre-based unwrapped UVs', () => {
  const d = createStairDesign(), s = getStairLayout(d).surfaces[0], r = .01
  const geometry = createStairTread(s, d.treadThickness, d.nosing, r)
  try {
    const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv')
    const arcAngles = new Set<number>(), arcVertices = []
    for (let i = 0; i < p.count; i++) if (n.getY(i) > 1e-6 && n.getY(i) < .999999 && n.getZ(i) < -1e-6) {
      const angle = Math.acos(n.getY(i)); arcAngles.add(Math.round(angle * 1e6)); arcVertices.push(i)
      assert.ok(Math.abs(p.getY(i) - (s.top - r + r * Math.cos(angle))) < 1e-6)
      assert.ok(Math.abs(p.getZ(i) - (s.front[0].z - d.nosing + r - r * Math.sin(angle))) < 1e-6)
      assert.ok(Math.abs(uv.getY(i) - (-s.front[0].z + d.nosing - r + r * angle)) < 1e-6)
    }
    assert.equal(arcAngles.size, 5, 'five intermediate angles divide the quarter-round into six segments')
    assert.ok(arcVertices.length)
    const square = createStairTread(s, d.treadThickness, d.nosing)
    assert.equal(p.count - square.getAttribute('position').count, 72, 'rounding adds only 24 triangles per tread, including end caps')
    square.dispose()
    const roundDesign = { ...d, nosingRadius: r }
    assert.equal(validateStairDesign(JSON.parse(JSON.stringify(roundDesign))), null)
    assert.notEqual(stairGeometryKey(roundDesign), stairGeometryKey(d))
  } finally { geometry.dispose() }
})

test('riser end caps clear the fascia, fronts do not protrude, and fascia normals face outwards', () => {
  const d = createStairDesign(), layout = getStairLayout(d), object = createStairGeometry(d)
  try {
    const risers = object.getObjectByName('stair-risers') as Mesh, fascia = object.getObjectByName('stair-underside') as Mesh
    const bounds = new Box3().setFromObject(risers)
    assert.ok(bounds.min.x > -d.width / 2 + .0009 && bounds.max.x < d.width / 2 - .0009)
    assert.ok(bounds.min.z >= layout.bounds.minZ - 1e-6, 'riser thickness sits behind the front plane')
    assert.equal((fascia.material as MeshStandardMaterial).side, FrontSide)
    const s = layout.surfaces[1], y = s.top - d.treadThickness - .03, z = s.front[0].z + .005
    const ray = new Raycaster(new Vector3(d.width / 2 + .1, y, z), new Vector3(-1, 0, 0))
    const hits = ray.intersectObject(fascia).filter(h => h.distance < .101)
    assert.equal(hits.length, 1)
    assert.ok(hits[0].face!.normal.x > .99, 'outside panel faces out, including shadow normals')
    const frontRay = new Raycaster(new Vector3(.13, y, s.front[0].z - .001), new Vector3(0, 0, 1))
    assert.ok(frontRay.intersectObject(risers).some(h => h.distance < .0011))
    assert.equal(frontRay.intersectObject(fascia).filter(h => h.distance < .0011).length, 0, 'no duplicate soffit face behind the riser')
  } finally { disposeStairGeometry(object) }
})

test('angled riser ends stay inside winding and stepped landing footprints in either handedness', () => {
  for (const layout of ['l', 'u'] as const) for (const turn of ['left', 'right'] as const)
    for (const profile of ['winder', 0, 1, 2, 3] as const) {
      const d = { ...createStairDesign(), layout, turn, turnType: profile === 'winder' ? 'winder' as const : 'landing' as const,
        landingSteps: profile === 'winder' ? 0 as const : profile }
      for (const s of getStairLayout(d).surfaces) {
        if (s.landing && !s.riser) continue
        const centre = s.polygon.reduce((p, v) => ({ x: p.x + v.x / s.polygon.length, z: p.z + v.z / s.polygon.length }), { x: 0, z: 0 })
        const geometry = createStairRiser(...s.front, centre, s.top - d.treadThickness, d.totalRise / d.riserCount - d.treadThickness, s.polygon)
        try {
          const p = geometry.getAttribute('position')
          assert.ok(p.count > 0)
          for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), z = p.getZ(i)
            let inside = false, onEdge = false
            for (let j = 0; j < s.polygon.length; j++) {
              const a = s.polygon[j], b = s.polygon[(j + 1) % s.polygon.length], dx = b.x - a.x, dz = b.z - a.z
              const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)))
              if (Math.hypot(x - a.x - t * dx, z - a.z - t * dz) < 1e-6) onEdge = true
              if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside
            }
            assert.ok(inside || onEdge, 'riser cannot poke through the exterior side panel')
          }
        } finally { geometry.dispose() }
      }
    }
})

test('riser UVs measure metres across width and height, with independent persisted finish scales', () => {
  const d = createStairDesign(), object = createStairGeometry(d)
  try {
    const geometry = (object.getObjectByName('stair-risers') as Mesh).geometry
    const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv')
    for (let i = 0; i < p.count; i++) if (Math.abs(n.getZ(i)) > .99) {
      assert.ok(Math.abs(uv.getX(i) - p.getX(i)) < 1e-6)
      assert.ok(Math.abs(uv.getY(i) - p.getY(i)) < 1e-6)
    }
    const scaled = structuredClone(d); scaled.finishes.risers.textureScale = 2; scaled.finishes.treads.textureScale = .5
    assert.equal(validateStairDesign(JSON.parse(JSON.stringify(scaled))), null)
    assert.equal(stairGeometryKey(scaled), stairGeometryKey(d), 'texture scaling retains geometry buffers')
    scaled.finishes.risers.textureScale = 0
    assert.ok(validateStairDesign(scaled))
  } finally { disposeStairGeometry(object) }
})

test('bottom newels reach the lower floor while landing newels stay on their own levels', () => {
  for (const layout of ['straight', 'l', 'u'] as const) {
    const d = { ...createStairDesign(), layout }, object = createStairGeometry(d)
    try {
      const p = (object.getObjectByName('stair-posts') as Mesh).geometry.getAttribute('position'), boxes: Box3[] = []
      for (let i = 0; i < p.count; i += 36) {
        const box = new Box3()
        for (let j = i; j < i + 36; j++) box.expandByPoint(new Vector3().fromBufferAttribute(p, j))
        boxes.push(box)
      }
      assert.equal(boxes.filter(b => Math.abs(b.min.y) < 1e-6).length, 2)
      assert.ok(boxes.filter(b => b.min.y > 1e-6).every(b => b.min.y >= d.totalRise / d.riserCount))
    } finally { disposeStairGeometry(object) }
  }
})

test('spindles have equal clear gaps to both newels and each other across changes in rail pitch', () => {
  const d = createStairDesign(), path = [{ x: 0, y: .18, z: 0 }, { x: 0, y: 1.8, z: 2.25 }, { x: 0, y: 1.8, z: 2.5 }]
  const positions = getStairSpindlePositions(path, [path[0], path.at(-1)!], d)
  assert.ok(positions.length > 10)
  const gaps = [positions[0].z - (d.postWidth + d.spindleWidth) / 2]
  for (let i = 1; i < positions.length; i++) gaps.push(positions[i].z - positions[i - 1].z - d.spindleWidth)
  gaps.push(2.5 - positions.at(-1)!.z - (d.postWidth + d.spindleWidth) / 2)
  assert.ok(gaps.every(g => g > 0 && Math.abs(g - gaps[0]) < 1e-8))
  assert.ok(gaps[0] + d.spindleWidth <= d.spindleSpacing + 1e-8)
  for (const p of positions) assert.ok(Math.abs(p.y - (p.z < 2.25 ? .18 + p.z * 1.62 / 2.25 : 1.8)) < 1e-8)
})
