import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebGLRenderer } from 'three'
import { installNonBlockingShaderDiagnostics } from '../src/shaderDiagnostics.ts'

function fixture(linked = true, setupThrows = false) {
  let submissions = 0, logs = 0, initialisations = 0, readinessChecks = 0
  let drawn = false
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
    render: () => {
      if (drawn) return
      drawn = true; renderer.info.programs.push(program)
      if (renderer.debug.checkShaderErrors) context.getProgramInfoLog()
      program.getUniforms()
    },
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

test('a program first seen during rendering skips successful logs and checks its link after yielding', async () => {
  const { renderer, counts } = fixture()
  installNonBlockingShaderDiagnostics(renderer)
  renderer.render(...([] as unknown as Parameters<WebGLRenderer['render']>))
  assert.equal(counts().logs, 0)
  assert.equal(counts().readinessChecks, 0, 'display/input task does not poll diagnostics')
  const end = Date.now() + 1000
  while (counts().readinessChecks < 3 && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(counts().readinessChecks, 3)
  assert.equal(counts().initialisations, 1)
  assert.equal(renderer.debug.checkShaderErrors, true)
  renderer.render(...([] as unknown as Parameters<WebGLRenderer['render']>))
  assert.equal(counts().logs, 0)
})

test('unprepared draw failures still report their link and shader diagnostics', async () => {
  const { renderer, counts } = fixture(false)
  const original = console.error, errors: unknown[] = []
  console.error = error => { errors.push(error) }
  try {
    installNonBlockingShaderDiagnostics(renderer)
    renderer.render(...([] as unknown as Parameters<WebGLRenderer['render']>))
    const end = Date.now() + 1000
    while (!errors.length && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(counts().logs, 3)
    assert.match(String(errors[0]), /GI reflection.*link failure/s)
    assert.equal(renderer.debug.checkShaderErrors, true)
  } finally { console.error = original }
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
test('programs already cached before preparation still finish asynchronous first-use setup',async()=>{
  const {renderer,counts}=fixture()
  await renderer.compileAsync(...([] as unknown as Parameters<WebGLRenderer['compileAsync']>))
  assert.equal(counts().initialisations,0)
  installNonBlockingShaderDiagnostics(renderer)
  await renderer.compileAsync(...([] as unknown as Parameters<WebGLRenderer['compileAsync']>))
  assert.equal(counts().initialisations,1)
  assert.equal(counts().logs,0)
  assert.equal(counts().readinessChecks,3)
})

test('a retained draw checking a pending program does not skip its later uniform warmup', async () => {
  const { renderer, counts } = fixture()
  await renderer.compileAsync(...([] as unknown as Parameters<WebGLRenderer['compileAsync']>))
  renderer.render = () => {} // Display an older scene while another program prepares.
  installNonBlockingShaderDiagnostics(renderer)
  renderer.render(...([] as unknown as Parameters<WebGLRenderer['render']>))
  const end = Date.now() + 1000
  while (counts().readinessChecks < 3 && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(counts().initialisations, 0)
  await renderer.compileAsync(...([] as unknown as Parameters<WebGLRenderer['compileAsync']>))
  assert.equal(counts().initialisations, 1)
})
