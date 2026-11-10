import { build, preview } from 'vite'
import { mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
const out = resolve(process.argv[2] ?? 'tmp/usability-recovery/production'), port = Number(process.argv[3] ?? 5204)
if (existsSync(out) && readdirSync(out).length) throw Error('Choose a fresh production output directory')
mkdirSync(out, { recursive: true })
// Production React/JSX and runtime; preserve function names for read-only
// component observations. No rendering or lighting defines are changed.
await build({ build: { outDir: out, emptyOutDir: false, minify: false, sourcemap: true,
  rollupOptions: { input: { app: resolve('index.html'), editor: resolve('tests/browser/editorRegression.html') } } } })
for (const file of ['colin_house_v2.json', 'springfield_14.json']) copyFileSync(file, resolve(out, file))
const server = await preview({ build: { outDir: out }, preview: { host: '127.0.0.1', port, strictPort: true } })
server.printUrls()
