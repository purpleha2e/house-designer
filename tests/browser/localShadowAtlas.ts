import { BoxGeometry, DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, SphereGeometry, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { createLocalShadowAtlas, localShadowAtlasGLSL } from '../../src/localShadowAtlas'
import { shadowSceneSteps } from '../../src/components/useLocalShadowAtlas'

const renderer = new WebGLRenderer(), scene = new Scene()
renderer.setPixelRatio(Number(new URLSearchParams(location.search).get('dpr') ?? 1))
renderer.setSize(400, 200); document.body.appendChild(renderer.domElement)
const axes = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
for (const axis of axes) {
  const box = new Mesh(new BoxGeometry(.6, .6, .6), new MeshBasicMaterial())
  box.position.fromArray(axis).multiplyScalar(2); scene.add(box)
}
scene.updateMatrixWorld(true)
const point = { id: 'point', kind: 'point' as const, position: [0,0,0], target: [0,-1,0], distance: 10, angle: Math.PI/4 }
const atlas = createLocalShadowAtlas([point, { ...point, id: 'spot', kind: 'spot' }], renderer.capabilities.maxTextureSize, 128)
while (atlas.renderNext(renderer, scene)) { /* Render all seven projections. */ }
const uniforms = {
  hdLocalShadowAtlas: { value: atlas.target.texture }, hdLocalShadowData: { value: atlas.metadata },
  hdLocalShadowAtlasSize: { value: new Vector2(atlas.layout.width, atlas.layout.height) },
  hdLocalShadowDataRows: { value: atlas.metadata.image.height }, hdLocalShadowAtlasEnabled: { value: 1 },
  hdLocalShadowRasterSteps: { value: 2 ** renderer.getContext().getParameter(renderer.getContext().SUBPIXEL_BITS) },
  receiver: { value: new Vector3() }, lightIndex: { value: 0 },
  receiverNormal: { value: new Vector3() },
}
const material = new ShaderMaterial({ uniforms,
  vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
  fragmentShader: `#define HD_ROOM_LIGHT_CAPACITY 11\n${localShadowAtlasGLSL}\nuniform vec3 receiver;uniform vec3 receiverNormal;uniform float lightIndex;void main(){float v=hdLocalAtlasVisibility(lightIndex,receiver,receiverNormal);gl_FragColor=vec4(vec3(v),1.0);}`,
})
const display = new Scene(); display.add(new Mesh(new PlaneGeometry(2,2), material))
const result = new WebGLRenderTarget(4,4), camera = new OrthographicCamera(), pixels = new Uint8Array(64)
const sample = (position: number[], index=0) => {
  uniforms.receiver.value.fromArray(position); uniforms.lightIndex.value=index
  renderer.setRenderTarget(result); renderer.render(display,camera); renderer.readRenderTargetPixels(result,0,0,4,4,pixels)
  return pixels[20]/255
}
const blocked = axes.map(axis=>sample(axis.map(x=>x*3)))
const clear = axes.map(axis=>sample(axis))
const spotlight = [sample([0,-3,0],1), sample([0,-1,0],1), sample([3,0,0],1)]
const diagonal = sample([3,3,3])

function capture(source: Scene, position: number[]) {
  const steps = shadowSceneSteps(source)
  let next = steps.next(); while (!next.done) next = steps.next()
  const frozen = next.value
  const shadows = createLocalShadowAtlas([{ ...point, position, distance: 30 }], renderer.capabilities.maxTextureSize, 512)
  while (shadows.renderNext(renderer, frozen.scene, true)) { /* use production caster sidedness */ }
  frozen.dispose()
  uniforms.hdLocalShadowAtlas.value = shadows.target.texture
  uniforms.hdLocalShadowData.value = shadows.metadata
  uniforms.hdLocalShadowAtlasSize.value.set(shadows.layout.width, shadows.layout.height)
  uniforms.hdLocalShadowDataRows.value = shadows.metadata.image.height
  return shadows
}

const surfaceMaterial = new ShaderMaterial({ uniforms: { ...uniforms, sourcePosition: { value: new Vector3() } }, side: DoubleSide,
  vertexShader: 'varying vec3 worldPosition;varying vec3 worldNormal;void main(){vec4 p=modelMatrix*vec4(position,1.0);worldPosition=p.xyz;worldNormal=mat3(modelMatrix)*normal;gl_Position=projectionMatrix*viewMatrix*p;}',
  fragmentShader: `#define HD_ROOM_LIGHT_CAPACITY 11\n${localShadowAtlasGLSL}\nvarying vec3 worldPosition;varying vec3 worldNormal;uniform vec3 sourcePosition;
  void main(){vec3 n=normalize(cross(dFdx(worldPosition),dFdy(worldPosition)));if(dot(n,worldNormal)<0.0)n=-n;
  if(dot(n,normalize(sourcePosition-worldPosition))<.005)discard;
  float v=hdLocalAtlasVisibility(0.0,worldPosition,n);gl_FragColor=vec4(vec3(v),1.0);}`,
})
const surfaceTarget = new WebGLRenderTarget(256,256)
function selfShadow(name: string, mesh: Mesh, light: number[], eye: number[], look: number[]) {
  const source = new Scene(); source.add(mesh)
  const shadows = capture(source, light), original = mesh.material
  mesh.material = surfaceMaterial; surfaceMaterial.uniforms.sourcePosition.value.fromArray(light)
  const camera = new PerspectiveCamera(45,1,.05,40);camera.position.fromArray(eye);camera.lookAt(new Vector3().fromArray(look))
  renderer.setRenderTarget(surfaceTarget);renderer.setClearColor(0,0);renderer.clear();renderer.render(source,camera)
  const data = new Uint8Array(256*256*4);renderer.readRenderTargetPixels(surfaceTarget,0,0,256,256,data)
  let coverage=0,dark=0,total=0,minimum=255
  for(let i=0;i<data.length;i+=4)if(data[i+3]){coverage++;total+=data[i];minimum=Math.min(minimum,data[i]);if(data[i]<250)dark++}
  mesh.material=original;shadows.dispose()
  return {name,coverage,darkFraction:dark/coverage,mean:total/coverage/255,minimum:minimum/255}
}
const plane = new Mesh(new PlaneGeometry(8,8),new MeshStandardMaterial({side:DoubleSide}));plane.rotation.x=-Math.PI/2
const wall = new Mesh(new BoxGeometry(6,4,.1),new MeshStandardMaterial());wall.position.y=2
const sphere = new Mesh(new SphereGeometry(1,24,16),new MeshStandardMaterial({side:DoubleSide}));sphere.position.y=1
const surfaces = [
  selfShadow('grazing double-sided floor',plane,[4,.25,1],[3,5,6],[0,0,0]),
  selfShadow('solid wall',wall,[3,2,.15],[4,3,6],[0,2,0]),
  selfShadow('smooth double-sided furniture',sphere,[3,4,4],[0,3,7],[0,1,0]),
]
const contactScene = new Scene(), floor = new Mesh(new PlaneGeometry(8,8),new MeshStandardMaterial({side:DoubleSide}))
floor.rotation.x=-Math.PI/2;contactScene.add(floor)
const thin = new Mesh(new BoxGeometry(.035,.2,.8),new MeshStandardMaterial());thin.position.y=.1;contactScene.add(thin)
const contactAtlas = capture(contactScene,[-2,2,0])
uniforms.receiverNormal.value.set(0,1,0)
const contact = [.025,.03,.05,.12].map(x=>sample([x,0,0]))
const clearFloor = [-.1,.4,1].map(x=>sample([x,0,0]))
contactAtlas.dispose()
const sheetScene = new Scene();sheetScene.add(new Mesh(new PlaneGeometry(2,2),new MeshStandardMaterial({side:DoubleSide})))
const sheetAtlas = capture(sheetScene,[0,0,2]);uniforms.receiverNormal.value.set(0,0,0)
const thinSheet = sample([0,0,-1]);sheetAtlas.dispose()
// A closed blocker must cast a continuous shadow across all twelve cube-face
// edges and eight corners, including when receiver bias crosses a face edge.
const seamScene = new Scene();seamScene.add(new Mesh(new BoxGeometry(2,2,2),new MeshStandardMaterial()))
const seamAtlas = capture(seamScene,[0,0,0])
const seams: {position:number[];normal:number[];visibility:number}[] = []
for(let first=0;first<3;first++)for(let second=first+1;second<3;second++){
  for(const signA of [-1,1])for(const signB of [-1,1])for(const delta of [-.002,0,.002]){
    const position=[0,0,0];position[first]=signA*3;position[second]=signB*(3+delta)
    for(const axis of [first,second]){
      const normal=[0,0,0];normal[axis]=-Math.sign(position[axis]);uniforms.receiverNormal.value.fromArray(normal)
      seams.push({position,normal,visibility:sample(position)})
    }
  }
}
for(const x of [-3,3])for(const y of [-3,3])for(const z of [-3,3])for(let axis=0;axis<3;axis++){
  const position=[x,y,z],normal=[0,0,0];normal[axis]=-Math.sign(position[axis]);uniforms.receiverNormal.value.fromArray(normal)
  seams.push({position,normal,visibility:sample(position)})
}
seamAtlas.dispose()
Object.assign(window, { atlasGPUResult: { blocked, clear, spotlight, diagonal, surfaces, contact, clearFloor, thinSheet, seams, error:renderer.getContext().getError(), maxTextures:renderer.capabilities.maxTextures } })
