import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions'
import sharp from 'sharp'
import { encodeToKTX2 } from 'ktx2-encoder'

const MODEL_TEXTURE_MAX_SIZE = 2048

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

function publicAssetUrl(manufacturerSlug, kind, assetId, fileName) {
  return `/manufacturer-assets/${manufacturerSlug}/${kind}/${assetId}/${fileName}`
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

function listTextureSlots(texture) {
  const document = Document.fromGraph(texture.getGraph())
  const root = document.getRoot()
  const slots = texture
    .getGraph()
    .listParentEdges(texture)
    .filter((edge) => edge.getParent() !== root)
    .map((edge) => edge.getName())

  return Array.from(new Set(slots))
}

function getTextureOptions(slots) {
  const slotText = slots.join(' ')
  const isNormal = /normalTexture/i.test(slotText)
  const isPerceptual = /baseColorTexture|emissiveTexture/i.test(slotText)

  return {
    isNormal,
    isPerceptual,
    isUASTC: isNormal,
  }
}

async function decodeImageForKtx(buffer) {
  const { data, info } = await sharp(Buffer.from(buffer), {
    limitInputPixels: false,
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return {
    data: new Uint8Array(data),
    height: info.height,
    width: info.width,
  }
}

async function resizeTextureImage(image) {
  const sharpImage = sharp(Buffer.from(image), { limitInputPixels: false }).rotate()
  const metadata = await sharpImage.metadata()
  const sourceWidth = metadata.width ?? 0
  const sourceHeight = metadata.height ?? 0
  const needsResize =
    sourceWidth > MODEL_TEXTURE_MAX_SIZE || sourceHeight > MODEL_TEXTURE_MAX_SIZE
  const preparedImage = needsResize
    ? sharpImage.resize({
        fit: 'inside',
        height: MODEL_TEXTURE_MAX_SIZE,
        width: MODEL_TEXTURE_MAX_SIZE,
        withoutEnlargement: true,
      })
    : sharpImage

  return {
    buffer: await preparedImage.png().toBuffer(),
    resized: needsResize,
    sourceHeight,
    sourceWidth,
  }
}

async function convertTexture(texture, textureIndex) {
  if (texture.getMimeType() === 'image/ktx2') {
    return {
      converted: false,
      reason: 'already-ktx2',
    }
  }

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(texture.getMimeType())) {
    return {
      converted: false,
      reason: `unsupported-${texture.getMimeType() || 'unknown'}`,
    }
  }

  const image = texture.getImage()

  if (!image) {
    return {
      converted: false,
      reason: 'missing-image',
    }
  }

  const slots = listTextureSlots(texture)
  const options = getTextureOptions(slots)
  const prepared = await resizeTextureImage(image)
  const ktx2Data = await encodeToKTX2(new Uint8Array(prepared.buffer), {
    compressionLevel: 2,
    enableRDO: false,
    generateMipmap: true,
    imageDecoder: decodeImageForKtx,
    isKTX2File: true,
    isNormalMap: options.isNormal,
    isPerceptual: options.isPerceptual,
    isSetKTX2SRGBTransferFunc: options.isPerceptual,
    isUASTC: options.isUASTC,
    needSupercompression: options.isUASTC,
    qualityLevel: 192,
    rdoQualityLevel: 2,
    uastcLDRQualityLevel: 2,
  })

  texture.setImage(ktx2Data)
  texture.setMimeType('image/ktx2')
  texture.setURI(
    `${texture.getURI() || texture.getName() || `texture-${textureIndex}`}.ktx2`,
  )

  return {
    converted: true,
    outputBytes: ktx2Data.byteLength,
    resized: prepared.resized,
    slots,
    sourceBytes: image.byteLength,
    sourceHeight: prepared.sourceHeight,
    sourceWidth: prepared.sourceWidth,
  }
}

async function processModelAsset(metadata, assetDir) {
  const sourceFile = metadata.files.find((file) => file.fieldName === 'model')
  const sourceFileName = sourceFile?.url.split('/').pop()

  if (!sourceFileName) {
    throw new Error('Model file is missing')
  }

  const sourcePath = join(assetDir, sourceFileName)
  const sourceExtension = extname(sourceFileName).toLowerCase()

  if (!['.glb', '.gltf'].includes(sourceExtension)) {
    return {
      errors: [
        {
          fieldName: 'model',
          message: 'Only GLB and GLTF model processing is currently supported',
        },
      ],
      processedFiles: [],
      status: 'failed',
    }
  }

  const processedDir = join(assetDir, 'processed')
  const outputName = 'model.glb'
  const outputPath = join(processedDir, outputName)
  await mkdir(processedDir, { recursive: true })

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const document = await io.read(sourcePath)
  const inferredDimensions = getModelDimensionsFromDocument(document)
  const textureResults = []
  const errors = []
  let convertedTextureCount = 0

  for (const [textureIndex, texture] of document.getRoot().listTextures().entries()) {
    try {
      const result = await convertTexture(texture, textureIndex)
      textureResults.push(result)

      if (result.converted) {
        convertedTextureCount += 1
      }
    } catch (error) {
      errors.push({
        fieldName: texture.getName() || texture.getURI() || `texture-${textureIndex}`,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (convertedTextureCount > 0) {
    document.createExtension(KHRTextureBasisu).setRequired(true)
  }

  await io.write(outputPath, document)

  const processedFile = {
    contentType: 'model/gltf-binary',
    fieldName: 'model',
    originalName: sourceFile.originalName,
    processing: {
      convertedTextureCount,
      textureResults,
    },
    size: (await stat(outputPath)).size,
    sourceUrl: sourceFile.url,
    url: publicAssetUrl(
      metadata.manufacturer.slug,
      'models',
      metadata.id,
      `processed/${outputName}`,
    ),
  }

  return {
    errors,
    inferredDimensions,
    processedFiles: [processedFile],
    status: errors.length > 0 ? 'partial' : 'complete',
  }
}

async function main() {
  const [, , metadataPath, assetDir] = process.argv

  if (!metadataPath || !assetDir) {
    throw new Error('Usage: model-conversion-worker <metadataPath> <assetDir>')
  }

  const metadata = await readJson(metadataPath, null)

  if (!metadata) {
    throw new Error(`Metadata was not found: ${metadataPath}`)
  }

  metadata.conversion = {
    ...metadata.conversion,
    startedAt: new Date().toISOString(),
    status: 'running',
  }
  await writeJson(metadataPath, metadata)

  try {
    const conversion = await processModelAsset(metadata, assetDir)
    metadata.conversion = {
      ...metadata.conversion,
      completedAt: new Date().toISOString(),
      errors: conversion.errors,
      status: conversion.status,
    }
    metadata.inferredDimensions =
      conversion.inferredDimensions ?? metadata.inferredDimensions
    metadata.processedFiles = conversion.processedFiles
    metadata.updatedAt = new Date().toISOString()
    await writeJson(metadataPath, metadata)
    console.log(`Processed model asset ${metadata.id}: ${conversion.status}`)
  } catch (error) {
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
    throw error
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
