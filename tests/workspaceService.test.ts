import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createWorkspaceService } from '../server/workspace-service.ts'
import { createLocalWorkspaceObjects } from '../server/workspace-store.ts'

const origin = 'http://editor.example.test'
const password = 'correct horse battery staple'
const project = JSON.stringify({ floors: [{ id: 'ground', walls: [] }] })
const material = JSON.stringify({ id: 'local-material-test', manufacturer: 'My materials',
  category: 'wall-covering', productName: 'Private brick', pbr: { baseColor: '#a53c25', roughness: .7 } })

async function fixture(options: Partial<Parameters<typeof createWorkspaceService>[0]> = {}) {
  const parent = resolve(tmpdir()), directory = await mkdtemp(join(parent, 'house-workspace-test-'))
  let service: Awaited<ReturnType<typeof createWorkspaceService>>
  let base = ''
  const stop = async () => {
    if (!service) return
    service.server.closeIdleConnections()
    await new Promise<void>((resolveClose, reject) => service.server.close(error => error ? reject(error) : resolveClose()))
    service.store.close()
  }
  const start = async () => {
    service = await createWorkspaceService({ directory, allowedOrigins: [origin], ...options })
    await new Promise<void>((resolveListen, reject) => {
      service.server.once('error', reject); service.server.listen(0, '127.0.0.1', resolveListen)
    })
    const address = service.server.address()
    if (!address || typeof address === 'string') throw Error('Missing test server address')
    base = `http://127.0.0.1:${address.port}/api/workspace`
  }
  await start()
  return {
    directory, service: () => service,
    async api(path: string, init: RequestInit = {}, cookie = '') {
      return fetch(`${base}${path}`, { ...init,
        headers: { Origin: origin, 'X-House-Designer-Client': 'editor', ...(cookie ? { Cookie: cookie } : {}), ...init.headers } })
    },
    async register(email = 'alice@example.test') {
      const response = await this.api('/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Alice Example', email, password }) })
      assert.equal(response.status, 201)
      return { cookie: response.headers.get('set-cookie')!.split(';')[0], value: await response.json(), response }
    },
    async upload(cookie: string, contents = project, kind = 'project', name = 'private.house.json') {
      return this.api(`/assets?${new URLSearchParams({ name, kind })}`, { method: 'POST', body: contents }, cookie)
    },
    async restart() { await stop(); await start() },
    async cleanup() {
      await stop()
      assert.equal(dirname(resolve(directory)), parent)
      assert.ok(directory.startsWith(join(parent, 'house-workspace-test-')))
      await rm(directory, { recursive: true, force: true })
    },
  }
}

test('registration creates a persistent private workspace and an HttpOnly server session', async () => {
  const f = await fixture()
  try {
    assert.equal((await (await f.api('/session')).json()).user, null)
    assert.equal((await f.api('/assets')).status, 401)
    const { cookie, value, response } = await f.register(' Alice@Example.test ')
    assert.equal(value.user.email, 'alice@example.test')
    assert.equal(value.workspace.usedBytes, 0)
    assert.equal(value.workspace.quotaBytes, 100 * 1024 * 1024)
    assert.match(response.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/)
    assert.equal(value.token, undefined)
    assert.equal(value.user.password_hash, undefined)
    const upload = await f.upload(cookie)
    assert.equal(upload.status, 201)
    const { asset } = await upload.json()
    await f.restart()
    const persisted = await (await f.api('/session', {}, cookie)).json()
    assert.deepEqual(persisted.user, value.user)
    assert.equal(persisted.workspace.usedBytes, Buffer.byteLength(project))
    const download = await f.api(`/assets/${asset.id}`, {}, cookie)
    assert.equal(await download.text(), project)
    assert.match(download.headers.get('content-disposition')!, /^attachment;/)
    const db = await readFile(join(f.directory, 'workspace.sqlite'))
    assert.equal(db.includes(Buffer.from(password)), false)
    assert.equal(db.includes(Buffer.from(cookie.split('=')[1])), false)
  } finally { await f.cleanup() }
})

