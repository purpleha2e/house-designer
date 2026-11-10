import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { colorPickSampleFrustum } from '../src/colorPickFrustum.ts'

for(const kind of ['perspective','orthographic'])test(`${kind} picker bounds include the complete pixel neighbourhood without changing the camera`,()=>{
  const camera=kind==='perspective'?new PerspectiveCamera(60,1.5,.1,100):new OrthographicCamera(-6,6,4,-4,.1,100)
  camera.position.set(3,4,5);camera.lookAt(0,0,0);camera.updateMatrixWorld(true)
  const before=camera.projectionMatrix.toArray(),world=camera.matrixWorld.toArray()
  for(const [x,y]of [[0,0],[899,599],[450,300],[700,180]]){
    const frustum=colorPickSampleFrustum(camera,900,600,{x,y,radiusX:4,radiusY:4})
    for(const dx of [-4,0,4])for(const dy of [-4,0,4]){
      const px=Math.max(0,Math.min(899,x+dx)),py=Math.max(0,Math.min(599,y+dy))
      assert.equal(frustum.containsPoint(new Vector3((px+.5)/900*2-1,(py+.5)/600*2-1,0).unproject(camera)),true)
    }
    const opposite=new Mesh(new BoxGeometry(.0001,.0001,.0001),new MeshBasicMaterial())
    opposite.position.copy(new Vector3(x<450?.9:-.9,y<300?.9:-.9,0).unproject(camera));opposite.updateMatrixWorld(true)
    assert.equal(frustum.intersectsObject(opposite),false)
    opposite.geometry.dispose();(opposite.material as MeshBasicMaterial).dispose()
  }
  assert.deepEqual(camera.projectionMatrix.toArray(),before);assert.deepEqual(camera.matrixWorld.toArray(),world)
})
