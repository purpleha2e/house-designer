import { ACESFilmicToneMapping, AmbientLight, Box3, Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial,
  OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { modelsById } from '../../src/models/modelLibrary'

const assetInfo: Record<string, unknown> = {}
const assets = document.getElementById('window') ? [
  ['window', 'window_large_single_pane.glb'],
] : [
  ['original','patio_doors.glb'],
  ['closed','patio_doors_bifold_three_pane_closed.glb'],
  ['open','patio_doors_bifold_three_pane_open.glb'],
]
for (const [id, file] of assets) {
  const canvas = document.getElementById(id) as HTMLCanvasElement
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(480, 540, false)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = true
  const scene = new Scene()
  scene.background = new Color('#edf2f7')
  scene.add(new HemisphereLight('#ffffff', '#cbd5e1', 2), new AmbientLight('#ffffff', 0.4))
  const sunlight = new DirectionalLight('#fff6e8', 3)
  sunlight.position.set(-3,6,-4);sunlight.castShadow = true
  sunlight.shadow.mapSize.set(1024,1024)
  sunlight.shadow.camera.left=-4;sunlight.shadow.camera.right=4
  sunlight.shadow.camera.top=4;sunlight.shadow.camera.bottom=-4
  sunlight.shadow.normalBias=0.015
  scene.add(sunlight)
  const ground = new Mesh(new PlaneGeometry(200,200),new MeshStandardMaterial({color:'#d9e1e8',roughness:1}))
  ground.rotation.x=-Math.PI/2;ground.position.y=-0.008;ground.receiveShadow=true
  scene.add(ground)
  const asset = await new GLTFLoader().loadAsync(`/src/models/assets/${file}`)
  const panes: string[]=[]
  asset.scene.traverse(object=>{
    if (!(object instanceof Mesh)) return
    const materials=Array.isArray(object.material)?object.material:[object.material]
    const glass=materials.some(material=>material.name.includes('glass'))
    if(glass){panes.push(object.name);materials.forEach(material=>{material.depthWrite=false})}
    else object.castShadow=true
  })
  scene.add(asset.scene)
  const box=new Box3().setFromObject(asset.scene)
  const size=box.getSize(new Vector3())
  const camera=new OrthographicCamera(-1.7,1.7,1.9125,-1.9125,0.1,100)
  camera.position.set(3.1,2.7,-4.8);camera.lookAt(0,1,0)
  renderer.render(scene,camera)
  const modelId=file.replace('.glb','').replaceAll('_','-')
  const definition=modelsById.get(modelId)
  assetInfo[id]={panes,dimensions:size.toArray(),min:box.min.toArray(),max:box.max.toArray(),
    definition:definition && {name:definition.name,wallMount:definition.wallMount,width:definition.width,openingWidth:definition.openingWidth}}
}
Object.assign(window,{bifoldAssetInfo:assetInfo,bifoldPreviewReady:true})