test('private material and object bytes are inaccessible to other accounts even with a known asset ID', async () => {
  const f = await fixture()
  try {
    const alice = await f.register(), bob = await f.register('bob@example.test')
    const response = await f.upload(alice.cookie, material, 'material', 'private.material.json')
    assert.equal(response.status, 201)
    const { asset } = await response.json()
    assert.equal(asset.visibility, 'private')
    assert.deepEqual((await (await f.api('/assets', {}, bob.cookie)).json()).assets, [])
    assert.equal((await f.api(`/assets/${asset.id}`, {}, bob.cookie)).status, 404)
    assert.equal((await f.api(`/assets/${asset.id}`, { method: 'DELETE' }, bob.cookie)).status, 404)
    assert.equal((await f.api(`/assets/${asset.id}`)).status, 401)
    assert.equal((await f.api(`/assets/${asset.id}`, {}, alice.cookie)).status, 200)
    const glb = Buffer.alloc(20)
    glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(20, 8)
    const objectUpload = await f.api('/assets?name=object.glb&kind=object', { method: 'POST', body: glb }, alice.cookie)
    assert.equal(objectUpload.status, 201)
    const object = (await objectUpload.json()).asset
    assert.deepEqual(Buffer.from(await (await f.api(`/assets/${object.id}`, {}, alice.cookie)).arrayBuffer()), glb)
    await f.api(`/assets/${asset.id}`, { method: 'DELETE' }, alice.cookie)
    const listing = await (await f.api('/assets', {}, alice.cookie)).json()
    assert.equal(listing.assets.length, 1)
    assert.equal(listing.workspace.usedBytes, glb.byteLength)
  } finally { await f.cleanup() }
})

test('session expiry, failed credentials, duplicate registration and logout are enforced on the service', async () => {
  let time = Date.now()
  const f = await fixture({ now: () => time, sessionMilliseconds: 1000 })
  try {
    const alice = await f.register()
    assert.equal((await f.api('/auth/register', { method: 'POST', body: JSON.stringify({ email: 'alice@example.test', name: 'Again', password }) })).status, 409)
    time += 1001
    assert.equal((await f.api('/assets', {}, alice.cookie)).status, 401)
    const wrong = await f.api('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'alice@example.test', password: 'wrong password' }) })
    const missing = await f.api('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'missing@example.test', password }) })
    assert.equal(wrong.status, 401); assert.deepEqual(await wrong.json(), await missing.json())
    const login = await f.api('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'ALICE@example.test', password }) })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    assert.equal((await f.api('/assets', {}, cookie)).status, 200)
    const logout = await f.api('/auth/logout', { method: 'POST' }, cookie)
    assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/)
    assert.equal((await f.api('/assets', {}, cookie)).status, 401)
  } finally { await f.cleanup() }
})

test('concurrent uploads cannot overrun a workspace allowance and deletion releases its usage', async () => {
  const f = await fixture({ quotaBytes: Buffer.byteLength(project) + 1 })
  try {
    const { cookie } = await f.register()
    const responses = await Promise.all([f.upload(cookie), f.upload(cookie)])
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 413])
    const listing = await (await f.api('/assets', {}, cookie)).json()
    assert.equal(listing.assets.length, 1)
    assert.equal(listing.workspace.usedBytes, Buffer.byteLength(project))
    await f.api(`/assets/${listing.assets[0].id}`, { method: 'DELETE' }, cookie)
    assert.equal((await f.upload(cookie)).status, 201)
  } finally { await f.cleanup() }
})

test('the current Colin house fits the default limits and downloads byte for byte', async () => {
  const f = await fixture()
  try {
    const { cookie } = await f.register()
    const contents = await readFile(new URL('../colin_house_v2.json', import.meta.url))
    const response = await f.api('/assets?name=colin.house.json&kind=project', { method: 'POST', body: contents }, cookie)
    assert.equal(response.status, 201)
    const { asset } = await response.json()
    assert.equal(asset.bytes, contents.length)
    const downloaded = await f.api(`/assets/${asset.id}`, {}, cookie)
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), contents)
  } finally { await f.cleanup() }
})

test('failed object writes release reservations and are never listed as saved files', async () => {
  const f = await fixture({ objects: { put: async () => { throw Error('Injected storage failure') },
    get: async () => new Uint8Array(), delete: async () => {} } })
  try {
    const { cookie } = await f.register()
    const response = await f.upload(cookie)
    assert.equal(response.status, 500)
    assert.equal((await response.text()).includes('Injected'), false)
    const listing = await (await f.api('/assets', {}, cookie)).json()
    assert.deepEqual(listing.assets, [])
    assert.equal(listing.workspace.usedBytes, 0)
  } finally { await f.cleanup() }
})

