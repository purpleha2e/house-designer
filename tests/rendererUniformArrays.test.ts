import test from 'node:test'
import assert from 'node:assert/strict'
import {cacheLightingUniformArrays} from '../src/rendererUniformArrays.ts'
import {installNonBlockingShaderDiagnostics} from '../src/shaderDiagnostics.ts'
import type {WebGLRenderer} from 'three'
const uniform = (id: string, type = 0x1406, size = 3) => ({id, type, size, writes: [] as unknown[],
  setValue(_gl: unknown, value: unknown) { this.writes.push(structuredClone(value)) }})
test('shared numeric array cache is per linked program and detects in-place changes', () => {
  const a = uniform('hdPointLightRoomIds'), b = uniform('hdPointLightRoomIds'), values = new Float32Array([1, 2, 3])
  assert.equal(cacheLightingUniformArrays({seq: [a, b]}), 2)
  assert.equal(cacheLightingUniformArrays({seq: [a, b]}), 0, 'idempotent setup')
  for (const u of [a, b]) { u.setValue(null, values); u.setValue(null, values); assert.equal(u.writes.length, 1) }
  values[1] = 9
  for (const u of [a, b]) { u.setValue(null, values); assert.equal(u.writes.length, 2) }
  const fresh = uniform('hdPointLightRoomIds') // Fresh/relinked program/context.
  cacheLightingUniformArrays({seq: [fresh]}); fresh.setValue(null, values)
  assert.equal(fresh.writes.length, 1)
})
test('vector and matrix arrays compare numeric values and preserve signed zero / unknown values', () => {
  const a = uniform('hdGIFloorRanges', 0x8b50, 2), b = uniform('pointShadowMatrix', 0x8b5c, 1)
  cacheLightingUniformArrays({seq: [a, b]})
  const vectors = [{x: 1, y: 2}, {x: 3, y: 4}], matrices = [{elements: Array.from({length: 16}, (_, i) => i)}]
  a.setValue(null, vectors); a.setValue(null, vectors.map(v => ({...v}))); assert.equal(a.writes.length, 1)
  vectors[1].y = 8; a.setValue(null, vectors); assert.equal(a.writes.length, 2)
  b.setValue(null, matrices); b.setValue(null, matrices); matrices[0].elements[14] = 5; b.setValue(null, matrices)
  assert.equal(b.writes.length, 2)
  const c = uniform('hdRoomLightFloorHeights', 0x1406, 1); cacheLightingUniformArrays({seq: [c]})
  for (const v of [[0], [-0], [NaN], [NaN], [undefined], [undefined]]) c.setValue(null, v)
  assert.equal(c.writes.length, 6)
})
test('samplers, per-object matrices, scalar uniforms and unsupported tables are untouched', () => {
  const entries = [uniform('pointShadowMap', 0x8dc5, 2), uniform('modelViewMatrix', 0x8b5c, 1),
    {...uniform('hdPointLightRoomIds'), size: undefined}, uniform('unmeasuredArray')]
  const setters = entries.map(u => u.setValue)
  assert.equal(cacheLightingUniformArrays({seq: entries}), 0)
  assert.deepEqual(entries.map(u => u.setValue), setters)
  for (const v of [undefined, {}, {seq: {}}]) assert.equal(cacheLightingUniformArrays(v), 0)
})
test('failed original upload cannot validate a stale cache', () => {
  let writes = 0, fail = true
  const u = {id: 'hdPointLightRoomIds', type: 0x1406, size: 1, setValue(_gl: unknown, _value: unknown) { writes++; if (fail) throw Error('upload') }}
  cacheLightingUniformArrays({seq: [u]})
  assert.throws(() => u.setValue(null, [1]), /upload/)
  fail = false; u.setValue(null, [1]); u.setValue(null, [1]); assert.equal(writes, 2)
})

test('cache follows alternating material values and equivalent flat/vector/matrix representations', () => {
  const vectors = uniform('hdGIFloorRanges', 0x8b50, 2), matrices = uniform('pointShadowMatrix', 0x8b5c, 1)
  cacheLightingUniformArrays({seq: [vectors, matrices]})
  for (const value of [[1, 2, 3, 4], [{x: 1, y: 2}, {x: 3, y: 4}], [1, 2, 3, 5], [1, 2, 3, 4]]) {
    vectors.setValue(null, value)
  }
  assert.equal(vectors.writes.length, 3, 'A/B/A material switches must restore the program uniform')
  const matrix = Array.from({length: 16}, (_, i) => i)
  matrices.setValue(null, matrix); matrices.setValue(null, [{elements: matrix}])
  assert.equal(matrices.writes.length, 1)
  matrix[15] = -0; matrices.setValue(null, [{elements: matrix}])
  matrix[15] = 0; matrices.setValue(null, [{elements: matrix}])
  assert.equal(matrices.writes.length, 3, 'last matrix component and signed zero must be observed')
})

test('empty, sparse and nonnumeric values invalidate the cache until a successful numeric upload', () => {
  const u = uniform('hdPointLightRoomIds'); cacheLightingUniformArrays({seq: [u]})
  const values: unknown[] = [[1, 2], [], [], [1, 2], [1, undefined], [1, undefined],
    [1, 2], [1, '2'], [1, '2'], [1, 2], [1, NaN], [1, NaN], [1, 2], [1, Infinity], [1, Infinity]]
  for (const value of values) u.setValue(null, value)
  assert.equal(u.writes.length, values.length - 1, 'only the repeated numeric Infinity upload can be suppressed')
})

test('matrix, colour and vector arrays recheck every member including in-place edits and missing components', () => {
  const u = uniform('pointShadowMatrix', 0x8b5a, 2); cacheLightingUniformArrays({seq: [u]})
  const value = [{elements: [1, 2, 3, 4]}, {x: 5, y: 6, z: 7, w: 8}]
  u.setValue(null, value); u.setValue(null, value)
  assert.equal(u.writes.length, 1)
  value[1].w = 9; u.setValue(null, value)
  value[0].elements![0] = 10; u.setValue(null, value)
  assert.equal(u.writes.length, 3)
  const colour = uniform('hdGIFloorRanges', 0x8b51, 1); cacheLightingUniformArrays({seq: [colour]})
  const colours = [{isColor: true, r: 1, g: .5, b: 0}]
  colour.setValue(null, colours); colour.setValue(null, colours); colours[0].b = 1; colour.setValue(null, colours)
  assert.equal(colour.writes.length, 2)
})
test('existing asynchronous first-use setup installs the cache without another program scan or link path', async () => {
  const u = uniform('hdPointLightRoomIds'), program = {id: 1, name: 'uniform regression', program: {},
    getUniforms: () => ({seq: [u]}), getAttributes: () => ({})}
  let submits = 0
  const renderer = {debug: {checkShaderErrors: true}, info: {programs: [program]},
    extensions: {get: () => null}, getContext: () => ({LINK_STATUS: 1, getProgramParameter: () => true}),
    compileAsync: () => {submits++; return Promise.resolve('ready')}, render: () => {}}
  installNonBlockingShaderDiagnostics(renderer as unknown as WebGLRenderer)
  assert.equal(await renderer.compileAsync(), 'ready')
  const values = new Float32Array([1, 2, 3]); u.setValue(null, values); u.setValue(null, values)
  assert.equal(u.writes.length, 1); values[0] = 7; u.setValue(null, values); assert.equal(u.writes.length, 2)
  assert.equal(submits, 1); assert.equal(renderer.debug.checkShaderErrors, true)
})
