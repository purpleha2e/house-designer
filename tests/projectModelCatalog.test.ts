import assert from 'node:assert/strict'
import test from 'node:test'
import { retainProjectModels } from '../src/models/projectModelCatalog.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'
import type { FloorLevel } from '../src/types.ts'

const definition = (id: string): ModelDefinition => ({ id, name: id, category: 'Stairs',
  color: '#64748b', shape: 'box', width: 1, depth: 2, height: 2.4, sourceUrl: `/${id}.glb` })
const floors = (...ids: string[]) => [{ models: ids.map(modelId => ({ modelId })) }] as Pick<FloorLevel, 'models'>[]

test('refreshing an empty catalogue retains saved definitions used by the current house', () => {
  const stairs = definition('portal-model-original-stairs')
  const stale = definition('portal-model-unused')
  const builtIn = definition('sofa')
  const registry = new Map([stairs, stale, builtIn].map(model => [model.id, model]))
  assert.deepEqual(retainProjectModels([], floors(stairs.id, stairs.id, builtIn.id), registry), [stairs])
  assert.equal(registry.size, 3, 'The registry must not be mutated during collection')
})

test('current catalogue definitions win and absent assets are not invented', () => {
  const previous = definition('portal-model-stairs')
  const updated = { ...previous, name: 'Updated stairs', height: 2.6 }
  const catalog = [updated, definition('portal-model-new')]
  assert.deepEqual(retainProjectModels(catalog, floors(previous.id, 'portal-model-missing'),
    new Map([[previous.id, previous]])), catalog)
  assert.equal(previous.height, 2.4)
})

test('loading a different house does not preserve unused missing uploads', () => {
  const previous = definition('portal-model-old-house')
  assert.deepEqual(retainProjectModels([], floors('portal-model-other-house'), new Map([[previous.id, previous]])), [])
})

test('background catalogue hydration preserves placed definitions from the loaded house', () => {
  const saved = definition('portal-model-stairs')
  const catalog = [{ ...saved, height: 2.6 }, definition('portal-model-unused')]
  const result = retainProjectModels(catalog, floors(saved.id), new Map([[saved.id, saved]]), true)
  assert.equal(result[0], saved)
  assert.equal(result[1], catalog[1], 'unplaced catalogue entries still become available')
})

test('older saved definitions gain discovered slots only for the same source asset', () => {
  const saved=definition('portal-model-bed')
  const regions=[{id:'hd_frame',label:'Frame',sourceMaterialNames:['hd_frame']}]
  const catalog=[{...saved,height:3,materialRegions:regions}]
  const enrich=(source:ModelDefinition)=>retainProjectModels(catalog,floors(saved.id),new Map([[saved.id,source]]),true)[0]
  assert.deepEqual(enrich(saved),{...saved,materialRegions:regions})
  const previous={...saved,sourceUrl:'/older.glb'}
  assert.equal(enrich(previous),previous)
  const authored={...saved,materialRegions:[]}
  assert.equal(enrich(authored),authored,'explicit saved slot metadata is authoritative')
})
