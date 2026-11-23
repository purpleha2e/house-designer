import assert from 'node:assert/strict'
import test from 'node:test'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Ray, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { HOUSE_TILE, prepareHouseGeometry, type HousePart } from '../src/lightingLab/houseGeometry.ts'
import { nextHouseTileBudget, selectHouseTiles } from '../src/lightingLab/houseScheduling.ts'
import { houseHistoryBlend, labHistoryBlend } from '../src/lightingLab/calibration.ts'

const part = (): HousePart => ({ position: new Float32Array([0,0,0, 1,0,0, 0,1,0]), ranges: [{start:0,count:3,material:0}], matrices: [new Matrix4().toArray()], structural:true })
test('House snapshot charts and BVH agree after mirrored world transforms', () => {
  const source = part(); source.matrices = [new Matrix4().makeScale(-1,1,1).setPosition(4,2,3).toArray()]
  const result = prepareHouseGeometry([source], () => {})
  assert.equal(result.cards.length,1)
  const geometry = new BufferGeometry().setAttribute('position',new BufferAttribute(result.position,3))
  const tree = MeshBVH.deserialize(result.tree,geometry)
  const hit = tree.raycastFirst(new Ray(new Vector3(3.8,2.2,4),new Vector3(0,0,-1)),DoubleSide)
  assert.ok(hit);assert.ok(Math.abs(hit.distance-1)<1e-6)
  assert.ok(result.chart.every(v=>v>=1.5&&v<=HOUSE_TILE-1.5))
  assert.deepEqual([...source.position],[0,0,0,1,0,0,0,1,0])
  geometry.dispose()
})
test('Opposite structural wall layers get distinct capture charts', () => {
  const source=part()
  source.position=new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,.2, 1,0,.2, 0,1,.2])
  source.ranges[0].count=6
  const result=prepareHouseGeometry([source],()=>{})
  assert.equal(result.cards.length,2)
  assert.notEqual(Math.floor(result.chart[0]/HOUSE_TILE),Math.floor(result.chart[6]/HOUSE_TILE))
  assert.equal(result.tree.index?.length,6)
})
test('Empty snapshots fail explicitly',()=>assert.throws(()=>prepareHouseGeometry([],()=>{}),/non-empty/))
test('Rotated door-frame rebates retain separate capture receivers',()=>{
  const source=part();source.structural=false;source.planarDetail=true
  source.position=new Float32Array([0,0,0,1,0,0,0,1,0,0,0,.2,1,0,.2,0,1,.2]);source.ranges[0].count=6
  source.matrices=[new Matrix4().makeRotationY(.7).toArray()]
  assert.equal(prepareHouseGeometry([source],()=>{}).cards.length,2)
})
test('Door-frame detail has a bounded chart cost while preserving every triangle',()=>{
  const source=part();source.structural=false;source.planarDetail=true
  source.position=new Float32Array(Array.from({length:40},(_,i)=>[0,0,i*.02,1,0,i*.02,0,1,i*.02]).flat())
  source.ranges[0].count=120
  const result=prepareHouseGeometry([source],()=>{})
  assert.ok(result.cards.length<=20)
  assert.equal(result.position.length,360)
  assert.equal(result.tree.index?.length,120)
})
test('Overlapping imported surfaces cannot share a distant receiver',()=>{
  const source=part();source.structural=false
  source.position=new Float32Array([0,0,0,1,0,0,0,1,0,0,0,.5,1,0,.5,0,1,.5]);source.ranges[0].count=6
  const result=prepareHouseGeometry([source],()=>{})
  assert.equal(result.cards.length,2)
})
test('Furniture reconstruction joins smooth vertices across chart seams, preserving hard edges',()=>{
  const source=part();source.structural=false
  source.position=new Float32Array([0,0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0,1]);source.ranges[0].count=6
  source.normal=new Float32Array(Array.from({length:6},()=>[Math.SQRT1_2,0,Math.SQRT1_2]).flat())
  const smooth=prepareHouseGeometry([source],()=>{})
  assert.notDeepEqual([...smooth.chart.slice(0,2)],[...smooth.chart.slice(6,8)])
  assert.deepEqual([...smooth.vertexLightChart.slice(0,2)],[...smooth.vertexLightChart.slice(6,8)])
  source.normal.set([1,0,0],9)
  const hard=prepareHouseGeometry([source],()=>{})
  assert.notDeepEqual([...hard.vertexLightChart.slice(0,2)],[...hard.vertexLightChart.slice(6,8)])
})
test('Back-side ceiling finishes become inward-facing transport receivers',()=>{
  const source=part();source.ranges[0].back=true;source.normal=new Float32Array([0,0,1,0,0,1,0,0,1])
  const result=prepareHouseGeometry([source],()=>{})
  assert.ok(result.normal[2]<-.99)
  const a=new Vector3().fromArray(result.position,0),b=new Vector3().fromArray(result.position,3),c=new Vector3().fromArray(result.position,6)
  assert.ok(b.sub(a).cross(c.sub(a)).z<0)
})
test('GPU work budget recovers from its minimum and respects its bounds',()=>{
  assert.equal(nextHouseTileBudget(1,.5),2)
  assert.equal(nextHouseTileBudget(1,30),1)
  assert.equal(nextHouseTileBudget(128,.5),128)
  assert.equal(nextHouseTileBudget(16,30),12)
  assert.equal(nextHouseTileBudget(8,NaN),8)
})
test('House bounce scheduling revisits nearby walls without starving distant fittings',()=>{
  const cards=Array.from({length:100},(_,i)=>({centre:i<4?[0,2,2]:[20,1,20],area:i<4?12:.01}))
  const updated=cards.map(()=>-100),counts=cards.map(()=>0)
  for(let frame=0;frame<500;frame++){
    const ids=selectHouseTiles(cards,updated,frame,[0,1,0],1,frame)
    assert.equal(ids.length,1);updated[ids[0]]=frame;counts[ids[0]]++
  }
  assert.ok(counts.every(count=>count>0),'Global slots still service every surface at a one-tile budget')
  assert.ok(Math.min(...counts.slice(0,4))>Math.max(...counts.slice(4))*10)
})
test('Temporal adaptation depends on surface updates, not elapsed display frames',()=>{
  assert.equal(labHistoryBlend(0),.35)
  assert.equal(labHistoryBlend(11),.35)
  assert.equal(labHistoryBlend(12),.06)
})

