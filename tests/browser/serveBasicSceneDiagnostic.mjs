// Production React / bundled workers; retain the normal model-asset proxy.
// Run: node tests/browser/serveBasicSceneDiagnostic.mjs
import { createReadStream } from 'node:fs'
import { build, preview } from 'vite'
const outDir = 'node_modules/.cache/basic-scene-production'
await build({ build: { outDir, emptyOutDir: true,
  rolldownOptions: { input: 'tests/browser/basicSceneDiagnostic.html' } } })
if (!process.argv.includes('--build-only')) {
const server = await preview({ build: { outDir },
  plugins: [{ name: 'diagnostic-project', configurePreviewServer(server) {
    server.middlewares.use('/colin_house_v2.json', (_request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-store')
      createReadStream(new URL('../../colin_house_v2.json', import.meta.url)).pipe(response)
    })
  } }],
  preview: { host: '127.0.0.1', port: 5185, strictPort: true } })
server.printUrls()
}