test('bad origins, forged browser mutations, invalid files, directory names and oversized uploads are rejected', async () => {
  const f = await fixture({ maxUploadBytes: 1024 })
  try {
    const { cookie } = await f.register()
    assert.equal((await f.api('/auth/logout', { method: 'POST', headers: { Origin: 'https://untrusted.example' } }, cookie)).status, 403)
    assert.equal((await f.api('/auth/logout', { method: 'POST', headers: { 'X-House-Designer-Client': '' } }, cookie)).status, 403)
    assert.equal((await f.upload(cookie, material, 'project')).status, 400)
    assert.equal((await f.upload(cookie, project, 'material')).status, 400)
    assert.equal((await f.upload(cookie, 'not a GLB', 'object', 'wrong.glb')).status, 400)
    assert.equal((await f.upload(cookie, project, 'project', '../escape.json')).status, 400)
    assert.equal((await f.upload(cookie, 'x'.repeat(1025))).status, 413)
    assert.equal((await f.upload(cookie, project)).status, 201)
  } finally { await f.cleanup() }
})

test('an interrupted storage operation is cleaned up on restart', async () => {
  // Exercise recovery against real files and database reservations without
  // leaving the HTTP request hanging or terminating the test process.
  const f = await fixture()
  try {
    const { cookie } = await f.register()
    const result = await f.upload(cookie)
    const { asset } = await result.json()
    const objects = createLocalWorkspaceObjects(join(f.directory, 'objects'))
    const workspace = (await (await f.api('/session', {}, cookie)).json()).workspace
    assert.equal(Buffer.from(await objects.get(workspace.id, asset.id)).toString(), project)
    // Simulate a process ending after writing bytes but before marking ready.
    const db = new DatabaseSync(join(f.directory, 'workspace.sqlite'))
    try { db.prepare("UPDATE assets SET state='pending' WHERE id=?").run(asset.id) } finally { db.close() }
    await f.restart()
    const login = await f.api('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'alice@example.test', password }) })
    const restored = await (await f.api('/assets', {}, login.headers.get('set-cookie')!.split(';')[0])).json()
    assert.equal(restored.assets.length, 0)
    assert.equal(restored.workspace.usedBytes, 0)
    await assert.rejects(objects.get(workspace.id, asset.id), { code: 'ENOENT' })
  } finally { await f.cleanup() }
})

test('authentication rate limits survive forwarding-header spoofing and reset after their window', async () => {
  let time = Date.now()
  const f = await fixture({ now: () => time })
  try {
    for (let index = 0; index < 20; index++) {
      const response = await f.api('/auth/register', { method: 'POST', body: '{}', headers: { 'X-Forwarded-For': `192.0.2.${index}` } })
      assert.equal(response.status, 400)
    }
    const blocked = await f.api('/auth/register', { method: 'POST', body: '{}' })
    assert.equal(blocked.status, 429)
    assert.ok(Number(blocked.headers.get('retry-after')) > 0)
    time += 15 * 60 * 1000 + 1
    await f.register()
  } finally { await f.cleanup() }
})

test('a failed cleanup keeps its bytes reserved until recovery succeeds', async () => {
  let failCleanup = true
  let backing: ReturnType<typeof createLocalWorkspaceObjects>
  const f = await fixture({ objects: {
    put: async (workspaceId, assetId, contents) => {
      await backing.put(workspaceId, assetId, contents)
      throw Error('Write acknowledgement failed')
    },
    get: (workspaceId, assetId) => backing.get(workspaceId, assetId),
    delete: async (workspaceId, assetId) => {
      if (failCleanup) throw Error('Storage temporarily unavailable')
      await backing.delete(workspaceId, assetId)
    },
  } })
  try {
    backing = createLocalWorkspaceObjects(join(f.directory, 'objects'))
    const { cookie, value } = await f.register()
    await assert.rejects(f.service().store.upload(value.user.id, {
      name: 'pending.house.json', kind: 'project', contentType: 'application/json', contents: Buffer.from(project),
    }))
    const pending = await (await f.api('/assets', {}, cookie)).json()
    assert.deepEqual(pending.assets, [])
    assert.equal(pending.workspace.usedBytes, Buffer.byteLength(project))
    failCleanup = false
    await f.restart()
    const recovered = await (await f.api('/assets', {}, cookie)).json()
    assert.equal(recovered.workspace.usedBytes, 0)
  } finally { await f.cleanup() }
})
