import { BoxGeometry, Color, DataTexture, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, Scene } from 'three'
import { openHouseLightingLab } from '../../src/lightingLab/houseBridge'
import { createHouseReferenceScene } from '../../src/lightingLab/houseReferenceScene'
const scene=new Scene(),camera=new PerspectiveCamera();scene.background=new Color('#99bbdd')
const glass=new Mesh(new BoxGeometry(1,1,.01),new MeshPhysicalMaterial({transmission:1}));glass.userData.exteriorSkyReceiver=true;glass.name='window'
const frame=new Mesh(new BoxGeometry(2,2,.1),new MeshStandardMaterial({roughness:.25}));frame.name='frame'
const ground=new Mesh(new BoxGeometry(3,.01,3),new MeshBasicMaterial({map:new DataTexture(new Uint8Array([30,100,40,255]),1,1)}));ground.userData.houseDesignerRole='ground-image';ground.name='outside'
const sky=new Mesh(new BoxGeometry(5,5,5),new MeshBasicMaterial({map:new DataTexture(new Uint8Array([100,180,250,255]),1,1)}));sky.userData.houseDesignerRole='skybox'
scene.add(glass,frame,ground,sky)
const originalOpen=window.open;window.open=()=>null
openHouseLightingLab(scene,camera,()=>({daylight:true,lights:[],sunColour:[1,.9,.8],sunDirection:[1,2,3]}));window.open=originalOpen
const bridge=window.houseLightingSource!,legacy=bridge.snapshot({prototypeDaylight:true}),exterior=bridge.snapshot({prototypeDaylight:true,referenceExterior:true})
const reference=createHouseReferenceScene(exterior,bridge.lighting(),false)
Object.assign(window,{exteriorResult:{legacyEmitters:legacy.finishes.filter(f=>f.daylightEmitter).length,legacyGround:legacy.parts.some(p=>p.name?.includes('outside')),exteriorEmitters:exterior.finishes.filter(f=>f.daylightEmitter).length,glass:exterior.finishes.filter(f=>f.glazing).length,ground:exterior.parts.some(p=>p.name?.includes('outside')),skyGeometry:exterior.parts.some(p=>p.name?.includes('skybox')),backgroundMatches:exterior.exterior?.background===(sky.material as MeshBasicMaterial).map,prototype:exterior.prototypeDaylight,authoredRoughness:exterior.finishes.find(f=>f.referenceMaterial?.roughness===.25)?.referenceMaterial?.roughness,referenceTriangles:reference.triangles}})
reference.dispose()
