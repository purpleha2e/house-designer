import { LoadingManager } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

// Plan bounds/thumbnail work must not enter Drei's global 3D readiness gate.
const planLoadingManager = new LoadingManager()
export const createFloorplanGltfLoader = () => new GLTFLoader(planLoadingManager)
export const createFloorplanKtx2Loader = () => new KTX2Loader(planLoadingManager)
