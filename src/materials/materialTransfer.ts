import type { SurfaceMaterialProduct } from '../types.ts'
import { isLocalMaterial, localMaterialPrefix, materialMapSlots, validateLocalMaterial } from './localMaterials.ts'
import { prepareMaterialImage } from './prepareMaterialImage.ts'
import { materialCategoryLabel, materialLabelChoices, normalizeMaterialLabel, parseSurfaceCategory, surfaceCategoryLabels } from './materialCatalogueMetadata.ts'

/** Embed the chosen preview maps so the personal copy can travel with a house. */
export async function embedCatalogueMaterial(draft: SurfaceMaterialProduct, source: SurfaceMaterialProduct) {
  const copy = structuredClone(draft)
  delete copy.originalTextureUrls
  const hashes = copy.pbr.textureSourceHashes = { ...copy.pbr.textureSourceHashes }
  for (const { key, label } of materialMapSlots) {
    const preview = copy.pbr[key]
    if (!preview || preview.startsWith('data:')) continue
    const original = preview === source.pbr[key] ? source.originalTextureUrls?.[key] ?? preview : preview
    try {
      const response = await fetch(original)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const image = await prepareMaterialImage(await response.blob())
      copy.pbr[key] = image.url
      hashes[key] = image.hash
    } catch {
      throw new Error(`Could not copy the ${label.toLowerCase()} map. Choose a replacement image or remove the map to save a copy.`)
    }
  }
  validateLocalMaterial(copy)
  return copy
}

export type PublicMaterialDetails = { name: string; brand: string; collection: string; category: string; materialType: string }

const defaultBrand = 'House Designer'
const collectionName = (value?: string) => value === 'Local library' || value === 'Portal uploads' ? undefined : value
const matchLabel = (value: string, options: string[]) => {
  const label = normalizeMaterialLabel(value)
  return options.find(option => option.toLowerCase() === label.toLowerCase()) ?? label
}

export function getPublicMaterialDetails(material: SurfaceMaterialProduct): PublicMaterialDetails {
  const category = material.catalogueCategory ?? materialCategoryLabel(material)
  return { name: material.productName, brand: isLocalMaterial(material) && (!material.manufacturer || material.manufacturer === 'My materials') ? defaultBrand : material.manufacturer,
    collection: collectionName(material.collection) ?? '', category, materialType: material.materialType ?? category }
}

export function getPublicMaterialChoices(materials: SurfaceMaterialProduct[], initial: PublicMaterialDetails, brand: string) {
  const published = materials.filter(material => !isLocalMaterial(material))
  return {
    brand: materialLabelChoices([defaultBrand, ...published.map(material => material.manufacturer)]),
    category: materialLabelChoices([...Object.values(surfaceCategoryLabels), ...published.map(materialCategoryLabel), initial.category]),
    materialType: materialLabelChoices([...published.map(material => material.materialType), initial.materialType]),
    collection: materialLabelChoices(published.filter(material => normalizeMaterialLabel(material.manufacturer).toLowerCase() === normalizeMaterialLabel(brand).toLowerCase())
      .map(material => collectionName(material.collection))),
  }
}

export function matchPublicMaterialDetails(details: PublicMaterialDetails, choices: ReturnType<typeof getPublicMaterialChoices>): PublicMaterialDetails {
  return { name: details.name, brand: matchLabel(details.brand, choices.brand), collection: matchLabel(details.collection, choices.collection),
    category: matchLabel(details.category, choices.category), materialType: matchLabel(details.materialType, choices.materialType) }
}

export async function createPublicMaterialUpload(material: SurfaceMaterialProduct, details: PublicMaterialDetails, source?: SurfaceMaterialProduct) {
  const pbr = { ...material.pbr }
  const removed: string[] = []
  if (source) {
    for (const { field, key, label } of materialMapSlots) {
      const url = material.pbr[key]
      if (!url) {
        if (source.pbr[key]) removed.push(field)
      } else if (url === source.pbr[key] && (source.id.startsWith('portal-material-') || source.originalTextureUrls?.[key])) {
        // The server already owns this map and can preserve it without an upload.
        delete pbr[key]
      } else if (!url.startsWith('data:')) {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Could not read the ${label.toLowerCase()} map.`)
        pbr[key] = (await prepareMaterialImage(await response.blob())).url
      }
    }
  }
  validateLocalMaterial({ ...material, id: source ? `${localMaterialPrefix}edit` : material.id, pbr })
  const name = normalizeMaterialLabel(details.name)
  const brand = normalizeMaterialLabel(details.brand)
  const category = normalizeMaterialLabel(details.category)
  const materialType = normalizeMaterialLabel(details.materialType)
  if (!name || !brand || !category || !materialType) throw new Error('Enter a name, brand, category and material type.')
  const form = new FormData()
  form.set('assetKind', 'material')
  form.set('productName', name)
  form.set('brand', brand)
  form.set('category', category)
  form.set('surfaceCategory', parseSurfaceCategory(category) ?? material.category)
  form.set('materialType', materialType)
  form.set('collection', normalizeMaterialLabel(details.collection))
  if (removed.length) form.set('removeMaps', removed.join(','))
  form.set('albedoColor', material.pbr.baseColor ?? '#ffffff')
  for (const key of ['finish', 'colourFamily', 'productUrl', 'sku'] as const) {
    const value = material[key]
    if (value) form.set(key, value)
  }
  if (material.tags?.length) form.set('tags', material.tags.join(', '))
  if (material.pbr.roughness !== undefined) form.set('pbrRoughness', String(material.pbr.roughness))
  if (material.pbr.metalness !== undefined) form.set('pbrMetalness', String(material.pbr.metalness))
  for (const key of ['normalStrength', 'normalFlipY', 'displacementScale', 'realWorldHeightMeters', 'realWorldWidthMeters',
    'repeatX', 'repeatY', 'rotation', 'imageBasedLighting'] as const) {
    const value = material.pbr[key]
    if (value !== undefined) form.set(key, String(value))
  }
  for (const [key, value] of Object.entries(material.pbr.proceduralVariation ?? {})) form.set(`variation_${key}`, String(value))
  for (const { field, key } of materialMapSlots) {
    const url = pbr[key]
    if (!url) continue
    const image = await (await fetch(url)).blob()
    const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.slice('image/'.length)
    form.append(field, image, `${field}.${extension}`)
  }
  return form
}
