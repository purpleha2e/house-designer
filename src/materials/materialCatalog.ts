import type { SurfaceMaterialProduct } from '../types'

export const surfaceMaterialCatalog: SurfaceMaterialProduct[] = [
  {
    id: 'amtico-spacia-warm-oak',
    manufacturer: 'Amtico',
    productName: 'Warm Oak',
    collection: 'Spacia',
    category: 'flooring',
    materialType: 'luxury vinyl tile',
    finish: 'textured',
    colourFamily: 'warm wood',
    tags: ['floor', 'lvt', 'plank', 'wood'],
    pbr: {
      baseColor: '#b68a5e',
      roughness: 0.72,
      metalness: 0,
      realWorldWidthMeters: 0.18,
      realWorldHeightMeters: 1.22,
      repeatX: 4,
      repeatY: 4,
    },
  },
  {
    id: 'karndean-van-gogh-french-oak',
    manufacturer: 'Karndean',
    productName: 'French Oak',
    collection: 'Van Gogh',
    category: 'flooring',
    materialType: 'luxury vinyl tile',
    finish: 'textured',
    colourFamily: 'natural wood',
    tags: ['floor', 'lvt', 'plank', 'wood'],
    pbr: {
      baseColor: '#9f7750',
      roughness: 0.76,
      metalness: 0,
      realWorldWidthMeters: 0.18,
      realWorldHeightMeters: 1.22,
      repeatX: 4,
      repeatY: 4,
    },
  },
  {
    id: 'porcelain-calm-stone-matt',
    manufacturer: 'House Designer',
    productName: 'Calm Stone',
    collection: 'Core samples',
    category: 'tile',
    materialType: 'porcelain tile',
    finish: 'matt',
    colourFamily: 'warm grey',
    tags: ['floor', 'tile', 'stone'],
    pbr: {
      baseColor: '#b9b6ac',
      roughness: 0.64,
      metalness: 0,
      realWorldWidthMeters: 0.6,
      realWorldHeightMeters: 0.6,
      repeatX: 3,
      repeatY: 3,
    },
  },
  {
    id: 'metro-white-gloss-tile',
    manufacturer: 'House Designer',
    productName: 'Metro White',
    collection: 'Core samples',
    category: 'tile',
    materialType: 'ceramic wall tile',
    finish: 'gloss',
    colourFamily: 'white',
    tags: ['wall', 'tile', 'kitchen', 'bathroom'],
    pbr: {
      baseColor: '#f8fafc',
      roughness: 0.28,
      metalness: 0,
      realWorldWidthMeters: 0.2,
      realWorldHeightMeters: 0.1,
      repeatX: 6,
      repeatY: 6,
    },
  },
  {
    id: 'farrow-ball-hague-blue',
    manufacturer: 'Farrow & Ball',
    productName: 'Hague Blue',
    category: 'paint',
    materialType: 'paint',
    finish: 'matt',
    colourFamily: 'blue',
    tags: ['wall', 'paint'],
    pbr: {
      baseColor: '#2f3f46',
      roughness: 0.88,
      metalness: 0,
    },
  },
  {
    id: 'dulux-timeless-matt',
    manufacturer: 'Dulux',
    productName: 'Timeless',
    category: 'paint',
    materialType: 'paint',
    finish: 'matt',
    colourFamily: 'warm white',
    tags: ['wall', 'paint'],
    pbr: {
      baseColor: '#eee9dc',
      roughness: 0.84,
      metalness: 0,
    },
  },
]

export const surfaceMaterialsById = new Map(
  surfaceMaterialCatalog.map((material) => [material.id, material]),
)

export function getSurfaceMaterialLabel(material: SurfaceMaterialProduct) {
  return [
    material.manufacturer,
    material.collection,
    material.productName,
    material.finish,
  ]
    .filter(Boolean)
    .join(' - ')
}