test('settled house lighting accumulates history but source edits regain a fast response',()=>{
  let oldWeight=1
  for(let update=0;update<12;update++)oldWeight*=1-houseHistoryBlend(update)
  assert.ok(oldWeight<.01,'a changed source must replace over 99% of old history within 12 surface updates')
  assert.ok(houseHistoryBlend(128)<.01,'settled surfaces must not inject large amounts of fresh noise')
  assert.ok(houseHistoryBlend(10000)>0,'lighting must keep responding to incoming bounce changes')
})

test('new lighting averages all startup samples and static scenes have no permanent noise floor',()=>{
  let value=0
  const samples=[1,0,0,0,0,0,0,0,0,0,0,0]
  samples.forEach((sample,i)=>{value+=(sample-value)*houseHistoryBlend(i,i)})
  assert.ok(Math.abs(value-1/12)<1e-12,'A rare first bright path must receive the same weight as every subsequent path')
  assert.ok(houseHistoryBlend(10000,10000)<houseHistoryBlend(1000,1000)*.11)
  assert.equal(houseHistoryBlend(0,2000),.35,'Changing a light must still promptly replace a mature history')
})
test('Initial room lighting does not wait for distant roofs and fittings',()=>{
  const cards=[{centre:[0,2,2],area:8},...Array.from({length:500},()=>({centre:[15,8,15],area:10000}))]
  const updated=cards.map(()=>0),counts=cards.map(()=>0)
  for(let frame=0;frame<120;frame++)for(const id of selectHouseTiles(cards,updated,frame,[0,1.5,0],1,frame)){updated[id]=frame;counts[id]++}
  assert.ok(counts[0]>10,'Nearby bounce must converge while distant geometry is still being prepared')
  assert.ok(counts.some(count=>count===0))
})
test('Continuous sloping surfaces do not need extra depth charts',()=>{
  const source=part();source.structural=false
  source.position=new Float32Array([0,0,0,2,0,0,2,2,1,0,0,0,2,2,1,0,2,1]);source.ranges[0].count=6
  assert.equal(prepareHouseGeometry([source],()=>{}).cards.length,1)
})
test('Nearby small furnishings receive an initial sample before repeated wall refinements',()=>{
  const cards=[{centre:[0,2,1],area:12},...Array.from({length:100},()=>({centre:[0,1,3],area:.001}))]
  const updated=cards.map(()=>-1)
  for(let frame=0;frame<40;frame++)for(const id of selectHouseTiles(cards,updated,frame,[0,1.5,0],4,frame*4))updated[id]=frame
  assert.ok(updated.every(value=>value>=0),'A visible fitting must not remain an unlit silhouette')
})

