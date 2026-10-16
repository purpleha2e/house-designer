// Build the real viewport fixture with production React, then serve it through
// the normal asset-portal proxy. Keep generated files in the disposable cache.
import { build, preview } from 'vite'
const outDir = 'node_modules/.cache/viewport-production'
await build({ build: { outDir, emptyOutDir: true, sourcemap: true, rolldownOptions: { input: 'tests/browser/roofWallRegression.html' } } })
const server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 5184, strictPort: true } })
server.printUrls()
