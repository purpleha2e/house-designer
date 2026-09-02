import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, extname, join, normalize, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'

const PORT = Number(process.env.ASSET_PORTAL_PORT ?? 5174)
const ROOT_DIR = resolve(import.meta.dirname, '..')
const STORAGE_DIR = resolve(ROOT_DIR, 'manufacturer-assets')
const DB_PATH = join(STORAGE_DIR, 'portal-db.json')
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024
const HOUSE_DESIGNER_MANUFACTURER_NAME = 'House Designer'
const HOUSE_DESIGNER_MANUFACTURER_SLUG = 'house-designer'
const LEGACY_ADMIN_MANUFACTURER_SLUG = 'house-designer-admin'
const modelDimensionIo = new NodeIO().registerExtensions(ALL_EXTENSIONS)

const sessions = new Map()
const processingJobs = new Set()

function createId() {
  return randomBytes(16).toString('hex')
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = createHash('sha256').update(`${salt}:${password}`).digest('hex')
  return { hash, salt }
}

function verifyPassword(password, user) {
  return hashPassword(password, user.passwordSalt).hash === user.passwordHash
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function ensureDb() {
  await mkdir(STORAGE_DIR, { recursive: true })

  if (await pathExists(DB_PATH)) {
    return
  }

  const { hash, salt } = hashPassword('admin')
  const db = {
    manufacturers: [],
    users: [
      {
        email: 'admin@housedesigner.local',
        id: createId(),
        manufacturerId: null,
        name: HOUSE_DESIGNER_MANUFACTURER_NAME,
        passwordHash: hash,
        passwordSalt: salt,
        role: 'admin',
      },
    ],
  }

  await writeJson(DB_PATH, db)
}

async function readJson(path, fallback) {
  try {
    return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
  } catch {
    return fallback
  }
}

async function writeJson(path, data) {
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function readDb() {
  await ensureDb()
  const db = await readJson(DB_PATH, { manufacturers: [], users: [] })
  let changed = false

  for (const user of db.users) {
    if (user.role === 'admin' && user.name === 'HouseDesigner Admin') {
      user.name = HOUSE_DESIGNER_MANUFACTURER_NAME
      changed = true
    }
  }

  for (const manufacturer of db.manufacturers) {
    if (manufacturer.slug === LEGACY_ADMIN_MANUFACTURER_SLUG) {
      manufacturer.name = HOUSE_DESIGNER_MANUFACTURER_NAME
      manufacturer.slug = HOUSE_DESIGNER_MANUFACTURER_SLUG
      changed = true
    }
  }

  if (changed) {
    await migrateHouseDesignerStorage()
    await writeDb(db)
  }

  return db
}

async function writeDb(db) {
  await writeJson(DB_PATH, db)
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(data))
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message })
}

