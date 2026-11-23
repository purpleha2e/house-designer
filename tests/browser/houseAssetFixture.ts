import { Box3, Mesh, PerspectiveCamera, Scene, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { openHouseLightingLab } from '../../src/lightingLab/houseBridge'
import { prepareHouseGeometry } from '../../src/lightingLab/houseGeometry'
import { HouseLightingLab } from '../../src/lightingLab/houseEngine'

const asset = new URLSearchParams(location.search).get('asset') ?? 'frame'
const files: Record<string,string> = { frame:'panel_interior_door_open_low_detail', window:'window_large_single_pane', sofa:'sofa', corner:'corner_sofa' }
const model = (await new GLTFLoader().loadAsync(`/src/models/assets/${files[asset]}.glb`)).scene
if (asset === 'frame') model.traverse(object => { if (object instanceof Mesh) object.visible = /doorFrame/.test(object.name) })
const scene = new Scene(); scene.add(model); scene.updateMatrixWorld(true)
const box = new Box3().setFromObject(model), centre = box.getCenter(new Vector3()), size = box.getSize(new Vector3())
const camera = new PerspectiveCamera(45,innerWidth/innerHeight,.01,1000)
camera.position.copy(centre).add(new Vector3(size.x*.3,size.y*.1,Math.max(size.x,size.y,size.z)*1.8)); camera.lookAt(centre)
const input = { lights:[],sunDirection:[0,1,0],sunColour:[0,0,0],daylight:true }
const open = window.open; window.open = () => null
openHouseLightingLab(scene,camera,()=>input); window.open = open
const snapshot = window.houseLightingSource!.snapshot(), data = prepareHouseGeometry(snapshot.parts,()=>{})
const lab = new HouseLightingLab(document.querySelector<HTMLElement>('#viewport')!,snapshot,data)
Object.assign(window,{assetLab:lab,assetSnapshot:snapshot})
if (new URLSearchParams(location.search).has('baseline')) {
  const render=lab.renderer.render.bind(lab.renderer)
  // Diagnostic reference: reproduce the former point-sampled capture without
  // changing the lighting algorithm, geometry, materials or camera.
  lab.renderer.render=(scene,camera)=>{
    const material=(scene.children[0] as Mesh)?.material
    if(Array.isArray(material)&&'uniforms' in material[0]&&(material[0] as import('three').ShaderMaterial).uniforms.paddingPass?.value===1)return
    render(scene,camera)
  }
}
lab.setInput(input); await lab.start(()=>{},()=>{},()=>{})
