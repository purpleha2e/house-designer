import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebGLRenderer } from 'three'
import { installNonBlockingShaderDiagnostics } from '../src/shaderDiagnostics.ts'

function fixture(linked = true, setupThrows = false) {
  let submissions = 0, logs = 0, initialisations = 0, readinessChecks = 0
  const context = {
    LINK_STATUS: 1,
    getProgramParameter: (_: unknown, parameter: number) => parameter === 2 ? ++readinessChecks > 2 : linked,
    getProgramInfoLog: () => { logs++; return 'link failure' },
    getShaderInfoLog: () => { logs++; return 'shader details' },
  }
  const program = { id: 1, name: 'GI reflection', program: {}, vertexShader: {}, fragmentShader: {},
    getUniforms: () => {
      assert.equal(renderer.debug.checkShaderErrors, false, 'successful first-use setup cannot fetch Three diagnostic logs')
      initialisations++
      if (setupThrows) throw Error('uniform setup failed')
    }, getAttributes: () => {},
  }
  const renderer = {
    debug: { checkShaderErrors: true }, info: { programs: [] as typeof program[] },
    getContext: () => context, extensions: { get: () => ({ COMPLETION_STATUS_KHR: 2 }) },
    compileAsync: () => { submissions++; if (!renderer.info.programs.length) renderer.info.programs.push(program); return Promise.resolve('compiled') },
  }
  return { renderer: renderer as unknown as WebGLRenderer,
    counts: () => ({ submissions, logs, initialisations, readinessChecks }) }
}

test('prepared shaders skip successful diagnostic logs and yield while waiting for every program', async () => {
  const { renderer, counts } = fixture()
  installNonBlockingShaderDiagnostics(renderer)
  installNonBlockingShaderDiagnostics(renderer)
  let inputRan = false
  const result = renderer.compileAsync(...([] as unknown as Parameters<WebGLRenderer['compileAsync']>))
  setTimeout(() => { inputRan = true }, 0)
  await result
  assert.equal(inputRan, true)
  assert.deepEqual(counts(), { submissions: 1, logs: 0, initialisations: 1, readinessChecks: 3 })
  assert.equal(renderer.debug.checkShaderErrors, true, 'unprepared paths retain normal error reporting')
  await renderer.compileAsync(...([] as unknown as Parameters<WebGLRenderer['compileAsync']>))
  assert.equal(counts().initialisations, 1, 'cached programs are not set up repeatedly')
})

test('failed links preserve diagnostic details and reject shader preparation', async () => {
  const { renderer, counts } = fixture(false)
  installNonBlockingShaderDiagnostics(renderer)
  await assert.rejects(renderer.compileAsync(...([] as unknown as Parameters<WebGLRenderer['compileAsync']>)), /GI reflection.*link failure/s)
  assert.equal(counts().logs, 3)
  assert.equal(counts().initialisations, 0)
  assert.equal(renderer.debug.checkShaderErrors, true)
})

test('first-use setup failures restore normal diagnostics', async () => {
  const { renderer } = fixture(true, true)
  installNonBlockingShaderDiagnostics(renderer)
  await assert.rejects(renderer.compileAsync(...([] as unknown as Parameters<WebGLRenderer['compileAsync']>)), /uniform setup failed/)
  assert.equal(renderer.debug.checkShaderErrors, true)
})
