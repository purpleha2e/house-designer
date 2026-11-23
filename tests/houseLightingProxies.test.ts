import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Ray, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { prepareHouseGeometry, type HousePart } from '../src/lightingLab/houseGeometry.ts'
import { isSolidDoorLeaf } from '../src/lightingLab/houseProxies.ts'

function door(): HousePart {
  const indexed = new BoxGeometry(.8, 2, .04, 8, 12, 2), mesh = indexed.toNonIndexed(); indexed.dispose()
  const part: HousePart = { name: 'doorBase_geo', position: Float32Array.from(mesh.attributes.position.array),
    normal: Float32Array.from(mesh.attributes.normal.array), uv: Float32Array.from(mesh.attributes.uv.array),
    ranges: [{ start: 0, count: mesh.attributes.position.count, material: 0 }],
    matrices: [new Matrix4().toArray()], structural: false, lightingProxy: 'solid-door-leaf' }
  mesh.dispose(); return part
}

test('solid door uses 12 lighting triangles while retaining all visible geometry and UVs', () => {
  const source = door(), data = prepareHouseGeometry([source], () => {})
  assert.equal(data.position.length / 9, 12); assert.equal(data.cards.length, 6)
  assert.equal(data.proxyInstances, 1); assert.ok(data.display)
  assert.ok(data.display.position.every((v, i) => v === source.position[i])); assert.deepEqual(data.display.uv, source.uv)
  assert.ok(data.display.normal.every((v, i) => v === source.normal![i]))
  for (let at = 0; at < data.display.chart.length; at += 6) {
    const cards = [0, 2, 4].map(i => Math.floor(data.display!.chart[at + i] / 16) + Math.floor(data.display!.chart[at + i + 1] / 16) * 32)
    assert.equal(new Set(cards).size, 1, 'a display triangle must never interpolate across unrelated cache cards')
  }
})

test('open, mirrored and resized door proxies block their leaf without filling the doorway', () => {
  const source = door()
  source.matrices = [new Matrix4().makeRotationY(Math.PI / 2).multiply(new Matrix4().makeScale(-1.2, 1, 1)).setPosition(-.4, 1, -.48).toArray()]
  const data = prepareHouseGeometry([source], () => {}), geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(data.position, 3))
  const tree = MeshBVH.deserialize(data.tree, geometry)
  assert.equal(tree.raycastFirst(new Ray(new Vector3(0, 1, 1), new Vector3(0, 0, -1)), DoubleSide), null)
  assert.ok(tree.raycastFirst(new Ray(new Vector3(0, 1, -.48), new Vector3(-1, 0, 0)), DoubleSide))
  assert.ok(data.display); assert.equal(data.display.position.length, source.position.length)
  geometry.dispose()
})

test('flat door lighting preserves spatial samples across the proxy diagonal',()=>{
  const data=prepareHouseGeometry([door()],()=>{}),display=data.display!
  let checked=0
  for(let i=0;i<display.position.length/3;i++){
    if(Math.abs(display.normal[i*3+2])<.99)continue
    const x=display.position[i*3],y=display.position[i*3+1]
    assert.equal(display.vertexLighting[i],0,'A flat door samples its interior light, not just corner irradiance')
    assert.ok(Math.abs(display.chart[i*2]%16-(1.5+(x+.4)/.8*6))<1e-5,'Horizontal light coordinates must not collapse onto the proxy diagonal')
    assert.ok(Math.abs(display.chart[i*2+1]%16-(1.5+(y+1)/2*13))<1e-5,'Vertical light coordinates must cover the complete panel')
    checked++
  }
  assert.ok(checked>0)
})

test('proxy generation is reused for shared assets with independent instance materials and transforms', () => {
  const source = door(); source.geometryKey = 'shared-leaf'
  const second = { ...source, matrices: [new Matrix4().makeTranslation(3, 0, 0).toArray()], ranges: [{ ...source.ranges[0], material: 1 }] }
  const data = prepareHouseGeometry([source, second], () => {})
  assert.equal(data.proxyGeometries, 1); assert.equal(data.proxyInstances, 2); assert.equal(data.position.length / 9, 24)
  assert.deepEqual(data.groups.map(g => g.material), [0, 1]); assert.deepEqual(data.display!.groups.map(g => g.material), [0, 1])
})