async function readRequestBody(request) {
  const chunks = []
  let size = 0

  for await (const chunk of request) {
    size += chunk.length

    if (size > MAX_UPLOAD_BYTES) {
      throw new Error('Upload is too large')
    }

    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

async function readJsonBody(request) {
  const body = await readRequestBody(request)
  return body.length > 0 ? JSON.parse(body.toString('utf8')) : {}
}

function parseMultipart(request, body) {
  const contentType = request.headers['content-type'] ?? ''
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)

  if (!boundaryMatch) {
    throw new Error('Missing multipart boundary')
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] ?? boundaryMatch[2]}`)
  const fields = {}
  const files = []
  let cursor = body.indexOf(boundary)

  while (cursor >= 0) {
    cursor += boundary.length

    if (body.slice(cursor, cursor + 2).toString() === '--') {
      break
    }

    if (body.slice(cursor, cursor + 2).toString() === '\r\n') {
      cursor += 2
    }

    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor)

    if (headerEnd < 0) {
      break
    }

    const rawHeaders = body.slice(cursor, headerEnd).toString('utf8')
    const disposition =
      /content-disposition:\s*form-data;([^\r\n]+)/i.exec(rawHeaders)?.[1] ?? ''
    const name = /name="([^"]+)"/i.exec(disposition)?.[1]
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1]
    const contentTypeHeader =
      /content-type:\s*([^\r\n]+)/i.exec(rawHeaders)?.[1]?.trim() ??
      'application/octet-stream'
    const dataStart = headerEnd + 4
    let nextBoundary = body.indexOf(boundary, dataStart)

    if (nextBoundary < 0) {
      nextBoundary = body.length
    }

    const dataEnd =
      nextBoundary >= 2 && body.slice(nextBoundary - 2, nextBoundary).toString() ===
        '\r\n'
        ? nextBoundary - 2
        : nextBoundary
    const data = body.slice(dataStart, dataEnd)

    if (name && filename) {
      files.push({
        contentType: contentTypeHeader,
        data,
        filename: basename(filename),
        fieldName: name,
      })
    } else if (name) {
      fields[name] = data.toString('utf8')
    }

    cursor = nextBoundary
  }

  return { fields, files }
}

function getBearerToken(request) {
  const authorization = request.headers.authorization ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(authorization)
  return match?.[1] ?? null
}

async function getCurrentUser(request) {
  const token = getBearerToken(request)

  if (!token) {
    return null
  }

  const session = sessions.get(token)

  if (!session) {
    return null
  }

  const db = await readDb()
  const user = db.users.find((candidate) => candidate.id === session.userId)

  return user ? { db, user } : null
}

function safeStoragePath(...segments) {
  const target = normalize(resolve(STORAGE_DIR, ...segments))

  if (relative(STORAGE_DIR, target).startsWith('..')) {
    throw new Error('Invalid storage path')
  }

  return target
}

function getStoredModelFileName(metadata) {
  return metadata.files
    ?.find((file) => file.fieldName === 'model')
    ?.url.split('/')
    .pop()
}

function isProcessableModelFileName(fileName) {
  return ['.glb', '.gltf'].includes(extname(fileName ?? '').toLowerCase())
}

function hasProcessedModelFile(metadata) {
  return Boolean(
    metadata.processedFiles?.some(
      (file) => file.fieldName === 'model' && file.url.includes('/processed/'),
    ),
  )
}

async function listAssetsForManufacturer(manufacturer) {
  const assetKinds = ['materials', 'models']
  const assets = []

  for (const kind of assetKinds) {
    const root = safeStoragePath(manufacturer.slug, kind)

    if (!(await pathExists(root))) {
      continue
    }

    const assetDirs = await readdir(root, { withFileTypes: true })

    for (const assetDir of assetDirs) {
      if (!assetDir.isDirectory()) {
        continue
      }

      const metadataPath = join(root, assetDir.name, 'metadata.json')
      const metadata = await readJson(metadataPath, null)

      if (metadata) {
        if (metadata.assetKind === 'model') {
          const modelFileName = getStoredModelFileName(metadata)

          if (
            modelFileName &&
            (!metadata.inferredDimensions ||
              !Number.isFinite(metadata.inferredDimensions.minX) ||
              !Number.isFinite(metadata.inferredDimensions.maxX) ||
              !Number.isFinite(metadata.inferredDimensions.minZ) ||
              !Number.isFinite(metadata.inferredDimensions.maxZ))
          ) {
            const inferredDimensions = await inferModelDimensions(
              join(root, assetDir.name, modelFileName),
            )

            if (inferredDimensions) {
              metadata.inferredDimensions = inferredDimensions
              metadata.updatedAt = new Date().toISOString()
              await writeJson(metadataPath, metadata)
            }
          }

          const shouldQueueStaleModel =
            modelFileName &&
            isProcessableModelFileName(modelFileName) &&
            !hasProcessedModelFile(metadata) &&
            ['original', 'pending-tool', 'queued', 'running'].includes(
              metadata.conversion?.status,
            )

          if (shouldQueueStaleModel) {
            metadata.conversion = {
              ...metadata.conversion,
              queuedAt: new Date().toISOString(),
              status: 'queued',
            }
            metadata.updatedAt = new Date().toISOString()
            await writeJson(metadataPath, metadata)
            queueModelProcessing(metadataPath, join(root, assetDir.name))
          }
        }

        assets.push(metadata)
      }
    }
  }

  return assets.sort((first, second) =>
    second.createdAt.localeCompare(first.createdAt),
  )
}

async function migrateHouseDesignerStorage() {
  const legacyPath = safeStoragePath(LEGACY_ADMIN_MANUFACTURER_SLUG)
  const nextPath = safeStoragePath(HOUSE_DESIGNER_MANUFACTURER_SLUG)

  if (await pathExists(nextPath)) {
    return
  }

  if (!(await pathExists(legacyPath))) {
    await mkdir(join(nextPath, 'materials'), { recursive: true })
    await mkdir(join(nextPath, 'models'), { recursive: true })
    return
  }

  try {
    await rename(legacyPath, nextPath)
  } catch {
    await mkdir(join(nextPath, 'materials'), { recursive: true })
    await mkdir(join(nextPath, 'models'), { recursive: true })
  }
}

async function getOrCreateAdminManufacturer(db) {
  let manufacturer = db.manufacturers.find(
    (candidate) => candidate.slug === HOUSE_DESIGNER_MANUFACTURER_SLUG,
  )

  if (manufacturer) {
    if (manufacturer.name !== HOUSE_DESIGNER_MANUFACTURER_NAME) {
      manufacturer.name = HOUSE_DESIGNER_MANUFACTURER_NAME
      await writeDb(db)
    }

    return manufacturer
  }

  manufacturer = {
    createdAt: new Date().toISOString(),
    id: createId(),
    name: HOUSE_DESIGNER_MANUFACTURER_NAME,
    slug: HOUSE_DESIGNER_MANUFACTURER_SLUG,
  }
  db.manufacturers.push(manufacturer)
  await writeDb(db)
  await mkdir(safeStoragePath(manufacturer.slug, 'materials'), { recursive: true })
  await mkdir(safeStoragePath(manufacturer.slug, 'models'), { recursive: true })

  return manufacturer
}

function publicAssetUrl(manufacturerSlug, kind, assetId, fileName) {
  return `/manufacturer-assets/${manufacturerSlug}/${kind}/${assetId}/${fileName}`
}

function getJsonChunkFromGlb(buffer) {
  if (buffer.toString('utf8', 0, 4) !== 'glTF') {
    return null
  }

  let offset = 12

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset)
    const chunkType = buffer.readUInt32LE(offset + 4)
    offset += 8

    if (chunkType === 0x4e4f534a) {
      return JSON.parse(buffer.toString('utf8', offset, offset + chunkLength))
    }

    offset += chunkLength
  }

  return null
}

function getModelDimensionsFromGltfJson(gltf) {
  const accessors = Array.isArray(gltf?.accessors) ? gltf.accessors : []
  const meshes = Array.isArray(gltf?.meshes) ? gltf.meshes : []
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const mesh of meshes) {
    const primitives = Array.isArray(mesh?.primitives) ? mesh.primitives : []

    for (const primitive of primitives) {
      const positionAccessorIndex = primitive?.attributes?.POSITION
      const accessor =
        typeof positionAccessorIndex === 'number'
          ? accessors[positionAccessorIndex]
          : null

      if (
        !accessor ||
        !Array.isArray(accessor.min) ||
        !Array.isArray(accessor.max) ||
        accessor.min.length < 3 ||
        accessor.max.length < 3
      ) {
        continue
      }

      minX = Math.min(minX, Number(accessor.min[0]))
      minY = Math.min(minY, Number(accessor.min[1]))
      minZ = Math.min(minZ, Number(accessor.min[2]))
      maxX = Math.max(maxX, Number(accessor.max[0]))
      maxY = Math.max(maxY, Number(accessor.max[1]))
      maxZ = Math.max(maxZ, Number(accessor.max[2]))
    }
  }

  const width = maxX - minX
  const height = maxY - minY
  const depth = maxZ - minZ

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(depth) ||
    width <= 0 ||
    height <= 0 ||
    depth <= 0
  ) {
    return null
  }

  return { depth, height, maxX, maxY, maxZ, minX, minY, minZ, width }
}

function transformPoint(matrix, point) {
  const [x, y, z] = point

  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ]
}

function expandBounds(bounds, point) {
  bounds.minX = Math.min(bounds.minX, point[0])
  bounds.minY = Math.min(bounds.minY, point[1])
  bounds.minZ = Math.min(bounds.minZ, point[2])
  bounds.maxX = Math.max(bounds.maxX, point[0])
  bounds.maxY = Math.max(bounds.maxY, point[1])
  bounds.maxZ = Math.max(bounds.maxZ, point[2])
}

function getAccessorLocalBounds(accessor) {
  const min = accessor.getMin([])
  const max = accessor.getMax([])

  if (
    min.length >= 3 &&
    max.length >= 3 &&
    min.every(Number.isFinite) &&
    max.every(Number.isFinite)
  ) {
    return { max, min }
  }

  const count = accessor.getCount()
  const element = []
  const bounds = {
    max: [
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ],
    min: [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ],
  }

  for (let index = 0; index < count; index += 1) {
    accessor.getElement(index, element)

    if (element.length < 3 || !element.slice(0, 3).every(Number.isFinite)) {
      continue
    }

    bounds.min[0] = Math.min(bounds.min[0], element[0])
    bounds.min[1] = Math.min(bounds.min[1], element[1])
    bounds.min[2] = Math.min(bounds.min[2], element[2])
    bounds.max[0] = Math.max(bounds.max[0], element[0])
    bounds.max[1] = Math.max(bounds.max[1], element[1])
    bounds.max[2] = Math.max(bounds.max[2], element[2])
  }

  return bounds.min.every(Number.isFinite) && bounds.max.every(Number.isFinite)
    ? bounds
    : null
}

function getModelDimensionsFromDocument(document) {
  const bounds = {
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
  }

  document.getRoot().listScenes().forEach((scene) => {
    scene.traverse((node) => {
      const mesh = node.getMesh()

      if (!mesh) {
        return
      }

      const matrix = node.getWorldMatrix()

      mesh.listPrimitives().forEach((primitive) => {
        const position = primitive.getAttribute('POSITION')

        if (!position) {
          return
        }

        const localBounds = getAccessorLocalBounds(position)

        if (!localBounds) {
          return
        }

        for (const x of [localBounds.min[0], localBounds.max[0]]) {
          for (const y of [localBounds.min[1], localBounds.max[1]]) {
            for (const z of [localBounds.min[2], localBounds.max[2]]) {
              expandBounds(bounds, transformPoint(matrix, [x, y, z]))
            }
          }
        }
      })
    })
  })

  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const depth = bounds.maxZ - bounds.minZ

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(depth) ||
    width <= 0 ||
    height <= 0 ||
    depth <= 0
  ) {
    return null
  }

  return { ...bounds, depth, height, width }
}

async function inferModelDimensions(filePath) {
  const extension = extname(filePath).toLowerCase()

  try {
    if (extension === '.glb' || extension === '.gltf') {
      return getModelDimensionsFromDocument(await modelDimensionIo.read(filePath))
    }

    if (extension === '.glb') {
      return getModelDimensionsFromGltfJson(
        getJsonChunkFromGlb(await readFile(filePath)),
      )
    }

    if (extension === '.gltf') {
      return getModelDimensionsFromGltfJson(
        JSON.parse(await readFile(filePath, 'utf8')),
      )
    }
  } catch (error) {
    console.warn(
      `Could not infer model dimensions for ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  return null
}

