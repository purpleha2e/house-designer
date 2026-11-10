// Same Vite app configuration as the established audit; ignore retained evidence
// so writing large profiles/build snapshots cannot trigger development reloads.
import { createServer } from 'vite'
const server = await createServer({ server: { host: '127.0.0.1', port: Number(process.argv[2] ?? 5202),
  strictPort: true, watch: { ignored: ['**/tmp/**', '**/docs/renderer-phase4/**'] } } })
await server.listen()
server.printUrls()
