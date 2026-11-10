import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

const browser = await lightingBrowser()
const port = process.argv[2] ?? '5180'
const output = 'tmp/skirting-batching'
mkdirSync(output, { recursive: true })
const reports = []
try {
  for (const [name, query, expected] of [
    ['whole-house', 'colin', 2],
    ['ground-floor', 'colin&edit-floor&ground', 1],
    ['upper-floor', 'colin&edit-floor&upper-selection', 1],
  ]) {
    await browser.call('Page.navigate', {
      url: `http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?${query}&basic-scene`,
    })
    await browser.wait('window.basicSceneReport?.gpuCompleteMs !== undefined')
    const report = await browser.evaluate(`(async () => {
      const { Scene, Mesh, MeshBasicMaterial, WebGLRenderTarget } = await import('/node_modules/.vite/deps/three.js')
      const { scene, camera, gl } = roofWallScene()
      scene.updateMatrixWorld(true)
      const meshes = []
      scene.traverseVisible(object => { if (object.userData.houseDesignerRole === 'skirting') meshes.push(object) })
      const metadata = meshes.map(mesh => ({
        floorId: mesh.userData.floorId, materialKey: mesh.userData.materialKey,
        indexed: !!mesh.geometry.index, vertices: mesh.geometry.attributes.position.count,
        indices: mesh.geometry.index?.count, groups: mesh.geometry.groups.length,
        singleMaterial: !Array.isArray(mesh.material),
      }))
      const isolated = new Scene(), material = new MeshBasicMaterial(), target = new WebGLRenderTarget(64, 64)
      for (const source of meshes) {
        const mesh = new Mesh(source.geometry, material)
        mesh.matrixAutoUpdate = false; mesh.matrix.copy(source.matrixWorld); mesh.frustumCulled = false
        isolated.add(mesh)
      }
      const previousTarget = gl.getRenderTarget(), autoReset = gl.info.autoReset
      const context = gl.getContext(), drawElements = context.drawElements, drawArrays = context.drawArrays
      let indexedCalls = 0, nonIndexedCalls = 0
      context.drawElements = function (...args) { indexedCalls++; return drawElements.apply(this, args) }
      context.drawArrays = function (...args) { nonIndexedCalls++; return drawArrays.apply(this, args) }
      try {
        gl.setRenderTarget(target); gl.info.autoReset = false; gl.info.reset()
        gl.render(isolated, camera)
        const calls = gl.info.render.calls, triangles = gl.info.render.triangles
        const allIndexedCalls = indexedCalls, allNonIndexedCalls = nonIndexedCalls
        const perFloorCalls = isolated.children.map((mesh, index) => {
          isolated.children.forEach(candidate => { candidate.visible = candidate === mesh })
          gl.info.reset(); gl.render(isolated, camera)
          return { floorId: metadata[index].floorId, calls: gl.info.render.calls }
        })
        return { meshes: metadata, calls, triangles, indexedCalls: allIndexedCalls, nonIndexedCalls: allNonIndexedCalls, perFloorCalls }
      } finally {
        context.drawElements = drawElements; context.drawArrays = drawArrays
        gl.setRenderTarget(previousTarget); gl.info.autoReset = autoReset
        target.dispose(); material.dispose()
      }
    })()`)
    assert.equal(report.meshes.length, expected, name)
    assert.equal(report.calls, expected, name)
    assert.equal(report.indexedCalls, expected, name)
    assert.equal(report.nonIndexedCalls, 0, name)
    assert.equal(new Set(report.meshes.map(mesh => mesh.floorId)).size, expected)
    for (const mesh of report.meshes) {
      assert.ok(mesh.indexed && mesh.singleMaterial)
      assert.ok(mesh.vertices < mesh.indices)
      assert.equal(mesh.groups, 0)
    }
    for (const floor of report.perFloorCalls) assert.equal(floor.calls, 1)
    reports.push({ name, ...report })
    console.log(name, JSON.stringify(report))
  }
  assert.deepEqual(browser.errors, [])
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify({ reports, errors: browser.errors }, null, 2))
  browser.close()
}