test('Camera-facing surfaces receive priority while offscreen surfaces still progress',()=>{
  const cards=Array.from({length:100},()=>({centre:[0,1,3],area:.1}))
  const updated=cards.map(()=>-1),inView=cards.map((_,i)=>i>=90),counts=cards.map(()=>0)
  for(let frame=0;frame<20;frame++)for(const id of selectHouseTiles(cards,updated,frame,[0,1.5,0],2,frame*2,inView)){updated[id]=frame;counts[id]++}
  assert.ok(updated.slice(90).every(value=>value>=0),'Every in-view fitting should be prepared promptly')
  assert.ok(updated.slice(0,90).some(value=>value<0),'Remote preparation must not block the view')
  assert.ok(counts.slice(0,90).some(value=>value>0),'Background maintenance continues')
})

test('Visible fittings beyond ten metres are not starved by hidden nearby geometry',()=>{
  const cards=[...Array.from({length:100},()=>({centre:[0,1,2],area:10})),{centre:[0,1,15],area:.01}]
  const updated=cards.map(()=>-1),inView=cards.map((_,i)=>i===100)
  const ids=selectHouseTiles(cards,updated,0,[0,1.5,0],2,0,inView)
  assert.ok(ids.includes(100),'A distant visible cooker must not remain black behind a nearby background sweep')
})

test('A visible hall receives bounce through nearby offscreen room surfaces before the whole house settles',()=>{
  const cards=[{centre:[0,1,1],area:8},...Array.from({length:79},()=>({centre:[0,1,2],area:.1})),
    {centre:[3,1,0],area:12},{centre:[3,0,0],area:12},
    ...Array.from({length:4000},()=>({centre:[20,7,20],area:.01}))]
  const updated=cards.map(()=>-1),counts=cards.map(()=>0),inView=cards.map((_,i)=>i<80)
  const light=cards.map(()=>0)
  for(let frame=0;frame<600;frame++){
    const ids=selectHouseTiles(cards,updated,frame,[0,1.5,0],4,frame*4,inView)
    for(const id of ids){
      if(id===0||id===80||id===81){const incoming=id===80?1:id===81?light[80]*.5:light[81]*.5;light[id]+=(incoming-light[id])*houseHistoryBlend(counts[id])}
      counts[id]++;updated[id]=frame
    }
  }
  assert.ok(counts[80]>20&&counts[81]>20,'Hidden walls and floors feeding the hall need repeated transport updates')
  assert.ok(light[0]>.2,'Two offscreen reflections must reach the visible hall without waiting for thousands of remote fittings')
})

test('A broad visible ceiling refines promptly even when its centre is across the room',()=>{
  const cards=[{centre:[8,2.4,0],area:64},...Array.from({length:80},()=>({centre:[1,1,1],area:.15})),
    ...Array.from({length:500},()=>({centre:[20,6,20],area:.01}))]
  const updated=cards.map(()=>-1),counts=cards.map(()=>0),inView=cards.map((_,i)=>i<81)
  for(let frame=0;frame<1200;frame++)for(const id of selectHouseTiles(cards,updated,frame,[0,1.6,0],1,frame,inView)){
    updated[id]=frame;counts[id]++
  }
  assert.ok(counts[0]>=60,'A screen-filling ceiling needs repeated estimates during the first twenty seconds')
  assert.ok(counts.slice(1,81).every(v=>v>0),'Visible fittings must still receive lighting')
  assert.ok(counts.slice(81).some(v=>v>0),'Background surfaces must still make progress')
})
