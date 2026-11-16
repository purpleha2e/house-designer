import { AmbientLight, BoxGeometry, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PointLight, Scene, SpotLight, WebGLRenderer, WebGLRenderTarget } from 'three'
import { applyRoomLightShader, createRoomLightShaderUniforms, createRoomLightMaskTexture } from '../../src/roomLightShader'
import { createRoomLightMask } from '../../src/roomLightMask'
import { createIndirectField } from '../../src/indirectLighting'
import { applyIndirectLightingShader, createIndirectUniforms, enableExteriorSkyMaterial } from '../../src/indirectLightingShader'
import { installNonBlockingShaderDiagnostics } from '../../src/shaderDiagnostics'

const renderer=new WebGLRenderer(),scene=new Scene(),camera=new PerspectiveCamera(),geometry=new BoxGeometry(),target=new WebGLRenderTarget(1,1)
renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFShadowMap
installNonBlockingShaderDiagnostics(renderer);renderer.setRenderTarget(target)
const sun=new DirectionalLight();sun.castShadow=true;scene.add(sun,new AmbientLight(),new HemisphereLight())
for(let i=0;i<8;i++)scene.add(new PointLight(0xffffff,0))
for(let i=0;i<4;i++)scene.add(new SpotLight(0xffffff,0))
const field=createIndirectField([]),indirect=createIndirectUniforms(field);indirect.hdExteriorSkyFeature.value=1
const mask=createRoomLightMaskTexture(createRoomLightMask([],{minX:0,minZ:0,size:1},1)),room=createRoomLightShaderUniforms(mask)
const mesh=new Mesh(geometry);mesh.receiveShadow=true;mesh.castShadow=true;scene.add(mesh)
const results:unknown[]=[];Object.assign(window,{shaderCompileCost:results})
// One representative material per path, in the same light configuration.
// This is a diagnostic benchmark; the app latency regressions enforce budgets.
for(const mode of ['legacy', 'atlas-only', 'no-room', 'no-gi', 'no-exterior']) {
 room.atlasOnly=mode!=='legacy'
 const material=new MeshStandardMaterial()
 if(mode!=='no-room')applyRoomLightShader(material,room)
 if(mode!=='no-gi'){applyIndirectLightingShader(material,indirect);if(mode!=='no-exterior')enableExteriorSkyMaterial(material)}
 mesh.material=material;const at=performance.now()
 await renderer.compileAsync(scene,camera)
 results.push({mode,ms:performance.now()-at})
}
Object.assign(window,{shaderCompileCostDone:true})
renderer.dispose();field.dispose();mask.dispose();geometry.dispose();target.dispose()
