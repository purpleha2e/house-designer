import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, CubeCamera, Matrix4, Mesh, MeshStandardMaterial, Scene, Vector3, WebGLCoordinateSystem,
  WebGLCubeRenderTarget, type Camera, type WebGLRenderer } from 'three'
import { createIndirectMultiview, indirectMultiviewRotations, indirectMultiviewShader } from '../src/indirectMultiview.ts'

test('multiview cube rotations preserve projected geometry in every face of both batch sizes', () => {
  const target = new WebGLCubeRenderTarget(16), camera = new CubeCamera(.03, 80, target)
  camera.coordinateSystem = WebGLCoordinateSystem; camera.updateCoordinateSystem()
  camera.position.set(4.3, 2.6, 8.1); camera.updateMatrixWorld(true)
  for (const faceOrder of [[0, 1, 2, 3, 4, 5], [0, 2, 4, 1, 3, 5]]) for (const views of [2, 3]) {
    const rotations = Array.from({ length: views }, () => new Matrix4())
    for (let first = 0; first < 6; first += views) {
      indirectMultiviewRotations(camera, first, views, rotations, faceOrder)
      for (let view = 0; view < views; view++) for (const point of [[1, 2, 3], [6, 1.7, 9], [-2, 7, -1]]) {
        const actual = new Vector3(...point).applyMatrix4((camera.children[faceOrder[first]] as Camera).matrixWorldInverse).applyMatrix4(rotations[view])
        const expected = new Vector3(...point).applyMatrix4((camera.children[faceOrder[first + view]] as Camera).matrixWorldInverse)
        assert.ok(actual.distanceTo(expected) < 1e-10, 'a batch uses the same cube face projection')
      }
    }
  }
  target.dispose()
})

test('multiview extension precedes renderer precision declarations and leaves ordinary shaders untouched', () => {
  const ordinary = '#version 300 es\nprecision highp float;\nvoid main() {}'
  assert.equal(indirectMultiviewShader(ordinary, true, 3), ordinary)
  const source = ordinary + '\n#define HD_GI_MULTIVIEW'
  const vertex = indirectMultiviewShader(source, true, 3)
  assert.match(vertex, /^#version 300 es\n#extension GL_OVR_multiview2 : require\nlayout\(num_views = 3\) in;/)
  const fragment = indirectMultiviewShader(source, false, 3)
  assert.match(fragment, /^#version 300 es\n#extension GL_OVR_multiview2 : require\nprecision/)
  assert.ok(!fragment.includes('num_views'))
})

test('unsupported hardware retains the ordinary capture scene without allocating or modifying it', () => {
  const source = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  const mesh = new Mesh(geometry, material); source.add(mesh)
  const renderer = { setRenderTargetFramebuffer() { throw Error('must not allocate') },
    getContext() { return { getExtension() { return null } } } } as unknown as WebGLRenderer
  const version = material.version
  assert.equal(createIndirectMultiview(renderer, 16, source), null)
  assert.equal(source.children[0], mesh)
  assert.equal(mesh.material, material)
  assert.equal(mesh.frustumCulled, true)
  assert.equal(material.version, version)
  geometry.dispose(); material.dispose()
})
