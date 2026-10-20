import assert from 'node:assert/strict'
import test from 'node:test'
import { collectLocalMaterialDefinitions, validateLocalMaterial } from '../src/materials/localMaterials.ts'
import type { SurfaceMaterialProduct } from '../src/types.ts'

const material = (id: string): SurfaceMaterialProduct => ({
  id: `local-material-${id}`, manufacturer: 'My materials', productName: id, category: 'tile',
  pbr: { baseColor: '#ffffff', roughness: .6, normalStrength: 1.4,
    baseColorTextureUrl: 'data:image/png;base64,aGVsbG8=' },
})

test('portable houses include local materials used by surfaces, roofs and model overrides, excluding unrelated library items', () => {
  const paint = material('paint'), roof = material('roof'), chair = material('chair'), stairs = material('stairs'), unused = material('unused')
  const project = { floors: [{ models: [{ materialOverrides: { seat: chair.id } }], roofs: [{ materialId: roof.id }] }],
    surfaceAssignments: [{ materialId: paint.id }, { materialId: paint.id }],
    modelDefinitions: [{ stairDesign: { finishes: { treads: { materialId: stairs.id } } } }] }
  const saved = collectLocalMaterialDefinitions(project, [unused, roof, paint, chair, stairs])
  assert.deepEqual(saved.map(value => value.id), [chair.id, paint.id, roof.id, stairs.id])
  const restored = JSON.parse(JSON.stringify(saved)) as SurfaceMaterialProduct[]
  restored.forEach(validateLocalMaterial)
  assert.equal(restored[1].pbr.baseColorTextureUrl, paint.pbr.baseColorTextureUrl)
  assert.equal(restored[1].pbr.normalStrength, 1.4)
})

test('local material files reject session URLs and external resources that cannot travel with the house', () => {
  for (const url of ['blob:http://localhost/temporary', 'http://localhost:5174/private.png', '/local/path.png', 'data:image/svg+xml;base64,aGVsbG8=']) {
    assert.throws(() => validateLocalMaterial({ ...material('test'), pbr: { normalTextureUrl: url } }), /image data/)
  }
  assert.throws(() => validateLocalMaterial({ ...material('test'), pbr: { normalStrength: NaN } }), /setting/)
})
