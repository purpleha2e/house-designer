// Regenerate matching closed/open three-leaf doors from the patio-door materials.
// Run from the repository root: node scripts/generate-bifold-doors.mjs
import { Document, NodeIO } from '@gltf-transform/core'
import { BoxGeometry, CylinderGeometry, Matrix4, Vector3 } from 'three'

const io = new NodeIO()
const reference = await io.read('src/models/assets/patio_doors.glb')
const sourceMaterials = reference.getRoot().listMaterials()
const handleSource = reference.getRoot().listNodes().find(node => node.getName() === 'left_door_handle').getMesh().listPrimitives()[0]
const width = 2.4, height = 2.08, frameDepth = 0.08
const frameZ = 0.04126772, jamb = 0.075, sill = 0.09, head = 0.075
const gap = 0.006, leafWidth = (width - 2 * jamb - 4 * gap) / 3
const leafBottom = sill + gap, leafHeight = height - head - sill - 2 * gap
const stile = 0.05, leafDepth = 0.052

for (const open of [false, true]) {
  const document = new Document()
  const buffer = document.createBuffer()
  const materials = sourceMaterials.map(source => document.createMaterial(source.getName())
    .setBaseColorFactor(source.getBaseColorFactor()).setMetallicFactor(source.getMetallicFactor())
    .setRoughnessFactor(source.getRoughnessFactor()).setAlphaMode(source.getAlphaMode())
    .setDoubleSided(source.getName().includes('glass') || source.getDoubleSided()))
  const [frameMaterial, metalMaterial, glassMaterial] = materials
  const sealMaterial = document.createMaterial('bifold_weather_seals')
    .setBaseColorFactor([0.025, 0.03, 0.035, 1]).setRoughnessFactor(0.85)
  const scene = document.createScene(open ? 'Three-pane bifold doors — open' : 'Three-pane bifold doors — closed')
  const root = document.createNode('bifold_door_assembly').setExtras({
    openingWidth: width, openingHeight: height, frameDepth, panelCount: 3,
    state: open ? 'open' : 'closed', foldingSide: 'left',
  })
  scene.addChild(root)

  function meshFromGeometry(name, geometry, material) {
    const primitive = document.createPrimitive().setMaterial(material)
    for (const [threeName, gltfName] of [['position', 'POSITION'], ['normal', 'NORMAL']]) {
      primitive.setAttribute(gltfName, document.createAccessor().setType('VEC3')
        .setArray(geometry.attributes[threeName].array.slice()).setBuffer(buffer))
    }
    if (geometry.index) primitive.setIndices(document.createAccessor().setType('SCALAR')
      .setArray(geometry.index.array.slice()).setBuffer(buffer))
    geometry.dispose()
    return document.createMesh(name).addPrimitive(primitive)
  }
  function box(parent, name, size, position, material = frameMaterial) {
    const node = document.createNode(name).setMesh(meshFromGeometry(name, new BoxGeometry(...size), material))
      .setTranslation(position)
    parent.addChild(node)
    return node
  }
  function hinge(parent, name, position) {
    const node = document.createNode(name).setTranslation(position).setMesh(meshFromGeometry(name,
      new CylinderGeometry(0.005, 0.005, 0.036, 8), metalMaterial))
    parent.addChild(node)
  }
  const handlePrimitive = document.createPrimitive().setMaterial(metalMaterial)
  for (const semantic of ['POSITION', 'NORMAL']) {
    const source = handleSource.getAttribute(semantic)
    handlePrimitive.setAttribute(semantic, document.createAccessor().setType(source.getType())
      .setArray(source.getArray().slice()).setBuffer(buffer))
  }
  if (handleSource.getIndices()) handlePrimitive.setIndices(document.createAccessor().setType('SCALAR')
    .setArray(handleSource.getIndices().getArray().slice()).setBuffer(buffer))
  const handleMesh = document.createMesh('reference_patio_door_handle').addPrimitive(handlePrimitive)

  box(root, 'fixed_left_jamb', [jamb, height, frameDepth], [-width / 2 + jamb / 2, height / 2, frameZ])
  box(root, 'fixed_right_jamb', [jamb, height, frameDepth], [width / 2 - jamb / 2, height / 2, frameZ])
  box(root, 'fixed_head', [width - 2 * jamb, head, frameDepth], [0, height - head / 2, frameZ])
  box(root, 'fixed_sill', [width - 2 * jamb, sill, frameDepth], [0, sill / 2, frameZ])
  box(root, 'top_guide_track', [width - 2 * jamb, 0.008, 0.011], [0, height - head + 0.001, frameZ], metalMaterial)
  box(root, 'bottom_guide_track', [width - 2 * jamb, 0.007, 0.011], [0, sill + 0.001, frameZ], metalMaterial)

  let hingeX = -width / 2 + jamb + gap, hingeZ = frameZ - leafDepth / 2
  for (let index = 0; index < 3; index++) {
    const angle = open ? (index % 2 ? -1 : 1) * 85 * Math.PI / 180 : 0
    // Alternate hinges on opposite leaf faces, keeping the folded frames apart.
    const leftPivotZ = (index % 2 ? 1 : -1) * leafDepth / 2
    const rightPivotZ = -leftPivotZ
    const originX = hingeX - Math.sin(angle) * leftPivotZ
    const originZ = hingeZ - Math.cos(angle) * leftPivotZ
    const leaf = document.createNode(`bifold_leaf_${index + 1}`)
      .setTranslation([originX, 0, originZ]).setRotation([0, Math.sin(angle / 2), 0, Math.cos(angle / 2)])
      .setExtras({ panelIndex: index + 1, width: leafWidth, hingeAngleDegrees: angle * 180 / Math.PI })
    root.addChild(leaf)
    const midY = leafBottom + leafHeight / 2
    box(leaf, `leaf_${index + 1}_left_stile`, [stile, leafHeight, leafDepth], [stile / 2, midY, 0])
    box(leaf, `leaf_${index + 1}_right_stile`, [stile, leafHeight, leafDepth], [leafWidth - stile / 2, midY, 0])
    box(leaf, `leaf_${index + 1}_top_rail`, [leafWidth - 2 * stile, stile, leafDepth], [leafWidth / 2, leafBottom + leafHeight - stile / 2, 0])
    box(leaf, `leaf_${index + 1}_bottom_rail`, [leafWidth - 2 * stile, 0.075, leafDepth], [leafWidth / 2, leafBottom + 0.0375, 0])
    const glassWidth = leafWidth - 2 * stile, glassHeight = leafHeight - stile - 0.075
    const glassY = leafBottom + 0.075 + glassHeight / 2
    for (const [name, size, position] of [
      ['seal_left', [0.003, glassHeight, 0.01], [stile + 0.0015, glassY, 0]],
      ['seal_right', [0.003, glassHeight, 0.01], [leafWidth - stile - 0.0015, glassY, 0]],
      ['seal_top', [glassWidth, 0.003, 0.01], [leafWidth / 2, glassY + glassHeight / 2 - 0.0015, 0]],
      ['seal_bottom', [glassWidth, 0.003, 0.01], [leafWidth / 2, glassY - glassHeight / 2 + 0.0015, 0]],
    ]) box(leaf, `leaf_${index + 1}_${name}`, size, position, sealMaterial)
    box(leaf, `leaf_${index + 1}_clear_glass_pane`, [glassWidth - 0.006, glassHeight - 0.006, 0.012], [leafWidth / 2, glassY, 0], glassMaterial)
    for (const y of [leafBottom + 0.18, midY, leafBottom + leafHeight - 0.18]) {
      hinge(leaf, `leaf_${index + 1}_hinge_${y.toFixed(2)}`, [0, y, leftPivotZ])
    }
    if (index === 0 || index === 2) {
      leaf.addChild(document.createNode(`leaf_${index + 1}_dark_handle`).setMesh(handleMesh)
        .setTranslation([leafWidth - stile / 2 - 0.065, 0, -0.0217677]))
    }
    hingeX = originX + Math.cos(angle) * leafWidth + Math.sin(angle) * rightPivotZ + gap
    hingeZ = originZ - Math.sin(angle) * leafWidth + Math.cos(angle) * rightPivotZ
  }

  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (const node of document.getRoot().listNodes()) {
    if (!node.getMesh()) continue
    const matrix = new Matrix4().fromArray(node.getWorldMatrix())
    for (const primitive of node.getMesh().listPrimitives()) {
      const positions = primitive.getAttribute('POSITION').getArray()
      for (let index = 0; index < positions.length; index += 3) {
        const point = new Vector3().fromArray(positions, index).applyMatrix4(matrix)
        point.toArray().forEach((value, axis) => {
          bounds.min[axis] = Math.min(bounds.min[axis], value)
          bounds.max[axis] = Math.max(bounds.max[axis], value)
        })
      }
    }
  }
  root.setExtras({ ...root.getExtras(), bounds })
  const path = `src/models/assets/patio_doors_bifold_three_pane_${open ? 'open' : 'closed'}.glb`
  await io.write(path, document)
  console.log(JSON.stringify({ path, bounds, leafWidth }))
}
