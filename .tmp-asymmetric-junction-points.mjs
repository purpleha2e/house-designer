import {readFileSync} from 'node:fs'
import {PerspectiveCamera,BufferGeometry,Float32BufferAttribute,Mesh,MeshBasicMaterial,DoubleSide,Matrix4,Raycaster,Vector2} from 'three'
const v=JSON.parse(readFileSync('.tmp-roof-junction-view.json','utf8')),camera=new PerspectiveCamera()
camera.projectionMatrix.fromArray(v.projection);camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();camera.matrixWorld.fromArray(v.world);camera.matrixWorldInverse.fromArray(v.inverse)
const data=JSON.parse(readFileSync('.tmp-roof-junction-geometry.json','utf8')),meshes=data.filter(o=>!o.role.includes('pick')).map(o=>{const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(o.positions,3));const m=new Mesh(g,new MeshBasicMaterial({side:DoubleSide}));m.applyMatrix4(new Matrix4().fromArray(o.matrix));m.userData=o.userData;m.updateMatrixWorld();return m})
console.log(v.bounds)
for(const [x,y]of [[520,529],[520,500],[535,490],[515,428],[600,330],[530,440]]){const ray=new Raycaster();ray.setFromCamera(new Vector2((x-v.bounds.x)/v.bounds.width*2-1,1-(y-v.bounds.y)/v.bounds.height*2),camera);console.log('hit',x,y,ray.intersectObjects(meshes).slice(0,2).map(h=>({data:h.object.userData,point:h.point.toArray()})))}
