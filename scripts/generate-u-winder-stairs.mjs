// Run from the repository root: node scripts/generate-u-winder-stairs.mjs
import { Document, NodeIO } from '@gltf-transform/core'
import { BoxGeometry, ExtrudeGeometry, Matrix4, Quaternion, Shape, Vector3 } from 'three'

export const stairDimensions = {
  width: 1.57, depth: 2.4, rise: 2.7,
  straightSteps: 6, windingSteps: 6, wellWidth: 0.09, railHeight: 0.9,
}

export function createUWinderStairs() {
  const { width, depth, rise, straightSteps, windingSteps, wellWidth, railHeight } = stairDimensions
  const halfWidth = width / 2, halfWell = wellWidth / 2
  const front = depth / 2, turnZ = -depth / 2 + halfWidth
  const going = (front - turnZ) / straightSteps
  const riser = rise / (2 * straightSteps + windingSteps)
  const treadThickness = 0.03
  const document = new Document(), buffer = document.createBuffer()
  const steps = document.createMaterial('stairs_steps')
    .setBaseColorFactor([0.55, 0.32, 0.15, 1]).setRoughnessFactor(0.65)
  const wood = document.createMaterial('stairs_woodwork')
    .setBaseColorFactor([0.88, 0.86, 0.81, 1]).setRoughnessFactor(0.75)
  const rail = document.createMaterial('stairs_banister')
    .setBaseColorFactor([0.42, 0.23, 0.1, 1]).setRoughnessFactor(0.5)
  const root = document.createNode('u_winder_stairs_right_157cm').setExtras({
    ...stairDimensions, riser, going, lowerFlight: 'right',
    lowerLanding: [(halfWidth + halfWell) / 2, front],
    upperLanding: [-(halfWidth + halfWell) / 2, front],
  })
  document.createScene('U-winder stairs - right-hand ascent - 157 cm').addChild(root)

  function geometryNode(name, geometry, material, position = [0, 0, 0]) {
    const primitive = document.createPrimitive().setMaterial(material)
    for (const [attribute, semantic, type] of [
      ['position', 'POSITION', 'VEC3'], ['normal', 'NORMAL', 'VEC3'], ['uv', 'TEXCOORD_0', 'VEC2'],
    ]) {
      if (geometry.attributes[attribute]) primitive.setAttribute(semantic,
        document.createAccessor().setType(type).setArray(geometry.attributes[attribute].array.slice()).setBuffer(buffer))
    }
    if (geometry.index) primitive.setIndices(document.createAccessor().setType('SCALAR')
      .setArray(geometry.index.array.slice()).setBuffer(buffer))
    const node = document.createNode(name).setTranslation(position)
      .setMesh(document.createMesh(name).addPrimitive(primitive))
    root.addChild(node)
    geometry.dispose()
    return node
  }
  function box(name, size, position, material = wood) {
    return geometryNode(name, new BoxGeometry(...size), material, position)
  }
  function beam(name, from, to, thickness, material = wood) {
    const start = new Vector3(...from), end = new Vector3(...to)
    const direction = end.clone().sub(start)
    const node = box(name, [thickness, direction.length(), thickness],
      start.clone().add(end).multiplyScalar(0.5).toArray(), material)
    return node.setRotation(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()).toArray())
  }
  function prism(name, polygon, bottom, height, material) {
    const shape = new Shape(polygon.map(([x, z]) => ({ x, y: -z })))
    const geometry = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 })
    geometry.rotateX(-Math.PI / 2)
    return geometryNode(name, geometry, material, [0, bottom, 0])
  }
  function tread(name, polygon, step) {
    const top = step * riser
    prism(`${name}_riser`, polygon, top - riser, riser - treadThickness, wood)
    prism(`${name}_tread`, polygon, top - treadThickness, treadThickness, steps)
  }
  const railingPaths = { inner: [], outer: [] }
  function railingPoint(side, x, z, floorHeight, name, newel = false, railLift = 0) {
    const size = newel ? 0.045 : 0.022
    // Top face of the handrail is exactly railHeight above the walking surface.
    const top = floorHeight + railHeight - 0.0225 + railLift
    box(`${name}_${side}_${newel ? 'newel' : 'spindle'}`, [size, top - floorHeight, size],
      [x, (top + floorHeight) / 2, z])
    railingPaths[side].push([x, top, z])
  }
  // The front is +Z: first climb the right flight toward the back (-Z).
  for (let index = 0; index < straightSteps; index++) {
    const near = front - index * going, far = near - going
    tread(`lower_${index + 1}`, [[halfWell, near], [halfWidth, near], [halfWidth, far], [halfWell, far]], index + 1)
    for (const [side, x] of [['inner', halfWell + 0.03], ['outer', halfWidth - 0.03]]) {
      railingPoint(side, x, near - 0.03, (index + 1) * riser, `lower_${index + 1}`, index === 0, 0.03 / going * riser)
      railingPoint(side, x, (near + far) / 2, (index + 1) * riser, `lower_${index + 1}_mid`, false, 0.5 * riser)
    }
  }
  const squarePoint = (angle, radius) => {
    const distance = radius / Math.max(Math.abs(Math.cos(angle)), Math.sin(angle))
    return [distance * Math.cos(angle), turnZ - distance * Math.sin(angle)]
  }
  // Six fan treads make a half turn. Insert square corners so there are no
  // gaps or clipped corners where a tread crosses a 45/135 degree boundary.
  for (let index = 0; index < windingSteps; index++) {
    const start = index * Math.PI / windingSteps, end = (index + 1) * Math.PI / windingSteps
    const angles = [start, ...[Math.PI / 4, 3 * Math.PI / 4].filter(a => a > start && a < end), end]
    const polygon = [...angles.map(a => squarePoint(a, halfWidth)),
      ...angles.toReversed().map(a => squarePoint(a, halfWell))]
    const step = straightSteps + index + 1
    tread(`winder_${index + 1}`, polygon, step)
    // Include bend corners in both rails rather than cutting across the treads.
    for (const angle of angles.slice(0, -1)) {
      for (const [side, radius] of [['inner', halfWell + 0.03], ['outer', halfWidth - 0.03]]) {
        const [x, z] = squarePoint(angle, radius)
        const progression = (angle - start) / (end - start)
        railingPoint(side, x, z, step * riser, `winder_${index + 1}_${angle.toFixed(3)}`, false, progression * riser)
      }
    }
  }
  // Return toward the front on the left; the final tread is at 2.70 m.
  for (let index = 0; index < straightSteps; index++) {
    const far = turnZ + index * going, near = far + going
    const step = straightSteps + windingSteps + index + 1
    tread(`upper_${index + 1}`, [[-halfWidth, far], [-halfWell, far], [-halfWell, near], [-halfWidth, near]], step)
    for (const [side, x] of [['inner', -halfWell - 0.03], ['outer', -halfWidth + 0.03]]) {
      const lift = index === straightSteps - 1 ? 0 : riser
      railingPoint(side, x, far + 0.03, step * riser, `upper_${index + 1}`, false, 0.03 / going * lift)
      railingPoint(side, x, (near + far) / 2, step * riser, `upper_${index + 1}_mid`, false, 0.5 * lift)
      if (index === straightSteps - 1) railingPoint(side, x, near - 0.03, rise, 'upper_landing', true)
    }
  }
  for (const [side, points] of Object.entries(railingPaths)) {
    for (let index = 1; index < points.length; index++) beam(`${side}_handrail_${index}`,
      points[index - 1], points[index], 0.045, rail)
  }
  // Sloping strings carry the straight flights and keep the underside open.
  for (const [side, x] of [['inner', halfWell + 0.03], ['outer', halfWidth - 0.03]]) {
    beam(`lower_${side}_string`, [x, 0.045, front - 0.015], [x, straightSteps * riser - 0.105, turnZ + 0.015], 0.06)
    beam(`upper_${side}_string`, [-x, (straightSteps + windingSteps) * riser + 0.045, turnZ + 0.015],
      [-x, rise - 0.105, front - 0.015], 0.06)
  }
  return document
}

export function documentBounds(document) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const node of document.getRoot().listNodes()) {
    if (!node.getMesh()) continue
    const matrix = new Matrix4().fromArray(node.getWorldMatrix())
    for (const primitive of node.getMesh().listPrimitives()) {
      const positions = primitive.getAttribute('POSITION').getArray()
      for (let index = 0; index < positions.length; index += 3) {
        new Vector3().fromArray(positions, index).applyMatrix4(matrix).toArray().forEach((value, axis) => {
          min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value)
        })
      }
    }
  }
  return { min, max }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/generate-u-winder-stairs.mjs')) {
  const document = createUWinderStairs()
  const bounds = documentBounds(document)
  await new NodeIO().write('src/models/assets/u_winder_stairs_right_157cm.glb', document)
  console.log(JSON.stringify({ ...stairDimensions, bounds }))
}
