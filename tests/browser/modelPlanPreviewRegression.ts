import { Box3, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { renderModelPlanPreview } from '../../src/modelPlanPreview'
import bed from '../../src/models/assets/king_bed.glb?url'

const state = window as unknown as { planPreviewResult?: unknown; planPreviewError?: string }
try {
  const gltf = await new GLTFLoader().loadAsync(bed)
  const size = new Box3().setFromObject(gltf.scene).getSize(new Vector3())
  const canvas = await renderModelPlanPreview(gltf.scene)
  document.body.append(canvas)
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  let ink = 0, white = 0, transparent = 0, coloured = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) { transparent++; continue }
    if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2]) coloured++
    if (pixels[i] < 20) ink++
    if (pixels[i] > 235) white++
  }
  state.planPreviewResult = { ink, white, transparent, coloured, aspect: canvas.width / canvas.height, modelAspect: size.x / size.z }
} catch (error) { state.planPreviewError = String(error) }
