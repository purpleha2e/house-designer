import fs from 'node:fs'
import * as THREE from 'three'
const northwest=process.argv.includes('--northwest')
const v=JSON.parse(fs.readFileSync(northwest?'.tmp-roof-junction-northwest-view.json':'.tmp-roof-junction-view.json'))
const cam=new THREE.PerspectiveCamera()
cam.projectionMatrix.fromArray(v.projection)
cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()
cam.matrixWorld.fromArray(v.world)
cam.matrixWorldInverse.fromArray(v.inverse)
const meshes=JSON.parse(fs.readFileSync('.tmp-roof-junction-geometry.json')).filter(o=>!o.role?.includes('pick')).map(o=>{
const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(o.positions,3));if(o.indices)g.setIndex(o.indices)
const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));m.matrixWorld.fromArray(o.matrix);m.userData=o;return m})
for(const [x,y] of northwest?[[270,438],[265,442],[275,438],[283,437]]:[[522,525],[525,518],[523,533],[511,531],[530,510]]){
const r=new THREE.Raycaster();r.setFromCamera(new THREE.Vector2(x/v.bounds.width*2-1,1-y/v.bounds.height*2),cam)
console.log(x,y,JSON.stringify(r.intersectObjects(meshes).slice(0,3).map(h=>({p:h.point.toArray(),data:h.object.userData.userData,role:h.object.userData.role}))))}
