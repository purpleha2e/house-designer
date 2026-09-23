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
    "imageBasedLighting": false,
    "repeatX": 4,
    "repeatY": 4
  }
}
```

`imageBasedLighting` is opt-in. For surface products it adds environment
reflections without adding environment diffuse irradiance, preserving the
authored base-colour lightness under the normal scene lighting controls.

# Procedural variation

Materials can opt into `pbr.proceduralVariation`. In the asset portal, use
**New/Modify Asset → Material → Procedural variation → On (desktop only)**.
Existing materials default to off. Changes to the portal server require a server
restart before saving the new metadata fields.

- **General surface** adds smooth world-position colour variation to any material,
  including solid colours. Strength, scale in metres and seed control the pattern.
- **Brick courses** also adds individual brick colour/roughness variation. Match
  bricks across, rows, stagger and grid offsets to the full texture tile so that
  the softened tint boundaries follow the mortar. This is a regular grid, not
  automatic brick detection. Zero brick strength leaves broad variation only.
- Patterns are deterministic and broad variation continues across adjoining meshes.
  Texture detail, normal maps and geometry are unchanged. This reduces visible
  repetition; it does not synthesize new brick surface detail.
- Entering VR selects the ordinary material shader; leaving VR restores the saved
  effect. Disabled variation adds no shader calculations or texture samples.

Verification: `node --test --experimental-strip-types tests/materialVariation.test.ts`.
With Vite running, open `/tests/browser/materialVariation.html` for the isolated
WebGL regression checks (shader compilation, wall/slab continuity, seed stability,
ordinary rendering in the VR path, and draw-call count).
