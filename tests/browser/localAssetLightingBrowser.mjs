import { readFile, readdir } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { lightingBrowser } from './lightingHarness.mjs'

/** Read-only assets for isolated rendering tests, without the management server. */
export async function localAssetLightingBrowser() {
  const root = resolve('manufacturer-assets'), errors = []
  const folders = await readdir(resolve(root, 'house-designer/materials'))
  const assets = await Promise.all(folders.map(folder => readFile(resolve(root, 'house-designer/materials', folder, 'metadata.json'), 'utf8').then(JSON.parse)))
  const catalog = Buffer.from(JSON.stringify({ manufacturers: [{ assets }] })).toString('base64')
  let browser
  browser = await lightingBrowser({ onEvent: event => {
    if (event.method !== 'Fetch.requestPaused') return
    void (async () => {
      const { requestId, request } = event.params
      try {
        if (request.method !== 'GET') throw Error('Only read-only asset requests are permitted')
        const url = new URL(request.url)
        let body = catalog, type = 'application/json'
        if (url.pathname !== '/api/portal/catalog') {
          const path = resolve(root, decodeURIComponent(url.pathname.slice('/manufacturer-assets/'.length)))
          if (!path.startsWith(root + sep)) throw Error('Asset path is outside the asset directory')
          body = (await readFile(path)).toString('base64')
          type = ({ '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.ktx2': 'image/ktx2' })[extname(path)] ?? 'application/octet-stream'
        }
        await browser.call('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: type }], body })
      } catch (error) { errors.push(String(error)); await browser.call('Fetch.failRequest', { requestId, errorReason: 'Failed' }) }
    })()
  } })
  await browser.call('Fetch.enable', { patterns: [{ urlPattern: '*/manufacturer-assets/*', requestStage: 'Request' }, { urlPattern: '*/api/portal/catalog', requestStage: 'Request' }] })
  return Object.assign(browser, { assetErrors: errors })
}
