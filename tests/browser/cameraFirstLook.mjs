import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'

const b = await lightingBrowser()
try {
  await b.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/roofWallRegression.html?lighting-startup&basic-scene&opaque-materials` })
  await b.wait('window.basicSceneReport?.gpuCompleteMs !== undefined')
  await b.evaluate(`(async()=>{const {Euler}=await import('/node_modules/.vite/deps/three.js'),s=roofWallScene();
    s.camera.rotation.order='XYZ';s.camera.quaternion.setFromEuler(new Euler(-.25,2.4,0,'YXZ'));s.camera.updateMatrixWorld();
    window.loadedOrientation=s.camera.quaternion.clone();s.invalidate()})()`)
  await b.call('Input.dispatchMouseEvent', { type:'mouseMoved', x:500, y:400 })
  await b.call('Input.dispatchMouseEvent', { type:'mousePressed', x:500, y:400, button:'right', buttons:2, clickCount:1 })
  await b.wait('document.pointerLockElement===roofWallScene().gl.domElement', 10000)
  const result = await b.evaluate(`(()=>{document.dispatchEvent(new MouseEvent('mousemove',{movementX:0,movementY:0,bubbles:true}));
    document.dispatchEvent(new MouseEvent('mousemove',{movementX:2,movementY:1,bubbles:true}));
    const c=roofWallScene().camera;return{angle:loadedOrientation.angleTo(c.quaternion),pitch:c.rotation.x,yaw:c.rotation.y,order:c.rotation.order}})()`)
  assert.equal(result.order, 'YXZ')
  assert.ok(result.angle > 0 && result.angle < .02, 'small first mouse motion must not flip the restored camera')
  assert.ok(Math.abs(result.pitch + .25) < .01)
  assert.ok(Math.abs(result.yaw - 2.4) < .01)
  await b.evaluate('document.exitPointerLock()')
  assert.deepEqual(b.errors, [])
  console.log('PASS first mouse look preserves loaded view', JSON.stringify(result))
} finally { b.close() }
