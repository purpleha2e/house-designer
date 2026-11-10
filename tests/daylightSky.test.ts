import test from 'node:test'
import assert from 'node:assert/strict'
import {BoxGeometry,Group,Mesh,MeshPhysicalMaterial,MeshStandardMaterial,Scene,Vector3} from 'three'
import {daylightSkyRadiance,createDaylightSky} from '../src/daylightSky.ts'
import {snapshotIndirectGeometry} from '../src/indirectVisibility.ts'
import {createIndirectCaptureScene} from '../src/indirectCaptureScene.ts'
test('directional sky preserves its upper-hemisphere mean and reflects a bounded ground budget',()=>{
  for(const mode of ['clear','overcast'] as const){
    const sum=new Vector3();for(let i=0;i<1000;i++){const y=(i+.5)/1000;sum.add(daylightSkyRadiance(new Vector3(Math.sqrt(1-y*y),y,0),mode))}sum.divideScalar(1000)
    assert.ok(sum.distanceTo(new Vector3(.65,.72,.82))<.000001)
    assert.ok(daylightSkyRadiance(new Vector3(0,1,0),mode).x>daylightSkyRadiance(new Vector3(1,0,0),mode).x)
    const down=daylightSkyRadiance(new Vector3(0,-1,0),mode)
    assert.ok(down.x>0&&down.x<.2)
    assert.deepEqual(daylightSkyRadiance(new Vector3(0,1,0),mode,0).toArray(),[0,0,0])
  }
  const sky=createDaylightSky();sky.update('overcast',1);assert.equal(sky.texture.images.length,6);sky.dispose()
})
test('hidden objects and physical clear glazing have matching raster and ray visibility',()=>{
  const scene=new Scene(),geometry=new BoxGeometry(),opaque=new MeshStandardMaterial(),glass=new MeshPhysicalMaterial({transmission:1,transparent:false}),hidden=new Group();hidden.visible=false
  hidden.add(new Mesh(geometry,opaque));scene.add(hidden,new Mesh(geometry,glass),new Mesh(geometry,opaque))
  const parts=snapshotIndirectGeometry(scene),capture=createIndirectCaptureScene(scene,false)
  assert.equal(parts.length,1,'only the visible opaque mesh belongs to the BVH')
  const visible:Mesh[]=[];capture.scene.traverse(o=>{if(o instanceof Mesh&&(o.material as MeshStandardMaterial).visible)visible.push(o)})
  assert.equal(visible.length,1,'raster and BVH coverage agree even for unnamed physical glazing')
  capture.dispose();geometry.dispose();opaque.dispose();glass.dispose()
})


test('sky intensity scales upper sky and sky-reflected ground once while preserving solar ground', () => {
  for (const mode of ['clear', 'overcast'] as const) for (const direction of [new Vector3(0,1,0), new Vector3(1,0,0), new Vector3(0,-1,0)]) {
    const solar = daylightSkyRadiance(direction, mode, 0, new Vector3(2.7,2.5,2.3))
    const sky = daylightSkyRadiance(direction, mode, 1, new Vector3())
    for (const strength of [0,.5,1,1.5,2,3]) {
      assert.ok(daylightSkyRadiance(direction, mode, strength, new Vector3(2.7,2.5,2.3)).distanceTo(sky.clone().multiplyScalar(strength).add(solar)) < 1e-10)
    }
    if (direction.y < 0) assert.ok(solar.x > 0)
  }
})
