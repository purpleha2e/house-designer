import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createPublicMaterialUpload } from '../src/materials/materialTransfer.ts'
import { getMaterialCatalogueFolder } from '../src/materials/materialCatalogueLayout.ts'
import { createRuntimePortalCatalog } from '../src/portalCatalog.ts'
import { portalRequest } from '../src/assetPortalClient.ts'

test('public material writes report a missing route as an outdated asset portal', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Not found' }, { status: 404 }))
  await assert.rejects(portalRequest('/api/portal/material-catalogue', { method: 'PATCH' }), /Restart the asset portal/)
  await assert.rejects(portalRequest('/api/portal/materials/publish', { method: 'POST' }), /Restart the asset portal/)
  await assert.rejects(portalRequest('/api/portal/materials/dulux-timeless-matt', { method: 'PATCH' }), /Restart the asset portal/)
  await assert.rejects(portalRequest('/api/portal/assets/example'), /Not found/)
})

test('public catalogue mutations require admin approval and preserve model records', { timeout: 30000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'hd-catalogue-'))
  const password = 'catalogue-test-password'
  const portal = spawn(process.execPath, [fileURLToPath(new URL('../server/asset-portal.mjs', import.meta.url))], {
    env: { ...process.env, ASSET_PORTAL_PORT: '0', ASSET_PORTAL_STORAGE_DIR: directory, ASSET_PORTAL_ADMIN_PASSWORD: password, NODE_ENV: 'production' },
    windowsHide: true,
  })
  t.after(async () => {
    if (portal.exitCode === null && portal.signalCode === null && portal.pid !== undefined) {
      const closed = once(portal, 'close')
      portal.kill()
      await closed
    }
    assert.equal(dirname(directory), tmpdir())
    await rm(directory, { recursive: true, force: true })
  })
  const port = await new Promise<string>((resolve, reject) => {
    portal.once('error', reject)
    portal.once('exit', code => reject(new Error(`Asset portal exited with code ${code}`)))
    portal.stdout.setEncoding('utf8')
    portal.stdout.on('data', (chunk: string) => {
      const match = /listening on http:\/\/localhost:(\d+)/.exec(chunk)
      if (match) resolve(match[1])
    })
  })
  const request = (path: string, options: RequestInit = {}) => fetch(`http://127.0.0.1:${port}/api/portal/${path}`,
    { ...options, signal: AbortSignal.timeout(5000) })
  const json = (path: string, body: unknown, token?: string, method = 'POST') => request(path, { method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) })
  const owner = { name: 'Test fixtures', email: 'owner@example.invalid', password: 'supplier-test-password' }
  assert.equal((await json('signup', owner)).status, 201)
  const supplier = await (await json('login', owner)).json()
  assert.equal((await json('login', { email: 'admin@housedesigner.local', password: 'admin' })).status, 401)
  const login = await json('login', { email: 'admin@housedesigner.local', password })
  assert.equal(login.status, 200)
  const admin = await login.json()
  const change = (id: string, entry: object, token?: string) => json('catalogue-layout', { id, entry }, token, 'PATCH')
  assert.equal((await change('sofa', { folder: 'Furniture/Seating' })).status, 401)
  assert.equal((await change('sofa', { removed: true }, supplier.token)).status, 403)
  assert.equal((await change('sofa', { folder: ' Furniture / Seating ' }, admin.token)).status, 200)
  assert.equal((await change('sofa', { removed: true }, admin.token)).status, 200)
  const restored = await change('sofa', { removed: false }, admin.token)
  assert.deepEqual((await restored.json()).entry, { folder: 'Furniture/Seating', removed: false })
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'catalogue-layout.json'), 'utf8')).sofa,
    { folder: 'Furniture/Seating', removed: false })

  const form = new FormData()
  form.set('assetKind', 'material')
  form.set('productName', 'Test matte')
  form.set('baseColor', '#ccddee')
  const uploaded = await request('assets', { method: 'POST', body: form, headers: { authorization: `Bearer ${supplier.token}` } })
  assert.equal(uploaded.status, 201)
  const { asset } = await uploaded.json()
  const appearsInCatalogue = async () => {
    const catalogue = await (await request('catalog')).json()
    return catalogue.manufacturers.some((group: { assets: { id: string }[] }) => group.assets.some(item => item.id === asset.id))
  }
  assert.equal(await appearsInCatalogue(), false)
  assert.equal((await change(`portal-material-${asset.id}`, { published: true }, supplier.token)).status, 403)
  assert.equal((await change(`portal-material-${asset.id}`, { published: true }, admin.token)).status, 200)
  assert.equal(await appearsInCatalogue(), true)
  const protectedPath = `assets/${asset.manufacturer.slug}/materials/${asset.id}`
  const authorization = `Bearer ${supplier.token}`
  assert.equal((await request(protectedPath, { method: 'PATCH', headers: { authorization }, body: form })).status, 403)
  assert.equal((await request(protectedPath, { method: 'DELETE', headers: { authorization } })).status, 403)
  assert.equal(await appearsInCatalogue(), true)

  const workingCopy = { id: 'local-material-sample', productName: 'Personal paint', manufacturer: 'My materials', category: 'paint' as const,
    pbr: { baseColor: '#ab9876', roughness: .25, normalStrength: 1.5, normalFlipY: true, rotation: 90,
      displacementScale: .012, repeatX: 2, realWorldWidthMeters: 1.4 } }
  const publishing = await createPublicMaterialUpload(workingCopy, {
    name: 'Published paint', brand: ' Test  Brand ', collection: 'Test collection',
    category: 'Heritage finishes', materialType: 'Decorative paint',
  })
  publishing.set('catalogueFolder', 'Samples/Imported')
  const publish = (token?: string) => request('materials/publish', { method: 'POST', body: publishing,
    headers: token ? { authorization: `Bearer ${token}` } : undefined })
  assert.equal((await publish()).status, 401)
  assert.equal((await publish(supplier.token)).status, 403)
  const published = await publish(admin.token)
  assert.equal(published.status, 201)
  const { asset: publicCopy } = await published.json()
  const catalogue = createRuntimePortalCatalog(await (await request('catalog')).json())
  const material = catalogue.materials.find(candidate => candidate.id === `portal-material-${publicCopy.id}`)!
  assert.equal(material.productName, 'Published paint')
  assert.equal(workingCopy.productName, 'Personal paint')
  assert.equal(material.manufacturer, 'Test Brand')
  assert.equal(publicCopy.manufacturer.name, 'House Designer')
  assert.equal(publicCopy.category, 'Heritage finishes')
  assert.equal(material.catalogueCategory, 'Heritage finishes')
  assert.equal(material.category, 'paint')
  assert.equal(material.collection, 'Test collection')
  assert.equal(material.materialType, 'Decorative paint')
  assert.equal(material.catalogueFolder, 'Samples/Imported')
  for (const key of Object.keys(workingCopy.pbr) as Array<keyof typeof workingCopy.pbr>) {
    assert.equal(material.pbr[key], workingCopy.pbr[key])
  }
  assert.equal(catalogue.materials.find(candidate => candidate.id === `portal-material-${asset.id}`)?.pbr.baseColor, '#ccddee')

  const editMaterials = (body: unknown, token?: string) => json('material-catalogue', body, token, 'PATCH')
  const createFolder = { action: 'create-folder', path: 'New arrivals' }
  assert.equal((await editMaterials(createFolder)).status, 401)
  assert.equal((await editMaterials(createFolder, supplier.token)).status, 403)
  assert.equal((await editMaterials(createFolder, admin.token)).status, 200)
  const moveFolder = { action: 'move-folder', from: 'Samples', to: 'New arrivals/Samples' }
  assert.equal((await editMaterials(moveFolder, admin.token)).status, 200)
  const moveBundled = { action: 'move-material', id: 'dulux-timeless-matt', folder: 'New arrivals' }
  assert.equal((await editMaterials(moveBundled, admin.token)).status, 200)
  const deleteFolder = { action: 'delete-folder', path: 'New arrivals/Samples' }
  assert.equal((await editMaterials(deleteFolder, admin.token)).status, 400)
  const remove = { action: 'set-removed', id: material.id, removed: true }
  assert.equal((await editMaterials(remove, admin.token)).status, 200)
  assert.equal((await editMaterials(deleteFolder, admin.token)).status, 200)
  const updated = createRuntimePortalCatalog(await (await request('catalog')).json())
  assert.deepEqual(updated.materialCatalogue?.entries[material.id], { folder: 'New arrivals/Samples/Imported', removed: true })
  assert.equal(updated.materials.find(candidate => candidate.id === material.id)?.pbr.baseColor, workingCopy.pbr.baseColor)
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'material-catalogue.json'), 'utf8')).entries, updated.materialCatalogue?.entries)
  assert.equal((await editMaterials({ ...remove, removed: false }, admin.token)).status, 200)
  const restoredCatalogue = createRuntimePortalCatalog(await (await request('catalog')).json())
  assert.equal(getMaterialCatalogueFolder(material, restoredCatalogue.materialCatalogue!), 'New arrivals/Samples/Imported')
  assert.equal(restoredCatalogue.materialCatalogue?.entries[material.id]?.removed, undefined)

  const editMaterial = (id: string, body: FormData, token?: string) => request(`materials/${id}`, { method: 'PATCH', body,
    headers: token ? { authorization: `Bearer ${token}` } : undefined })
  const editedDetails = { name: 'Renamed paint', brand: 'New Brand', category: 'Heritage finishes', collection: 'New collection', materialType: 'Matt paint' }
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#8181ff' } }).png().toBuffer()
  const normal = `data:image/png;base64,${image.toString('base64')}`
  const appearance = { ...material, pbr: { ...material.pbr, roughness: .72, normalTextureUrl: normal } }
  const edit = await createPublicMaterialUpload(appearance, editedDetails, material)
  assert.equal((await editMaterial(material.id, edit)).status, 401)
  assert.equal((await editMaterial(material.id, edit, supplier.token)).status, 403)
  const editResponse = await editMaterial(material.id, edit, admin.token)
  assert.equal(editResponse.status, 200)
  const { material: edited } = await editResponse.json()
  assert.equal(edited.id, material.id)
  assert.equal(edited.productName, editedDetails.name)
  assert.equal(edited.manufacturer, editedDetails.brand)
  assert.equal(edited.pbr.roughness, .72)
  assert.equal(edited.pbr.rotation, 90)
  assert.match(edited.pbr.normalTextureUrl, /normal-[a-f0-9]+\.ktx2$/)
  const readAsset = async (path: string) => fetch(`http://127.0.0.1:${port}${path}`)
  assert.deepEqual(Buffer.from(await (await readAsset(edited.originalTextureUrls.normalTextureUrl)).arrayBuffer()), image)

  const unchangedMaps = await createPublicMaterialUpload(edited, { ...editedDetails, name: 'Edited again' }, edited)
  assert.equal(unchangedMaps.has('normal'), false)
  const renamed = await (await editMaterial(material.id, unchangedMaps, admin.token)).json()
  assert.equal(renamed.material.pbr.normalTextureUrl, edited.pbr.normalTextureUrl)
  const invalidImage = await createPublicMaterialUpload(edited, { ...editedDetails, name: 'Failed change' }, edited)
  invalidImage.set('normal', new Blob(['invalid image'], { type: 'image/png' }), 'invalid.png')
  assert.equal((await editMaterial(material.id, invalidImage, admin.token)).status, 400)
  const afterFailure = createRuntimePortalCatalog(await (await request('catalog')).json()).materials.find(candidate => candidate.id === material.id)!
  assert.equal(afterFailure.productName, 'Edited again')
  assert.equal(afterFailure.pbr.normalTextureUrl, edited.pbr.normalTextureUrl)
  const removeTexture = await createPublicMaterialUpload({ ...edited, pbr: { ...edited.pbr, normalTextureUrl: undefined } }, editedDetails, edited)
  assert.equal(removeTexture.get('removeMaps'), 'normal')
  const cleared = await (await editMaterial(material.id, removeTexture, admin.token)).json()
  assert.equal(cleared.material.pbr.normalTextureUrl, undefined)
  assert.equal((await readAsset(edited.pbr.normalTextureUrl)).status, 200, 'earlier texture URLs still resolve')

  const bundledId = 'dulux-timeless-matt'
  const bundled = JSON.parse(await readFile(fileURLToPath(new URL(`../src/materials/catalog/${bundledId}.json`, import.meta.url)), 'utf8'))
  const bundledBody = await createPublicMaterialUpload({ ...bundled, pbr: { ...bundled.pbr, baseColor: '#aabbcc' } }, editedDetails, bundled)
  const bundleResponse = await editMaterial(bundledId, bundledBody, admin.token)
  assert.equal(bundleResponse.status, 200)
  const updatedCatalogue = createRuntimePortalCatalog(await (await request('catalog')).json())
  const shared = updatedCatalogue.materials.find(candidate => candidate.id === material.id)!
  assert.equal(shared.pbr.roughness, .72)
  assert.equal(getMaterialCatalogueFolder(shared, updatedCatalogue.materialCatalogue!), 'New arrivals/Samples/Imported')
  const bundledEdit = updatedCatalogue.materials.find(candidate => candidate.id === bundledId)!
  assert.equal(bundledEdit.pbr.baseColor, '#aabbcc')
  assert.equal(getMaterialCatalogueFolder(bundledEdit, updatedCatalogue.materialCatalogue!), 'New arrivals')
})
