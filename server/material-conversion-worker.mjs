import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { encodeToKTX2 } from 'ktx2-encoder'

const MATERIAL_TEXTURE_MAX_SIZE = 2048
const MATERIAL_DISPLACEMENT_MAX_SIZE = 1024
const MATERIAL_TEXTURE_FIELDS = new Set([
  'ambientOcclusion',
  'baseColor',
  'displacement',
  'metalness',
  'normal',
  'roughness',
])

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
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

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

function publicAssetUrl(manufacturerSlug, kind, assetId, fileName) {
  return `/manufacturer-assets/${manufacturerSlug}/${kind}/${assetId}/${fileName}`
}

function getMaterialTextureOptions(fieldName) {
  const isNormal = fieldName === 'normal'
  const isBaseColor = fieldName === 'baseColor'
  const isDisplacement = fieldName === 'displacement'

  return {
    isNormal,
    isPerceptual: isBaseColor,
    isUASTC: isNormal,
    maxSize: isDisplacement
      ? MATERIAL_DISPLACEMENT_MAX_SIZE
      : MATERIAL_TEXTURE_MAX_SIZE,
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

async function convertMaterialTextureToKtx2(filePath, outputPath, fieldName) {
  const options = getMaterialTextureOptions(fieldName)
  const image = sharp(filePath, { limitInputPixels: false }).rotate()
  const metadata = await image.metadata()
  const sourceWidth = metadata.width ?? 0
  const sourceHeight = metadata.height ?? 0
  const needsResize =
    sourceWidth > options.maxSize || sourceHeight > options.maxSize
  const preparedImage = needsResize
    ? image.resize({
        fit: 'inside',
        height: options.maxSize,
        width: options.maxSize,
        withoutEnlargement: true,
      })
    : image
  const preparedBuffer = await preparedImage.png().toBuffer()
  const preparedMetadata = await sharp(preparedBuffer).metadata()
  const ktx2Data = await encodeToKTX2(new Uint8Array(preparedBuffer), {
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

  await writeFile(outputPath, Buffer.from(ktx2Data))

  return {
    format: 'ktx2',
    processedHeight: preparedMetadata.height ?? sourceHeight,
    processedWidth: preparedMetadata.width ?? sourceWidth,
    resized: needsResize,
    sourceHeight,
    sourceWidth,
  }
}

async function processMaterialAsset(metadata, assetDir) {
  const processedDir = join(assetDir, 'processed')
  await mkdir(processedDir, { recursive: true })

  const processedFiles = []
  const errors = []

  for (const file of metadata.files) {
    if (!MATERIAL_TEXTURE_FIELDS.has(file.fieldName)) {
      continue
    }

    const sourceFileName = file.url.split('/').pop()

    if (!sourceFileName) {
      continue
    }

    const sourcePath = join(assetDir, sourceFileName)
    const outputName = `${slugify(file.fieldName)}.ktx2`
    const outputPath = join(processedDir, outputName)

    try {
      const processing = (await pathExists(outputPath))
        ? {
            existing: true,
            format: 'ktx2',
          }
        : await convertMaterialTextureToKtx2(sourcePath, outputPath, file.fieldName)

      processedFiles.push({
        contentType: 'image/ktx2',
        fieldName: file.fieldName,
        originalName: file.originalName,
        processing,
        size: (await stat(outputPath)).size,
        sourceUrl: file.url,
        url: publicAssetUrl(
          metadata.manufacturer.slug,
          'materials',
          metadata.id,
          `processed/${outputName}`,
        ),
      })
    } catch (error) {
      errors.push({
        fieldName: file.fieldName,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    errors,
    processedFiles,
    status:
      processedFiles.length > 0
        ? errors.length > 0
          ? 'partial'
          : 'complete'
        : 'failed',
  }
}

async function main() {
  const [, , metadataPath, assetDir] = process.argv

  if (!metadataPath || !assetDir) {
    throw new Error('Usage: material-conversion-worker <metadataPath> <assetDir>')
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
    const conversion = await processMaterialAsset(metadata, assetDir)
    metadata.conversion = {
      ...metadata.conversion,
      completedAt: new Date().toISOString(),
      errors: conversion.errors,
      status: conversion.status,
    }
    metadata.processedFiles = conversion.processedFiles
    metadata.updatedAt = new Date().toISOString()
    await writeJson(metadataPath, metadata)
    console.log(`Processed material asset ${metadata.id}: ${conversion.status}`)
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
