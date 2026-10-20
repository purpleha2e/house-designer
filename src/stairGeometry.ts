import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial,
  Quaternion, Vector3, FrontSide, Box3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import spindle from './stairSpindle.json' with { type: 'json' }
import { getStairFinish, getStairLayout, stairParts, type StairDesign, type StairPart, type StairPoint, type StairRailPoint } from './stairDesign.ts'
import { createStairUnderside } from './stairUnderside.ts'
import { createStairHandrail, getStairRailPath } from './stairRailings.ts'
import { stairNewelRailHeight, trimStairRailsAtNewels } from './stairRailJoints.ts'
import { getStairSpindlePositions } from './stairSpindlePlacement.ts'
import { createStairRiser } from './stairRiser.ts'
import { createStairTread } from './stairTread.ts'
import { rotateStairUvs, setStairWorldUvs } from './stairUvs.ts'

export function createStairSpindleGeometry() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(spindle.position, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(spindle.normal, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(spindle.uv, 2))
  geometry.setIndex(spindle.index)
  return rotateStairUvs(geometry)
}

export function stairGeometryKey(design: StairDesign) {
  const { finishes: _finishes, ...geometry } = design
  void _finishes
  // Invalidate existing previews when the generated topology changes too.
  return `8:${JSON.stringify(geometry)}`
}

function contains(p: StairPoint, polygon: StairPoint[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j], dx = b.x - a.x, dz = b.z - a.z
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)))
    if (Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz) < 1e-6) return true
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

