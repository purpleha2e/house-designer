import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkspaceStore, WorkspaceError, type PrivateAsset, type WorkspaceStore } from './workspace-store.ts'
import { validateLocalMaterial } from '../src/materials/localMaterials.ts'

const prefix = '/api/workspace'
const cookieName = 'hd_workspace_session'
const defaultOrigins = [5173, 4173, 5180].flatMap(port => ['localhost', '127.0.0.1']
  .flatMap(host => [`http://${host}:${port}`, `https://${host}:${port}`]))
const cookieToken = (request: IncomingMessage) => request.headers.cookie?.split(';')
  .map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? ''
const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function body(request: IncomingMessage, limit: number): Promise<Buffer> {
  const length = request.headers['content-length']
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    request.resume(); throw new WorkspaceError(413, 'This file is too large for an upload.')
  }
  return new Promise((resolveBody, reject) => {
    let size = 0, exceeded = false
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (exceeded) return
      if (size > limit) {
        exceeded = true; chunks.length = 0
        reject(new WorkspaceError(413, 'This file is too large for an upload.'))
      } else chunks.push(chunk)
    })
    request.on('end', () => { if (!exceeded) resolveBody(Buffer.concat(chunks)) })
    request.on('error', reject)
    request.on('aborted', () => reject(new WorkspaceError(400, 'The upload was interrupted.')))
  })
}

function parseJson(contents: Buffer): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(contents.toString('utf8'))
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch { /* Return a readable API error below. */ }
  throw new WorkspaceError(400, 'Choose a valid JSON file.')
}