async function markProcessingStartFailed(metadataPath, error) {
  const metadata = await readJson(metadataPath, null)

  if (!metadata) {
    return
  }

  metadata.conversion = {
    ...metadata.conversion,
    completedAt: new Date().toISOString(),
    errors: [
      {
        fieldName: 'asset',
        message: error instanceof Error ? error.message : String(error),
      },
    ],
    status: 'failed',
  }
  metadata.updatedAt = new Date().toISOString()
  await writeJson(metadataPath, metadata)
}

function queueMaterialProcessing(metadataPath, assetDir) {
  const jobKey = metadataPath

  if (processingJobs.has(jobKey)) {
    return
  }

  processingJobs.add(jobKey)

  let worker

  try {
    worker = spawn(
      process.execPath,
      [join(import.meta.dirname, 'material-conversion-worker.mjs'), metadataPath, assetDir],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
  } catch (error) {
    processingJobs.delete(jobKey)
    void markProcessingStartFailed(metadataPath, error)
    return
  }

  worker.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
  })
  worker.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
  })
  worker.on('error', async (error) => {
    processingJobs.delete(jobKey)
    const metadata = await readJson(metadataPath, null)

    if (metadata) {
      metadata.conversion = {
        ...metadata.conversion,
        completedAt: new Date().toISOString(),
        errors: [
          {
            fieldName: 'asset',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        status: 'failed',
      }
      metadata.updatedAt = new Date().toISOString()
      await writeJson(metadataPath, metadata)
    }
  })
  worker.on('exit', () => {
    processingJobs.delete(jobKey)
  })
}

function queueModelProcessing(metadataPath, assetDir) {
  const jobKey = metadataPath

  if (processingJobs.has(jobKey)) {
    return
  }

  processingJobs.add(jobKey)

  let worker

  try {
    worker = spawn(
      process.execPath,
      [join(import.meta.dirname, 'model-conversion-worker.mjs'), metadataPath, assetDir],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
  } catch (error) {
    processingJobs.delete(jobKey)
    void markProcessingStartFailed(metadataPath, error)
    return
  }

  worker.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
  })
  worker.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
  })
  worker.on('error', async (error) => {
    processingJobs.delete(jobKey)
    const metadata = await readJson(metadataPath, null)

    if (metadata) {
      metadata.conversion = {
        ...metadata.conversion,
        completedAt: new Date().toISOString(),
        errors: [
          {
            fieldName: 'asset',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        status: 'failed',
      }
      metadata.updatedAt = new Date().toISOString()
      await writeJson(metadataPath, metadata)
    }
  })
  worker.on('exit', () => {
    processingJobs.delete(jobKey)
  })
}

async function handleSignup(request, response) {
  const payload = await readJsonBody(request)
  const name = String(payload.name ?? '').trim()
  const email = String(payload.email ?? '').trim().toLowerCase()
  const password = String(payload.password ?? '')

  if (!name || !email || password.length < 6) {
    sendError(response, 400, 'Name, email and a password of at least 6 characters are required')
    return
  }

  const db = await readDb()

  if (db.users.some((user) => user.email === email)) {
    sendError(response, 409, 'A user with that email already exists')
    return
  }

  const baseSlug = slugify(name) || `manufacturer-${Date.now()}`
  let slug = baseSlug
  let suffix = 2

  while (db.manufacturers.some((manufacturer) => manufacturer.slug === slug)) {
    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }

  const manufacturer = {
    createdAt: new Date().toISOString(),
    id: createId(),
    name,
    slug,
  }
  const { hash, salt } = hashPassword(password)
  const user = {
    email,
    id: createId(),
    manufacturerId: manufacturer.id,
    name,
    passwordHash: hash,
    passwordSalt: salt,
    role: 'manufacturer',
  }

  db.manufacturers.push(manufacturer)
  db.users.push(user)
  await writeDb(db)
  await mkdir(safeStoragePath(slug, 'materials'), { recursive: true })
  await mkdir(safeStoragePath(slug, 'models'), { recursive: true })

  sendJson(response, 201, { manufacturer })
}

async function handleLogin(request, response) {
  const payload = await readJsonBody(request)
  const email = String(payload.email ?? '').trim().toLowerCase()
  const password = String(payload.password ?? '')
  const db = await readDb()
  const user = db.users.find((candidate) => candidate.email === email)

  if (!user || !verifyPassword(password, user)) {
    sendError(response, 401, 'Invalid email or password')
    return
  }

  const token = createId()
  const manufacturer =
    user.manufacturerId
      ? db.manufacturers.find((candidate) => candidate.id === user.manufacturerId)
      : user.role === 'admin'
        ? await getOrCreateAdminManufacturer(db)
        : null

  sessions.set(token, { userId: user.id })
  sendJson(response, 200, {
    manufacturer,
    token,
    user: {
      email: user.email,
      id: user.id,
      name: user.name,
      role: user.role,
    },
  })
}

async function handleSession(request, response) {
  const current = await getCurrentUser(request)

  if (!current) {
    sendError(response, 401, 'Not signed in')
    return
  }

  const manufacturer =
    current.user.manufacturerId
      ? current.db.manufacturers.find(
          (candidate) => candidate.id === current.user.manufacturerId,
        )
      : current.user.role === 'admin'
        ? await getOrCreateAdminManufacturer(current.db)
        : null

  sendJson(response, 200, {
    manufacturer,
    user: {
      email: current.user.email,
      id: current.user.id,
      name: current.user.name,
      role: current.user.role,
    },
  })
}

async function handleListAssets(request, response) {
  const current = await getCurrentUser(request)

  if (!current) {
    sendError(response, 401, 'Not signed in')
    return
  }

  const manufacturers =
    current.user.role === 'admin'
      ? current.db.manufacturers
      : current.db.manufacturers.filter(
          (manufacturer) => manufacturer.id === current.user.manufacturerId,
        )
  const assetsByManufacturer = await Promise.all(
    manufacturers.map(async (manufacturer) => ({
      assets: await listAssetsForManufacturer(manufacturer),
      manufacturer,
    })),
  )

  sendJson(response, 200, {
    manufacturers: assetsByManufacturer,
  })
}

async function handleCatalog(response) {
  const db = await readDb()
  const manufacturers = await Promise.all(
    db.manufacturers.map(async (manufacturer) => ({
      assets: await listAssetsForManufacturer(manufacturer),
      manufacturer,
    })),
  )

  sendJson(response, 200, {
    manufacturers,
  })
}

async function handleUpload(request, response) {
  const current = await getCurrentUser(request)

  if (!current) {
    sendError(response, 401, 'Not signed in')
    return
  }

  const body = await readRequestBody(request)
  const { fields, files } = parseMultipart(request, body)
  const assetKind = fields.assetKind === 'model' ? 'models' : 'materials'
  let manufacturer =
    current.user.role === 'admin'
      ? fields.manufacturerId
        ? current.db.manufacturers.find(
            (candidate) => candidate.id === fields.manufacturerId,
          )
        : await getOrCreateAdminManufacturer(current.db)
      : current.db.manufacturers.find(
          (candidate) => candidate.id === current.user.manufacturerId,
        )

  if (!manufacturer) {
    sendError(response, 400, 'Manufacturer is required')
    return
  }

  const assetId = createId()
  const assetDir = safeStoragePath(manufacturer.slug, assetKind, assetId)
  await mkdir(assetDir, { recursive: true })

  const storedFiles = []

  for (const file of files) {
    const extension = extname(file.filename).toLowerCase()
    const safeName = `${slugify(file.fieldName)}${extension || '.bin'}`
    const filePath = join(assetDir, safeName)
    await writeFile(filePath, file.data)
    storedFiles.push({
      contentType: file.contentType,
      fieldName: file.fieldName,
      originalName: file.filename,
      size: file.data.length,
      url: publicAssetUrl(manufacturer.slug, assetKind, assetId, safeName),
    })
  }

  const metadataAssetKind = assetKind === 'models' ? 'model' : 'material'
  const modelFile = storedFiles.find((file) => file.fieldName === 'model')
  const inferredDimensions =
    metadataAssetKind === 'model' && modelFile
      ? await inferModelDimensions(join(assetDir, modelFile.url.split('/').pop() ?? ''))
      : null
  const metadata = {
    assetKind: metadataAssetKind,
    category: fields.category ?? '',
    collection: fields.collection ?? '',
    conversion: {
      status: 'queued',
      target: assetKind === 'models' ? 'optimized-glb-with-ktx2' : 'ktx2-2048',
    },
    createdAt: new Date().toISOString(),
    files: storedFiles,
    id: assetId,
    manufacturer: {
      id: manufacturer.id,
      name: manufacturer.name,
      slug: manufacturer.slug,
    },
    inferredDimensions,
    metadata: {
      colourFamily: fields.colourFamily ?? '',
      depth: fields.depth ?? '',
      finish: fields.finish ?? '',
      height: fields.height ?? '',
      materialType: fields.materialType ?? '',
      modelBehavior: fields.modelBehavior ?? '',
      objectType: fields.objectType ?? '',
      openingWidth: fields.openingWidth ?? '',
      productName: fields.productName ?? '',
      productUrl: fields.productUrl ?? '',
      realWorldHeightMeters: fields.realWorldHeightMeters ?? '',
      realWorldWidthMeters: fields.realWorldWidthMeters ?? '',
      sku: fields.sku ?? '',
      tags: fields.tags ?? '',
      width: fields.width ?? '',
    },
    updatedAt: new Date().toISOString(),
  }

  const metadataPath = join(assetDir, 'metadata.json')
  await writeJson(metadataPath, metadata)

  if (metadata.assetKind === 'material') {
    queueMaterialProcessing(metadataPath, assetDir)
  } else {
    queueModelProcessing(metadataPath, assetDir)
  }

  sendJson(response, 201, { asset: metadata })
}

async function handleProcessAsset(request, response, pathname) {
  const current = await getCurrentUser(request)

  if (!current) {
    sendError(response, 401, 'Not signed in')
    return
  }

  const [, , , , manufacturerSlug, kind, assetId] = pathname.split('/')
  const manufacturer = current.db.manufacturers.find(
    (candidate) => candidate.slug === manufacturerSlug,
  )

  if (!manufacturer) {
    sendError(response, 404, 'Manufacturer was not found')
    return
  }

  if (
    current.user.role !== 'admin' &&
    current.user.manufacturerId !== manufacturer.id
  ) {
    sendError(response, 403, 'You cannot process assets for this manufacturer')
    return
  }

  if (!['materials', 'models'].includes(kind)) {
    sendError(response, 400, 'Invalid asset kind')
    return
  }

  const assetDir = safeStoragePath(manufacturerSlug, kind, assetId)
  const metadataPath = join(assetDir, 'metadata.json')
  const metadata = await readJson(metadataPath, null)

  if (!metadata) {
    sendError(response, 404, 'Asset was not found')
    return
  }

  metadata.conversion = {
    ...metadata.conversion,
    queuedAt: new Date().toISOString(),
    status: 'queued',
  }
  metadata.updatedAt = new Date().toISOString()
  await writeJson(metadataPath, metadata)
  if (kind === 'materials') {
    queueMaterialProcessing(metadataPath, assetDir)
  } else {
    queueModelProcessing(metadataPath, assetDir)
  }
  sendJson(response, 202, { asset: metadata })
}

async function handleUpdateAsset(request, response, pathname) {
  const current = await getCurrentUser(request)

  if (!current) {
    sendError(response, 401, 'Not signed in')
    return
  }

  const [, , , , manufacturerSlug, kind, assetId] = pathname.split('/')
  const manufacturer = current.db.manufacturers.find(
    (candidate) => candidate.slug === manufacturerSlug,
  )

  if (!manufacturer) {
    sendError(response, 404, 'Manufacturer was not found')
    return
  }

  if (
    current.user.role !== 'admin' &&
    current.user.manufacturerId !== manufacturer.id
  ) {
    sendError(response, 403, 'You cannot modify assets for this manufacturer')
    return
  }

  if (!['materials', 'models'].includes(kind)) {
    sendError(response, 400, 'Invalid asset kind')
    return
  }

  const assetDir = safeStoragePath(manufacturerSlug, kind, assetId)
  const metadataPath = join(assetDir, 'metadata.json')
  const metadata = await readJson(metadataPath, null)

  if (!metadata) {
    sendError(response, 404, 'Asset was not found')
    return
  }

  const body = await readRequestBody(request)
  const { fields, files } = parseMultipart(request, body)
  const expectedAssetKind = kind === 'models' ? 'model' : 'material'

  if (fields.assetKind && fields.assetKind !== expectedAssetKind) {
    sendError(response, 400, 'Asset kind cannot be changed')
    return
  }

  const replacementFields = new Set(files.map((file) => file.fieldName))
  const retainedFiles = (metadata.files ?? []).filter(
    (file) => !replacementFields.has(file.fieldName),
  )
  const storedFiles = []

  for (const file of files) {
    const extension = extname(file.filename).toLowerCase()
    const safeName = `${slugify(file.fieldName)}${extension || '.bin'}`
    const filePath = join(assetDir, safeName)
    const previousFile = metadata.files?.find(
      (candidate) => candidate.fieldName === file.fieldName,
    )
    const previousFileName = previousFile?.url.split('/').pop()

    if (previousFileName && previousFileName !== safeName) {
      await rm(join(assetDir, previousFileName), { force: true })
    }

    await writeFile(filePath, file.data)
    storedFiles.push({
      contentType: file.contentType,
      fieldName: file.fieldName,
      originalName: file.filename,
      size: file.data.length,
      url: publicAssetUrl(manufacturer.slug, kind, assetId, safeName),
    })
  }

  metadata.category = fields.category ?? ''
  metadata.collection = fields.collection ?? ''
  metadata.files = [...retainedFiles, ...storedFiles]
  metadata.metadata = {
    ...metadata.metadata,
    colourFamily: fields.colourFamily ?? '',
    depth: fields.depth ?? '',
    finish: fields.finish ?? '',
    height: fields.height ?? '',
    materialType: fields.materialType ?? '',
    modelBehavior: fields.modelBehavior ?? '',
    objectType: fields.objectType ?? '',
    openingWidth: fields.openingWidth ?? '',
    productName: fields.productName ?? '',
    productUrl: fields.productUrl ?? '',
    realWorldHeightMeters: fields.realWorldHeightMeters ?? '',
    realWorldWidthMeters: fields.realWorldWidthMeters ?? '',
    sku: fields.sku ?? '',
    tags: fields.tags ?? '',
    width: fields.width ?? '',
  }
  metadata.updatedAt = new Date().toISOString()

  if (files.length > 0) {
    await rm(join(assetDir, 'processed'), { force: true, recursive: true })
    metadata.processedFiles = []
    metadata.conversion = {
      ...metadata.conversion,
      queuedAt: new Date().toISOString(),
      status: 'queued',
    }

    if (expectedAssetKind === 'model' && replacementFields.has('model')) {
      const modelFile = metadata.files.find((file) => file.fieldName === 'model')
      metadata.inferredDimensions = modelFile
        ? await inferModelDimensions(join(assetDir, modelFile.url.split('/').pop() ?? ''))
        : null
    }
  }

  await writeJson(metadataPath, metadata)

  if (files.length > 0) {
    if (expectedAssetKind === 'material') {
      queueMaterialProcessing(metadataPath, assetDir)
    } else {
      queueModelProcessing(metadataPath, assetDir)
    }
  }

  sendJson(response, 200, { asset: metadata })
}

async function handleDeleteAsset(request, response, pathname) {
  const current = await getCurrentUser(request)

  if (!current) {
    sendError(response, 401, 'Not signed in')
    return
  }

  const [, , , , manufacturerSlug, kind, assetId] = pathname.split('/')
  const manufacturer = current.db.manufacturers.find(
    (candidate) => candidate.slug === manufacturerSlug,
  )

  if (!manufacturer) {
    sendError(response, 404, 'Manufacturer was not found')
    return
  }

  if (
    current.user.role !== 'admin' &&
    current.user.manufacturerId !== manufacturer.id
  ) {
    sendError(response, 403, 'You cannot delete assets for this manufacturer')
    return
  }

  if (!['materials', 'models'].includes(kind)) {
    sendError(response, 400, 'Invalid asset kind')
    return
  }

  await rm(safeStoragePath(manufacturerSlug, kind, assetId), {
    force: true,
    recursive: true,
  })
  sendJson(response, 200, { deleted: true })
}

async function serveStoredAsset(request, response, pathname) {
  const relativePath = decodeURIComponent(pathname.replace(/^\/manufacturer-assets\//, ''))
  const target = safeStoragePath(...relativePath.split('/'))

  if (!(await pathExists(target))) {
    sendError(response, 404, 'File was not found')
    return
  }

  const extension = extname(target).toLowerCase()
  const contentTypes = {
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.json': 'application/json',
    '.ktx2': 'image/ktx2',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }

  response.writeHead(200, {
    'content-type': contentTypes[extension] ?? 'application/octet-stream',
  })
  createReadStream(target).pipe(response)
}

async function route(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  const { pathname } = url

  try {
    if (request.method === 'GET' && pathname === '/api/portal/health') {
      sendJson(response, 200, { ok: true, storageDir: STORAGE_DIR })
      return
    }

    if (request.method === 'POST' && pathname === '/api/portal/signup') {
      await handleSignup(request, response)
      return
    }

    if (request.method === 'POST' && pathname === '/api/portal/login') {
      await handleLogin(request, response)
      return
    }

    if (request.method === 'GET' && pathname === '/api/portal/session') {
      await handleSession(request, response)
      return
    }

    if (request.method === 'GET' && pathname === '/api/portal/assets') {
      await handleListAssets(request, response)
      return
    }

    if (request.method === 'GET' && pathname === '/api/portal/catalog') {
      await handleCatalog(response)
      return
    }

    if (request.method === 'POST' && pathname === '/api/portal/assets') {
      await handleUpload(request, response)
      return
    }

    if (request.method === 'PATCH' && pathname.startsWith('/api/portal/assets/')) {
      await handleUpdateAsset(request, response, pathname)
      return
    }

    if (
      request.method === 'POST' &&
      pathname.startsWith('/api/portal/process/')
    ) {
      await handleProcessAsset(request, response, pathname)
      return
    }

    if (request.method === 'DELETE' && pathname.startsWith('/api/portal/assets/')) {
      await handleDeleteAsset(request, response, pathname)
      return
    }

    if (request.method === 'GET' && pathname.startsWith('/manufacturer-assets/')) {
      await serveStoredAsset(request, response, pathname)
      return
    }

    sendError(response, 404, 'Not found')
  } catch (error) {
    sendError(response, 500, error instanceof Error ? error.message : String(error))
  }
}

await ensureDb()

createServer(route).listen(PORT, () => {
  console.log(`Asset portal server listening on http://localhost:${PORT}`)
  console.log(`Storage directory: ${pathToFileURL(STORAGE_DIR).href}`)
})