/** One draw mesh per material, irrespective of the number of treads/spindles. */
export function createStairGeometry(design: StairDesign) {
  const layout = getStairLayout(design), group = new Group()
  group.name = 'parametric-stairs'
  group.userData.stairDesign = design
  const parts = Object.fromEntries(stairParts.map(part => [part, [] as BufferGeometry[]])) as Record<StairPart, BufferGeometry[]>
  const add = (part: StairPart, geometry: BufferGeometry) => {
    if (geometry.index) { const expanded = geometry.toNonIndexed(); geometry.dispose(); geometry = expanded }
    geometry.clearGroups(); parts[part].push(geometry)
  }
  if (design.closedUnderside) add('underside', createStairUnderside(design, layout))
  const beam = (part: StairPart, from: StairRailPoint, to: StairRailPoint, width: number) => {
    const a = new Vector3(from.x, from.y, from.z), b = new Vector3(to.x, to.y, to.z), direction = b.clone().sub(a)
    if (direction.lengthSq() < 1e-10) return
    // Unwrap locally at one UV unit per metre. Newels use U along the grain;
    // sloping supports keep their existing orientation.
    const geometry = setStairWorldUvs(new BoxGeometry(width, direction.length(), width))
    if (part === 'posts') rotateStairUvs(geometry)
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()))
    geometry.translate(...a.add(b).multiplyScalar(.5).toArray())
    add(part, geometry)
  }
  const riser = (a: StairPoint, b: StairPoint, top: number, inside: StairPoint, footprint?: StairPoint[]) => {
    add('risers', createStairRiser(a, b, inside, top - design.treadThickness, layout.riserHeight - design.treadThickness, footprint))
  }
  for (const surface of layout.surfaces) {
    add('treads', createStairTread(surface, design.treadThickness, design.nosing, design.nosingRadius))
    if (surface.landing && !surface.riser) continue
    const [a, b] = surface.front, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz)
    if (length < 1e-6) continue
    const centre = surface.polygon.reduce((sum, p) => ({ x: sum.x + p.x / surface.polygon.length, z: sum.z + p.z / surface.polygon.length }), { x: 0, z: 0 })
    if (design.closedRisers) riser(a, b, surface.top, centre, surface.polygon)
  }
  if (layout.compactLanding && design.closedRisers) {
    const upper = layout.flights.at(-1)!
    const a = upper.left.at(-1)!, b = upper.right.at(-1)!, before = upper.left.at(-2)!
    riser(a, b, design.totalRise, { x: a.x * 2 - before.x, z: a.z * 2 - before.z })
  }
  // The enclosed side panels replace these separate open-stair supports.
  if (design.stringers && !design.closedUnderside) for (const flight of layout.flights) for (const [path, opposite] of [[flight.left, flight.right], [flight.right, flight.left]]) {
    const a = path[0], b = path.at(-1)!
    // Keep open-stair supports underneath the tread footprint.
    const inset = .07 / 2 + .001
    const dx = (opposite[0].x - a.x) / design.width * inset, dz = (opposite[0].z - a.z) / design.width * inset
    beam('stringers', { x: a.x + dx, z: a.z + dz, y: Math.max(.045, a.y - .08) },
      { x: b.x + dx, z: b.z + dz, y: Math.max(.045, b.y - .08) }, .07)
  }
  const originalSpindle = createStairSpindleGeometry()
  const newelBounds: Box3[] = []
  try {
    for (const side of ['left', 'right'] as const) {
      if (!design.banisters[side] && !design.handrails[side]) continue
      const baseHeight = (p: StairPoint, fallback: number) => {
        const heights = layout.surfaces.filter(s => contains(p, s.polygon)).map(s => s.top)
        return heights.length ? Math.max(...heights) : fallback
      }
      const path = getStairRailPath(design, layout, side)
      const railY = (p: StairRailPoint) => p.y + design.railHeight
      if (design.handrails[side]) {
        // Different landing levels meet inside a newel. Cap each rail there,
        // rather than bending a rail vertically through the step transition.
        let section: StairRailPoint[] = []
        const flush = () => { if (section.length > 1) add('handrails', createStairHandrail(section, design.handrailWidth)) }
        for (const p of path) {
          const previous = section.at(-1)
          if (previous && Math.hypot(p.x - previous.x, p.z - previous.z) < 1e-7) { flush(); section = [] }
          section.push({ ...p, y: railY(p) })
        }
        flush()
      }
      if (!design.banisters[side]) continue
      const posts: StairRailPoint[] = []
      const insideUTurn = design.layout === 'u' && side === (design.turn === 'right' ? 'right' : 'left')
      const turnZ = layout.flights[0].left.at(-1)!.z
      for (let i = 0; i < path.length; i++) {
        const p = path[i], before = path[Math.max(0, i - 1)], after = path[Math.min(path.length - 1, i + 1)]
        const ax = p.x - before.x, az = p.z - before.z, bx = after.x - p.x, bz = after.z - p.z
        const corner = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1) < .8
        if (!i || i === path.length - 1 || (corner && (!insideUTurn || Math.abs(p.z - turnZ) < 1e-7))) {
          const existing = posts.find(post => Math.hypot(post.x - p.x, post.z - p.z) < 1e-7)
          if (existing) existing.y = Math.max(existing.y, p.y)
          else posts.push({ ...p })
        }
      }
      for (const p of posts) {
        // One newel joins both rail heights at a stepped landing.
        const heights = layout.surfaces.filter(s => contains(p, s.polygon)).map(s => s.top)
        const isBottomPost = Math.hypot(p.x - path[0].x, p.z - path[0].z) < 1e-7
        const bottom = isBottomPost ? 0 : heights.length ? Math.min(...heights) : p.y
        const railHeight = design.handrails[side] ? stairNewelRailHeight(path, p, design.postWidth, design.handrailWidth) : p.y
        const top = railHeight + design.railHeight + design.handrailWidth / 2 + .025
        const end = Math.max(top, bottom + .05), half = design.postWidth / 2
        beam('posts', { ...p, y: bottom }, { ...p, y: end }, design.postWidth)
        newelBounds.push(new Box3(new Vector3(p.x - half, bottom, p.z - half), new Vector3(p.x + half, end, p.z + half)))
      }
      for (const p of getStairSpindlePositions(path, posts, design)) {
        const bottom = baseHeight(p, p.y), height = Math.max(.05, railY(p) - design.handrailWidth / 2 - bottom)
        const geometry = originalSpindle.clone()
        geometry.scale(design.spindleWidth / spindle.size[0], height / spindle.size[1], design.spindleWidth / spindle.size[2])
        geometry.translate(p.x, bottom, p.z); add('spindles', geometry)
      }
    }
  } finally { originalSpindle.dispose() }
  for (const part of stairParts) {
    if (!parts[part].length) continue
    let geometry = mergeGeometries(parts[part])!
    parts[part].forEach(g => g.dispose())
    if (part === 'handrails' && newelBounds.length) {
      const trimmed = trimStairRailsAtNewels(geometry, newelBounds)
      geometry.dispose(); geometry = trimmed
    }
    geometry.computeBoundingBox(); geometry.computeBoundingSphere()
    const { color, roughness, metalness } = getStairFinish(design, part)
    const material = new MeshStandardMaterial({ color, roughness, metalness, side: FrontSide })
    material.name = `stairs_${part}`
    const mesh = new Mesh(geometry, material)
    mesh.name = `stair-${part}`; mesh.userData.stairPart = part
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}

export function disposeStairGeometry(group: Group) {
  group.traverse(object => {
    if (object instanceof Mesh) { object.geometry.dispose(); (object.material as MeshStandardMaterial).dispose() }
  })
}
