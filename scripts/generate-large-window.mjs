// Run from the repository root: node scripts/generate-large-window.mjs
import { Document, NodeIO } from '@gltf-transform/core'
import { BoxGeometry } from 'three'

const io = new NodeIO()
const reference = await io.read('src/models/assets/window_three_pane.glb')
const document = new Document()
const buffer = document.createBuffer()
const [frame, glass] = reference.getRoot().listMaterials().map(source =>
  document.createMaterial(source.getName())
    .setBaseColorFactor(source.getBaseColorFactor())
    .setMetallicFactor(source.getMetallicFactor())
    .setRoughnessFactor(source.getRoughnessFactor())
    .setAlphaMode(source.getAlphaMode())
    .setDoubleSided(source.getName().includes('glass') || source.getDoubleSided()))
const width = 1.8, height = 2, depth = 0.08, rim = 0.07
const frameZ = 0.04018126
const root = document.createNode('large_single_pane_window').setExtras({
  openingWidth: width, openingHeight: height, frameDepth: depth, panelCount: 1,
})
document.createScene('Large single-pane window').addChild(root)

function box(name, size, position, material) {
  const geometry = new BoxGeometry(...size)
  const primitive = document.createPrimitive().setMaterial(material)
  for (const [attribute, semantic] of [['position', 'POSITION'], ['normal', 'NORMAL']]) {
    primitive.setAttribute(semantic, document.createAccessor().setType('VEC3')
      .setArray(geometry.attributes[attribute].array.slice()).setBuffer(buffer))
  }
  primitive.setIndices(document.createAccessor().setType('SCALAR')
    .setArray(geometry.index.array.slice()).setBuffer(buffer))
  root.addChild(document.createNode(name).setTranslation(position)
    .setMesh(document.createMesh(name).addPrimitive(primitive)))
  geometry.dispose()
}

box('left_frame', [rim, height, depth], [-width / 2 + rim / 2, height / 2, frameZ], frame)
box('right_frame', [rim, height, depth], [width / 2 - rim / 2, height / 2, frameZ], frame)
box('top_frame', [width - 2 * rim, rim, depth], [0, height - rim / 2, frameZ], frame)
box('bottom_frame', [width - 2 * rim, rim, depth], [0, rim / 2, frameZ], frame)
box('single_glass_pane', [width - 2 * rim, height - 2 * rim, 0.012],
  [0, height / 2, frameZ + 0.012], glass)
await io.write('src/models/assets/window_large_single_pane.glb', document)
console.log('Created 1.8 x 2 m single-pane window, with matching 70 mm white frame and pale transparent glass.')
