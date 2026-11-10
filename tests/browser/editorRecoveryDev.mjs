// Serve the real app with an immutable pre-correction source overlay when
// requested. Never changes the working tree or rewrites authored projects.
import { createServer } from 'vite'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
const [mode = 'current', port = '5203'] = process.argv.slice(2)
const originals = new Map([
  'src/App.tsx', 'src/components/ThreeDView.tsx', 'src/components/SceneRenderer.tsx',
  'src/components/SoftFloorGI.tsx', 'src/indirectVisibility.ts', 'src/opaqueViewportScene.ts',
  'src/materials/localMaterials.ts', 'src/projectViewState.ts',
].map(path => [resolve(path).replaceAll('\\', '/'), resolve('tmp/usability-recovery/before-source', path.split('/').at(-1))]))
if (mode === 'before') for (const file of originals.values()) if (!existsSync(file)) throw Error(`Missing frozen source: ${file}`)
const server = await createServer({ plugins: mode !== 'before' ? [] : [{ name: 'recovery-baseline', enforce: 'pre',
  load(id) { const file = originals.get(id.split('?')[0]); if (file) return readFileSync(file, 'utf8') },
}], server: { host: '127.0.0.1', port: Number(port), strictPort: true,
  watch: { ignored: ['**/tmp/**', '**/docs/**'] } } })
await server.listen(); server.printUrls()
