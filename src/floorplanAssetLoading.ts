import { LoadingManager, MeshBasicMaterial } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

// Plan bounds/thumbnail work must not enter Drei's global 3D readiness gate.
const planLoadingManager = new LoadingManager()
export const createFloorplanGltfLoader = () => new GLTFLoader(planLoadingManager).register(() => ({
  name: 'HOUSE_DESIGNER_PLAN_GEOMETRY',
  // Plan bounds and normal/depth outlines need geometry only. Bypass material
  // dependencies before GLTFLoader decodes images or starts KTX2 workers.
  loadMaterial: () => Promise.resolve(new MeshBasicMaterial()),
}))
export const createFloorplanKtx2Loader = () => new KTX2Loader(planLoadingManager)