test('frames, glazed doors and unknown models are not replaced by a solid bounding box', () => {
  assert.equal(isSolidDoorLeaf('panel-interior-door-open-low-detail', 'doorBase_geo'), true)
  for (const [model, mesh] of [['panel-interior-door-open-low-detail', 'doorFrame_geo'], ['patio-doors', 'doorBase_geo'], ['custom-door', 'doorBase_geo']])
    assert.equal(isSolidDoorLeaf(model, mesh), false)
  const source = door(); delete source.lightingProxy
  const data = prepareHouseGeometry([source], () => {})
  assert.equal(data.position.length, source.position.length); assert.equal(data.display, undefined)
})

test('actual angled panel door assets produce thin oriented lighting leaves', () => {
  for (const file of ['panel_interior_door_open_low_detail', 'panel_interior_door_full_open_low_detail', 'panel_interior_door_closed']) {
    const bytes = readFileSync(new URL(`../src/models/assets/${file}.glb`, import.meta.url)), jsonSize = bytes.readUInt32LE(12)
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString()), binaryStart = 28 + jsonSize
    const node = gltf.nodes.find((n: { name: string }) => n.name === 'doorBase_geo'), primitive = gltf.meshes[node.mesh].primitives[0]
    const read = (id: number) => {
      const a = gltf.accessors[id], view = gltf.bufferViews[a.bufferView], width = a.type === 'VEC3' ? 3 : a.type === 'VEC2' ? 2 : 1
      const size = a.componentType === 5123 ? 2 : 4, start = binaryStart + (view.byteOffset ?? 0) + (a.byteOffset ?? 0)
      return Array.from({ length: a.count * width }, (_, i) => {
        const offset = start + Math.floor(i / width) * (view.byteStride ?? width * size) + i % width * size
        return a.componentType === 5126 ? bytes.readFloatLE(offset) : size === 2 ? bytes.readUInt16LE(offset) : bytes.readUInt32LE(offset)
      })
    }
    const source: HousePart = { position: Float32Array.from(read(primitive.attributes.POSITION)), normal: Float32Array.from(read(primitive.attributes.NORMAL)),
      index: Uint32Array.from(read(primitive.indices)), ranges: [{ start: 0, count: gltf.accessors[primitive.indices].count, material: 0 }],
      matrices: [new Matrix4().toArray()], structural: false, lightingProxy: 'solid-door-leaf' }
    const data = prepareHouseGeometry([source], () => {})
    assert.equal(data.position.length / 9, 12, file); assert.equal(data.cards.length, 6, file)
    assert.equal(data.display!.position.length / 9, source.ranges[0].count / 3, file)
    assert.ok(data.display!.chart.every(Number.isFinite), file)
    const display = data.display!, visibleNormal = new Vector3(), receiverNormal = new Vector3()
    const mainFace = data.cards.reduce((a, b) => a.area > b.area ? a : b)
    const leafNormal = new Vector3().fromArray(data.normal, mainFace.start * 3)
    let checked = 0
    for (let i = 0; i < display.position.length / 3; i++) {
      const chart = Math.floor(display.vertexLightChart[i * 2] / 16) + Math.floor(display.vertexLightChart[i * 2 + 1] / 16) * 32
      visibleNormal.fromArray(display.normal, i * 3)
      // Recessed moulding normals need not have a nearby parallel proxy face.
      // The two broad sides of the leaf do, including their bottom vertices.
      if (Math.abs(visibleNormal.dot(leafNormal)) < .99) continue
      receiverNormal.fromArray(data.normal, data.cards[chart].start * 3)
      assert.ok(visibleNormal.dot(receiverNormal) > .5,
        `${file}: vertex ${i} must inherit lighting from the same-facing proxy surface, including door edges: ${JSON.stringify({normal:visibleNormal.toArray(),receiver:receiverNormal.toArray(),point:[...display.position.slice(i*3,i*3+3)]})}`)
      checked++
    }
    assert.ok(checked > 0)
    assert.ok(display.vertexLighting.some(value => value === 0), `${file}: flat panels must retain light between their shadowed corners`)
  }
})
