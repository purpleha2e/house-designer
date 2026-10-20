import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { bundleLocalMaterialTextures } from '../scripts/local-material-bundle.mjs'
import { indirectAssetIdentity } from '../src/indirectLightingPersistence.ts'
import type { SurfaceMaterialProduct } from '../src/types.ts'

test('tour bundles contain compressed KTX2 maps, retain lighting identity, and reuse conversions without changing the editable master', async () => {
  const root = resolve('node_modules/.cache')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'material-bundle-test-'))
  const source = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 128, g: 128, b: 255, alpha: 1 } } }).png().toBuffer()
  const hash = createHash('sha256').update(source).digest('hex')
  const original: SurfaceMaterialProduct = {
    id: 'local-material-test', manufacturer: 'My materials', productName: 'Test', category: 'tile',
    pbr: { baseColorTextureUrl: `data:image/png;base64,${source.toString('base64')}`,
      normalTextureUrl: `data:image/png;base64,${source.toString('base64')}`,
      textureSourceHashes: { baseColorTextureUrl: hash, normalTextureUrl: hash }, roughness: .5 },
  }
  const result = await bundleLocalMaterialTextures([original], join(directory, 'public'), join(directory, 'cache'))
  assert.ok(original.pbr.baseColorTextureUrl!.startsWith('data:image/png'))
  assert.ok(result[0].pbr.baseColorTextureUrl!.endsWith('.ktx2'))
  assert.equal(JSON.stringify(result).includes('data:image'), false)
  assert.deepEqual(indirectAssetIdentity(result), indirectAssetIdentity([original]), 'compression must not invalidate baked lighting')
  for (const key of ['baseColorTextureUrl', 'normalTextureUrl'] as const) {
    const path = join(directory, 'public', result[0].pbr[key]!)
    const data = await readFile(path)
    assert.deepEqual(data.subarray(0, 12), Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]))
    assert.ok(data.byteLength > 80)
  }
  const cached = join(directory, 'cache', `${hash}-normal-v1.ktx2`)
  const modified = (await stat(cached)).mtimeMs
  await bundleLocalMaterialTextures([original], join(directory, 'second-public'), join(directory, 'cache'))
  assert.equal((await stat(cached)).mtimeMs, modified)
  await assert.rejects(bundleLocalMaterialTextures([{ ...original, pbr: { ...original.pbr,
    textureSourceHashes: { normalTextureUrl: hash, baseColorTextureUrl: '0'.repeat(64) } } }],
  join(directory, 'invalid'), join(directory, 'cache')), /changed texture source/)
})
