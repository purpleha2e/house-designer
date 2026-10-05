import {readFileSync} from 'node:fs'
import * as T from 'three'
const objects=JSON.parse(readFileSync('.tmp-roof-junction-geometry.json')).filter(o=>['roof-infill','roof-top','roof-eaves','wall-engine-render'].includes(o.role)).map(o=>{
const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(o.positions,3));if(o.indices)g.setIndex(o.indices);
const m=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));m.matrixWorld.fromArray(o.matrix);m.userData=o.userData;return m})
const ray=(origin,direction,role)=>new T.Raycaster(new T.Vector3(...origin),new T.Vector3(...direction)).intersectObjects(objects.filter(o=>!role||o.userData.houseDesignerRole===role)).slice(0,3).map(h=>({p:h.point.toArray(),...h.object.userData}))
for(const z of [11.3,11.4,11.5,11.6,11.65,11.7])for(const y of [4.8,5.0,5.1,5.2])console.log(z,y,JSON.stringify(ray([6.65,y,z],[-1,0,0]).slice(0,1)))
