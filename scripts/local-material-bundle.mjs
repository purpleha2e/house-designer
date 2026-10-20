import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { convertMaterialTextureToKtx2 } from '../server/material-conversion-worker.mjs'
import { materialMapSlots, validateLocalMaterial } from '../src/materials/localMaterials.ts'

const signature = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])

/** Reuse the established KTX2 encoder; never put editable source images in the tour. */
export async function bundleLocalMaterialTextures(materials, publicDir, cacheDir) {
  const bundled = structuredClone(materials)
  if (!bundled.length) return bundled
  await mkdir(cacheDir, { recursive: true })
  await mkdir(join(publicDir, 'local-materials'), { recursive: true })
  for (const material of bundled) {
    validateLocalMaterial(material)
    for (const { key } of materialMapSlots) {
      const url = material.pbr[key]
      if (!url) continue
      const bytes = Buffer.from(url.split(',')[1], 'base64')
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (material.pbr.textureSourceHashes?.[key] !== hash) {
        throw new Error(`Material "${material.productName}" has missing or changed texture source data. Import and save it again in the material editor before publishing.`)
      }
      const field = key.replace('TextureUrl', '')
      const name = `${hash}-${field}-v1.ktx2`, path = join(cacheDir, name)
      let data = await readFile(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (!data || !data.subarray(0, 12).equals(signature)) {
        const source = join(cacheDir, `${hash}.png`), temporary = `${path}.tmp`
        await writeFile(source, bytes)
        await convertMaterialTextureToKtx2(source, temporary, field)
        await rename(temporary, path)
        data = await readFile(path)
      }
      await writeFile(join(publicDir, 'local-materials', name), data)
      material.pbr[key] = `./local-materials/${name}`
    }
  }
  return bundled
}
