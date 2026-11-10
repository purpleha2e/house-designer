import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {BoxGeometry,Mesh,Vector3} from 'three'
import {barrierFixture,rebuildBarrierFixture} from './giBarrierFixtures.ts'
import {buildBarrierMetadata,barrierCellAt,barrierValid,independentBarrierRay,sampleBarrierField} from './giBarrierGeometry.ts'
export async function barrierDynamicRegressions(out='docs/gi-barrier-filtering'){
 mkdirSync(out,{recursive:true});const f=barrierFixture('doorway'),extras=[],results=[];let previous
 const box=(position,size)=>{const geometry=new BoxGeometry(...size),mesh=new Mesh(geometry,f.scene.children[0].material);mesh.position.fromArray(position);f.scene.add(mesh);extras.push({geometry,mesh});return mesh},bounds={min:[f.wallX-.55,0,0],max:[f.wallX+.65,2.8,4]},actors=[]
 const clear=()=>{for(const actor of actors)f.scene.remove(actor);actors.length=0}
 const wall=(x=f.wallX)=>actors.push(box([x,1.4,2],[.006,2.8,1.4]))
 const stages=[
  ['open doorway',()=>{}],['add wall',()=>wall()],['remove wall',()=>clear()],['move wall',()=>wall(f.wallX+.25)],
  ['add window',()=>{clear();for(const z of [1.425,2.575])actors.push(box([f.wallX+.25,1.4,z],[.006,2.8,.25]));actors.push(box([f.wallX+.25,.4,2],[.006,.8,.9]));actors.push(box([f.wallX+.25,2.6,2],[.006,.4,.9]))}],
  ['close window',()=>actors.push(box([f.wallX+.25,1.6,2],[.006,1.6,.9]))],['open doorway',()=>clear()],['close doorway',()=>wall()],
  ['move furniture',()=>{clear();actors.push(box([f.wallX-.2,.6,2],[.006,1.2,1.2]))}],
  ['add floor slab',()=>actors.push(box([2.5,1.5,2],[5.4,.006,4.4]))],['remove floor slab',()=>f.scene.remove(actors.pop())],
  ['stairwell opening',()=>{clear();for(const x of [.4,4.6])actors.push(box([x,1.5,2],[.8,.006,4.4]))}],
  ['move stairwell boundary',()=>{for(const actor of actors)actor.position.x+=.2}],
 ]
 try{
  for(const [name,edit]of stages){
   edit();const visibility=rebuildBarrierFixture(f),started=performance.now()
   try{
    const changes=/slab|stairwell/.test(name)?[{min:[-.3,1.4,-.3],max:[5.5,1.6,4.5]},bounds]:[bounds],current=await buildBarrierMetadata(f.field,visibility.snapshot(),{previous,changes}),fresh=await buildBarrierMetadata(f.field,visibility.snapshot()),axes=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],receivers=[]
    for(const y of [.016,1.4,1.49,1.51])for(const x of [f.wallX-.3,f.wallX-.004,f.wallX+.004,f.wallX+.18,f.wallX+.3]){
     const p=new Vector3(x,y,2)
     if(axes.some(a=>{const d=new Vector3().fromArray(a),hit=visibility.hit(p,d,10,.000001);return hit?.face&&hit.face.normal.dot(d)>.001}))continue
     const floorLayer=y<.08,normal=new Vector3(0,1,0)
     for(const mode of ['A','B']){
      const a=sampleBarrierField(f.field,current,p,normal,0,floorLayer,mode),b=sampleBarrierField(f.field,fresh,p,normal,0,floorLayer,mode)
      assert.deepEqual(a.rgb,b.rgb,`${name}/${mode} stale reconstruction`)
      for(const tap of a.taps){if(!tap.weight)continue;const expected=independentBarrierRay(visibility.snapshot(),p.toArray(),tap.position),cell=barrierCellAt(f.field,p,0,floorLayer);assert.equal(barrierValid(current.cells.get(cell.index),p.toArray(),tap.position,mode),expected,`${name}/${mode} stale/invalid segment`)}
      receivers.push({mode,point:p.toArray(),rgb:a.rgb})
     }
    }
    assert.equal(current.a.bytes,fresh.a.bytes,'canonical geometry reuse must not accumulate triangle copies');assert.equal(current.b.bytes,fresh.b.bytes)
    results.push({name,elapsedMs:performance.now()-started,statistics:current.statistics,freshStatistics:fresh.statistics,receivers});previous=current;console.log('PASS EDIT',name,'reused',current.statistics.reused,'queried',current.statistics.queried)
   }finally{visibility.dispose()}
  }
  writeFileSync(`${out}/dynamic.json`,JSON.stringify(results,null,2));return results
 }finally{f.dispose();for(const e of extras)e.geometry.dispose()}
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/giBarrierDynamic.mjs'))await barrierDynamicRegressions(process.argv[2])
