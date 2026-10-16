import { Box3, BoxGeometry, Color, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Scene, Vector3, type Camera, type Object3D, type WebGLRenderer } from 'three'
import { isSelectionDecoration } from './shaderWarmup.ts'
import { yieldToViewport } from './viewportScheduling.ts'

/** A cheap spatial preview gives camera input visible feedback on a cold load,
 * before the first full scene has finished preparing its materials and buffers. */
export async function prepareInitialViewportPreview(source: Scene, renderer: WebGLRenderer, camera: Camera, cancelled: () => boolean) {
  await yieldToViewport()
  if(cancelled())return undefined
  source.updateMatrixWorld(true)
  const objects: Object3D[]=[],boxes: Box3[]=[],bounds=new Box3()
  source.traverseVisible(object=>{
    if(isSelectionDecoration(object)||object.userData.houseDesignerRole==='model-batch')return
    if(object.name.startsWith('model-transform-')){objects.push(object);return}
    if(!(object instanceof Mesh))return
    for(let parent=object.parent;parent;parent=parent.parent)if(parent.name.startsWith('model-transform-'))return
    if(!(Array.isArray(object.material)?object.material:[object.material]).some(material=>material.visible&&material.opacity>0))return
    objects.push(object)
  })
  let start=performance.now()
  for(const object of objects){
    if(performance.now()-start>3){await yieldToViewport();if(cancelled())return undefined;start=performance.now()}
    bounds.setFromObject(object)
    if(!bounds.isEmpty()&&bounds.min.toArray().every(Number.isFinite)&&bounds.max.toArray().every(Number.isFinite))boxes.push(bounds.clone())
  }
  const scene=new Scene(),geometry=new BoxGeometry(1,1,1),material=new MeshBasicMaterial({color:0x43576c,wireframe:true,toneMapped:false})
  scene.background=source.background instanceof Color?source.background.clone():new Color(0xcbd5e1)
  const mesh=new InstancedMesh(geometry,material,boxes.length),matrix=new Matrix4(),size=new Vector3(),centre=new Vector3()
  for(let i=0;i<boxes.length;i++){
    boxes[i].getSize(size);boxes[i].getCenter(centre)
    matrix.makeScale(Math.max(.005,size.x),Math.max(.005,size.y),Math.max(.005,size.z));matrix.setPosition(centre);mesh.setMatrixAt(i,matrix)
  }
  mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;scene.add(mesh);scene.userData.initialViewportPreview=true
  const dispose=()=>{mesh.dispose();geometry.dispose();material.dispose();scene.clear()}
  const shadows=renderer.shadowMap.enabled
  let pending: Promise<unknown>
  try{renderer.shadowMap.enabled=false;pending=renderer.compileAsync(scene,camera)}finally{renderer.shadowMap.enabled=shadows}
  try{await pending;if(cancelled()){dispose();return undefined}return{scene,dispose}}
  catch(error){dispose();throw error}
}
