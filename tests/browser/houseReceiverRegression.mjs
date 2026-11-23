import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
const b = await lightingBrowser()
try {
  await b.call('Page.navigate', { url: 'http://127.0.0.1:5188/tests/browser/houseReceiverFixture.html' })
  await b.wait('window.receiverReady')
  const result = await b.evaluate(`(async()=>{
    const l=receiverLab,d=l.data,p=new Float32Array(16*16*4);
    await l.renderer.readRenderTargetPixelsAsync(l.gbuffer,0,0,16,16,p);
    const covered=[];for(let at=0;at<p.length;at+=4)if(p[at+3]>.5)covered.push([...p.subarray(at,at+3)]);
    const {Vector3,Ray,DoubleSide,BufferGeometry,BufferAttribute}=await import('/node_modules/three/build/three.module.js');
    const {MeshBVH}=await import('/node_modules/three-mesh-bvh/src/index.js');
    const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(d.position,3));
    const tree=MeshBVH.deserialize(d.tree,geometry);
    const wall=tree.raycastFirst(new Ray(new Vector3(3,2,2),new Vector3(1,0,0)),DoubleSide);
    let blocked=0;for(const point of covered)for(let i=0;i<16;i++){
      const a=(i+.5)/16,angle=i*2.399963,direction=new Vector3(Math.sqrt(a)*Math.cos(angle),-Math.sqrt(1-a),Math.sqrt(a)*Math.sin(angle));
      const hit=tree.raycastFirst(new Ray(new Vector3(...point).add(new Vector3(0,-.012,0)),direction),DoubleSide);
      if(hit&&hit.face.normal.dot(direction)>0)blocked++;
    }
    geometry.dispose();return {covered,blocked,wallDistance:wall.distance};
  })()`)
  assert.ok(result.covered.length > 100)
  assert.ok(result.covered.every(p => p[0] < 4 && p[2] < 4), 'All edge and corner receivers must be outside the wall solids')
  assert.ok(result.covered.every(p => Math.abs(p[1] - 2.4) < 1e-5), 'Relocation must stay on the ceiling plane')
  assert.ok(result.covered.some(p => p[0] > 3.95 && p[2] > 3.95), 'The corner must retain a local receiver, not borrow distant light')
  assert.equal(result.blocked, 0, 'Repaired receivers must not see back faces from inside a wall')
  assert.ok(Math.abs(result.wallDistance - 1) < 1e-5, 'Transport walls must remain opaque and in their original positions')
  assert.deepEqual(b.errors, [])
  console.log(JSON.stringify({ receivers: result.covered.length, blocked: result.blocked, wallDistance: result.wallDistance }))
} finally { b.close() }