function validateUpload(url: URL, contents: Buffer) {
  const name = url.searchParams.get('name')?.trim() ?? ''
  if (!name || name.length > 160 || name.includes('/') || name.includes('\\') ||
    [...name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new WorkspaceError(400, 'Choose a filename of up to 160 characters without directory names.')
  }
  const kind = url.searchParams.get('kind') as PrivateAsset['kind']
  if (kind === 'material') {
    try { validateLocalMaterial(parseJson(contents)) }
    catch (error) { throw new WorkspaceError(400, error instanceof Error ? error.message : 'Choose a valid material file.') }
  } else if (kind === 'project') {
    const project = parseJson(contents)
    if (!Array.isArray(project.floors) || !project.floors.length || !project.floors.every(floor =>
      floor && typeof floor.id === 'string' && Array.isArray(floor.walls))) throw new WorkspaceError(400, 'Choose a saved House Designer project.')
  } else if (kind === 'object') {
    if (contents.length < 20 || contents.readUInt32LE(0) !== 0x46546c67 || contents.readUInt32LE(4) !== 2 ||
      contents.readUInt32LE(8) !== contents.length) throw new WorkspaceError(400, 'Choose a GLB version 2 object file.')
  } else throw new WorkspaceError(400, 'Choose a material, object or project file.')
  return { name, kind, contentType: kind === 'object' ? 'model/gltf-binary' : 'application/json', contents }
}

/** Loopback-only development service. Hosted sign-in will use a managed
 * identity provider; local development accounts are never production users. */
export async function createWorkspaceService({ directory, quotaBytes, maxUploadBytes = 100 * 1024 * 1024,
  allowedOrigins = defaultOrigins, now = Date.now, sessionMilliseconds, objects, store: suppliedStore,
}: Parameters<typeof createWorkspaceStore>[0] & { maxUploadBytes?: number; allowedOrigins?: string[]; store?: WorkspaceStore }) {
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0 || maxUploadBytes > 250 * 1024 * 1024) throw Error('Invalid upload limit')
  const store = suppliedStore ?? await createWorkspaceStore({ directory, quotaBytes, now, sessionMilliseconds, objects })
  const attempts = new Map<string, { count: number; reset: number }>()
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const path = url.pathname.replace(/\/$/, ''), method = request.method
      if (!path.startsWith(prefix)) throw new WorkspaceError(404, 'This endpoint was not found.')
      if (request.headers.origin && !allowedOrigins.includes(request.headers.origin)) throw new WorkspaceError(403, 'This editor origin is not allowed.')
      if (!['GET', 'HEAD'].includes(method ?? '') && request.headers['x-house-designer-client'] !== 'editor') {
        throw new WorkspaceError(403, 'Use the editor to make this request.')
      }
      if (method === 'GET' && path === `${prefix}/health`) {
        json(response, 200, { ok: true, mode: 'local-development' }); return
      }
      const token = cookieToken(request)
      if (method === 'POST' && [prefix + '/auth/register', prefix + '/auth/login'].includes(path)) {
        const address = request.socket.remoteAddress ?? 'unknown'
        // Only trust the socket address, never a caller-supplied forwarding header.
        for (const [key, entry] of attempts) if (entry.reset <= now()) attempts.delete(key)
        const entry = attempts.get(address) ?? { count: 0, reset: now() + 15 * 60 * 1000 }
        attempts.set(address, entry)
        if (++entry.count > 20) {
          response.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.reset - now()) / 1000))))
          throw new WorkspaceError(429, 'Too many sign-in attempts. Try again later.')
        }
        const input = parseJson(await body(request, 8192))
        const session = path.endsWith('/register') ? await store.register(input) : await store.login(input)
        // A new login replaces this browser's previous session.
        if (token) store.logout(token)
        const secure = allowedOrigins.every(origin => origin.startsWith('https:')) ? '; Secure' : ''
        response.setHeader('Set-Cookie', `${cookieName}=${session.token}; Path=${prefix}; HttpOnly; SameSite=Strict; Max-Age=${Math.floor((session.expiresAt - now()) / 1000)}${secure}`)
        json(response, path.endsWith('/register') ? 201 : 200,
          { user: session.user, workspace: store.workspace(session.user.id), mode: 'local-development', maxUploadBytes })
        return
      }
      if (method === 'POST' && path === `${prefix}/auth/logout`) {
        store.logout(token)
        response.setHeader('Set-Cookie', `${cookieName}=; Path=${prefix}; HttpOnly; SameSite=Strict; Max-Age=0`)
        json(response, 200, { ok: true }); return
      }
      const user = store.session(token)
      if (method === 'GET' && path === `${prefix}/session`) {
        json(response, 200, { user, workspace: user ? store.workspace(user.id) : null, mode: 'local-development', maxUploadBytes }); return
      }
      if (!user) throw new WorkspaceError(401, 'Sign in to use your private workspace.')
      if (method === 'GET' && path === `${prefix}/assets`) {
        json(response, 200, { assets: store.list(user.id), workspace: store.workspace(user.id) }); return
      }
      if (method === 'POST' && path === `${prefix}/assets`) {
        const asset = await store.upload(user.id, validateUpload(url, await body(request, maxUploadBytes)))
        json(response, 201, { asset, workspace: store.workspace(user.id) }); return
      }
      const assetMatch = path.match(/^\/api\/workspace\/assets\/([a-f0-9-]{36})$/)
      if (assetMatch && method === 'GET') {
        const { asset, contents } = await store.download(user.id, assetMatch[1])
        response.writeHead(200, { 'Content-Type': asset.contentType, 'Content-Length': contents.byteLength,
          'Content-Disposition': `attachment; filename="download${asset.kind === 'object' ? '.glb' : '.json'}"; filename*=UTF-8''${encodeURIComponent(asset.name).replace(/'/g, '%27')}` })
        response.end(contents); return
      }
      if (assetMatch && method === 'DELETE') {
        await store.remove(user.id, assetMatch[1])
        json(response, 200, { ok: true, workspace: store.workspace(user.id) }); return
      }
      throw new WorkspaceError(404, 'This endpoint was not found.')
    } catch (error) {
      if (error instanceof WorkspaceError) json(response, error.status, { error: error.message })
      else { console.error('Workspace request failed:', error); json(response, 500, { error: 'The workspace request failed. Please try again.' }) }
    }
  })
  server.requestTimeout = 120_000
  server.headersTimeout = 15_000
  return { server, store }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production') throw Error('This local account service cannot be used for production sign-in. Configure the hosted identity and storage service first.')
  const port = Number(process.env.WORKSPACE_PORT ?? 5175)
  const service = await createWorkspaceService({
    directory: resolve(process.env.WORKSPACE_DATA_DIR ?? '.workspace-data'),
    quotaBytes: Number(process.env.WORKSPACE_QUOTA_BYTES ?? 100 * 1024 * 1024),
    maxUploadBytes: Number(process.env.WORKSPACE_MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024),
    allowedOrigins: process.env.WORKSPACE_ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean),
  })
  service.server.listen(port, '127.0.0.1', () => console.log(`Local account/workspace service: http://127.0.0.1:${port}\nDevelopment accounts and private files stay in ${resolve(process.env.WORKSPACE_DATA_DIR ?? '.workspace-data')}`))
  service.server.once('error', error => { console.error(error.message); service.store.close(); process.exitCode = 1 })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    service.server.close(() => { service.store.close() }); service.server.closeIdleConnections()
  })
}
