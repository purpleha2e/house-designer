# Material Products

Each JSON file in this folder is loaded into the material catalogue at build time.

Texture files should live in `public/materials/...` and be referenced with absolute
browser paths, for example:

```json
{
  "id": "sample-stone-tile",
  "manufacturer": "Sample Manufacturer",
  "productName": "Stone Tile",
  "category": "tile",
  "materialType": "porcelain tile",
  "finish": "matt",
  "pbr": {
    "baseColor": "#b9b6ac",
    "baseColorTextureUrl": "/materials/sample-stone-tile/basecolor.jpg",
    "normalTextureUrl": "/materials/sample-stone-tile/normal.jpg",
    "roughnessTextureUrl": "/materials/sample-stone-tile/roughness.jpg",
    "ambientOcclusionTextureUrl": "/materials/sample-stone-tile/ao.jpg",
    "roughness": 0.64,
    "metalness": 0,
    "repeatX": 4,
    "repeatY": 4
  }
}
```
