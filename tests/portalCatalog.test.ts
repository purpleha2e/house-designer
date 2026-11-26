import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPortalCatalog, createRuntimePortalCatalog } from '../src/portalCatalog.ts'
import { getModelLibrarySection, matchesModelTags, normalizeModelTag } from '../src/models/modelLibrarySections.ts'

test('tagged slots become editable regions for furniture, doors, windows and stairs', () => {
  const names=['hd_frame','hd_drawer_fronts','original_fixed_finish']
  const catalog=createRuntimePortalCatalog({manufacturers:[{assets:['furniture','interior-door','window','stairs'].map((objectType,i)=>({
    assetKind:'model' as const, id:String(i), category:'',collection:'',manufacturer:{name:'Test',slug:'test'},
    files:[{fieldName:'model',url:'/bed.glb'}],metadata:{objectType},materialNames:names,
  }))}]})
  for(const model of catalog.models)assert.deepEqual(model.materialRegions,[
    {id:'hd_frame',label:'Frame',sourceMaterialNames:['hd_frame']},
    {id:'hd_drawer_fronts',label:'Drawer fronts',sourceMaterialNames:['hd_drawer_fronts']},
  ])
  assert.equal(catalog.materials.length,0,'slot names do not create fake catalogue products')
})

test('portal catalogue carries explicit door leaf counts and ignores invalid counts', async context => {
  const originalFetch = globalThis.fetch
  context.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = (async () => new Response(JSON.stringify({
    manufacturers: [{ assets: ['1', '2', '', '3'].map((doorLeafCount, index) => ({
      id: `door-${index}`, assetKind: 'model', category: 'Doors',
      files: [{ fieldName: 'model', url: '/door.glb' }],
      metadata: { objectType: 'interior-door', doorLeafCount },
    })) }],
  }), { headers: { 'content-type': 'application/json' } })) as typeof fetch
  const catalog = await loadPortalCatalog()
  assert.deepEqual(catalog.models.map(model => model.doorLeafCount), [1, 2, undefined, undefined])
})

test('model filters combine authored portal tags with model names and types', () => {
  const catalog = createRuntimePortalCatalog({ manufacturers: [{ assets: [{
    assetKind: 'model', id: 'side-table', category: 'Furniture', collection: '', manufacturer: { name: 'Test', slug: 'test' },
    files: [{ fieldName: 'model', url: '/side-table.glb' }],
    metadata: { productName: 'Penny Side Table', tags: ' Scandinavian , pale-oak,,', objectType: 'furniture' },
  }] }] })
  const [model] = catalog.models
  assert.deepEqual(model.tags, ['Scandinavian', 'pale-oak'])
  assert.equal(matchesModelTags(model, ['SIDE TABLE', 'pale Oak', 'furniture'].map(normalizeModelTag)), true)
  assert.equal(matchesModelTags(model, ['scandinavian', 'farmhouse']), false)
})

test('a portal model can mount on walls and remain a decoration in the object library', () => {
  const catalog = createRuntimePortalCatalog({ manufacturers: [{ assets: [{
    assetKind: 'model', id: 'frame', category: '', collection: '', manufacturer: { name: 'Test', slug: 'test' },
    files: [{ fieldName: 'model', url: '/frame.glb' }],
    metadata: { productName: 'Picture frame', objectType: 'decor', placement: 'wall-mounted' },
  }] }] })
  assert.equal(catalog.models[0].placement, 'wall-mounted')
  assert.equal(catalog.models[0].wallMount, undefined)
  assert.equal(getModelLibrarySection(catalog.models[0]), 'objects')
})

test('an uploaded light fixture can use ceiling placement', () => {
  const catalog = createRuntimePortalCatalog({ manufacturers: [{ assets: [{
    assetKind: 'model', id: 'pendant', category: '', collection: '', manufacturer: { name: 'Test', slug: 'test' },
    files: [{ fieldName: 'model', url: '/pendant.glb' }],
    metadata: { productName: 'Pendant', objectType: 'lighting', placement: 'ceiling-mounted' },
  }] }] })
  assert.equal(catalog.models[0].placement, 'ceiling-mounted')
  assert.equal(getModelLibrarySection(catalog.models[0]), 'objects')
})

test('portal catalogue loading retries a transient startup failure', async (context) => {
  const originalFetch = globalThis.fetch
  let requestCount = 0

  context.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = (async () => {
    requestCount += 1

    if (requestCount === 1) {
      throw new TypeError('portal connection refused')
    }

    return new Response(JSON.stringify({ manufacturers: [] }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    })
  }) as typeof fetch

  const catalog = await loadPortalCatalog()

  assert.equal(requestCount, 2)
  assert.deepEqual(catalog, { materials: [], models: [] })
})

test('portal catalogue maps the material image-based-lighting flag', async (context) => {
  const originalFetch = globalThis.fetch

  context.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({
      manufacturers: [{
        assets: [{
          assetKind: 'material',
          category: 'Flooring',
          collection: '',
          conversion: { status: 'complete' },
          files: [],
          id: 'oak-floor',
          manufacturer: { name: 'House Designer', slug: 'house-designer' },
          metadata: {
            baseColor: '#ffffff',
            imageBasedLighting: 'true',
            productName: 'Oak floor',
          },
          processedFiles: [],
        }],
      }],
    }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    })) as typeof fetch

  const catalog = await loadPortalCatalog()

  assert.equal(catalog.materials[0].pbr.imageBasedLighting, true)
})
