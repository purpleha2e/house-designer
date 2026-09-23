import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPortalCatalog } from '../src/portalCatalog.ts'

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
