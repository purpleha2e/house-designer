import {readFileSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Vector3,Box3} from 'three'
import {restoreIndirectVisibility} from '../src/indirectVisibility.ts'
const dir=process.argv[2]??'docs/colin-contact-fix/iteration-10',models=JSON.parse(readFileSync(`${dir}/models.json`)),sofa=models.find(m=>m.name.endsWith('8911c06a')),target=new Vector3().fromArray(JSON.parse(readFileSync('docs/colin-contact-shading/reference.json')).results[0].position),raw=gunzipSync(readFileSync('docs/colin-contact-fix/baseline/geometry.f32.gz')),visibility=restoreIndirectVisibility({positions:new Float32Array(raw.buffer,raw.byteOffset,raw.length/4),tree:null}),regular=JSON.parse(readFileSync('docs/gi-spatial-accuracy/baseline/field-cache.json')).layout.probes.filter(p=>!p.kind),box=new Box3(new Vector3().fromArray(sofa.min),new Vector3().fromArray(sofa.max)),directions=[]
for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)if(x||y||z)directions.push(new Vector3(x,y,z).normalize())
const clear=(p,q)=>{const d=q.clone().sub(p),distance=d.length();return !visibility.occluded(p,d.divideScalar(distance),distance-.0002,.0001)}
try{
 const seeds=sofa.seeds.map(s=>({...s,d:new Vector3().fromArray(s.receiver??s.position).distanceTo(target)})).sort((a,b)=>a.d-b.d).slice(0,24).map(s=>{
  const p=new Vector3().fromArray(s.position),r=new Vector3().fromArray(s.receiver??s.position).addScaledVector(new Vector3().fromArray(s.normal??[0,0,0]),.001),axes=directions.filter(d=>Math.abs(d.x)+Math.abs(d.y)+Math.abs(d.z)===1),hits=axes.map(axis=>visibility.hit(p,axis,2,.0001))
  const closestRegular=regular.map(q=>({position:q.position,d:new Vector3().fromArray(q.position).distanceTo(p)})).filter(q=>clear(new Vector3().fromArray(q.position),p)).sort((a,b)=>a.d-b.d)[0];return{...s,closestRegular,clearance:Math.min(...hits.map(h=>h?.distance??2)),closedExits:hits.filter((h,i)=>h?.face?.normal.dot(axes[i])>.01).length,regularVisible:regular.some(q=>new Vector3().fromArray(q.position).distanceTo(r)<3.5&&clear(new Vector3().fromArray(q.position),r)),escapes:directions.filter(axis=>{const h=visibility.hit(r,axis,3,.0001);return !h||!box.containsPoint(h.point)}).length,visibleToTarget:clear(p,target.clone().addScaledVector(new Vector3(.231445,.396484,-.888306).normalize(),.001))}
 })
 writeFileSync(`${dir}/contact-seeds.json`,JSON.stringify(seeds,null,2));for(const s of seeds.slice(0,12))console.log(JSON.stringify({d:s.d,p:s.position,gap:s.gap,closestRegular:s.closestRegular,clearance:s.clearance,regular:s.regularVisible,escapes:s.escapes,visible:s.visibleToTarget,closed:s.closedExits}))
}finally{visibility.dispose()}
