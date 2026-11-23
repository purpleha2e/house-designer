// Run against Vite and the local asset portal: node tests/browser/modellingLightingDisplay.mjs [port] [project]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'

const [port = '5188', project = 'springfield_14.json'] = process.argv.slice(2)
const browser = await lightingBrowser()
const out = 'tmp/modelling-lighting-display'
mkdirSync(out, { recursive: true })
try {
  await browser.call('Log.enable')
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1466, height: 1056, deviceScaleFactor: 1, mobile: false })
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `${projectFileInputFixtureSource}
    window.confirm = () => true;
    window.projectFileFixture = async () => [{ getFile: async () => new File(
      [await (await fetch(${JSON.stringify('/' + project)})).text()], ${JSON.stringify(project)}) }];` })
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/browser/editorRegression.html?lightingModel=modelling` })
  await browser.wait('!!window.perfScene?.() && !!document.querySelector(\'[aria-label="Project menu"]\')')
  await browser.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await browser.wait(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Load')`)
  await browser.evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Load').click()`)
  const ready = `(() => {
    const s = window.perfScene?.(), data = s?.scene.userData;
    return data?.modellingLighting?.state === 'ready' && !data.modellingLighting.pending &&
      !data.shaderWarmupPending && data.progressiveStartup?.phase === 'full';
  })()`
  await browser.wait(ready, 300000)
  const divider = await browser.evaluate(`(() => {
    const r = document.querySelector('[aria-label="Resize 2D and 3D views"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`)
  await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...divider })
  await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: 44, y: divider.y })
  await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: 44, y: divider.y })
  await browser.evaluate(`(() => {
    const s = perfScene();
    const pose = ${JSON.stringify(project === 'springfield_14.json' ? [9.45, 1.4, 4.05, 5.1, 1.3, 3.65] : [1, 1.4, 4.2, 1.7, 1.3, 1])};
    s.camera.position.set(...pose.slice(0, 3)); s.camera.lookAt(...pose.slice(3));
    s.camera.updateMatrixWorld(true); s.invalidate();
  })()`)
  await new Promise(resolve => setTimeout(resolve, 1500))
  await browser.wait(ready)
  if (process.argv.includes('--profile')) {
    const report = await browser.evaluate(`(async () => {
      const { getEditorFiber } = await import('/tests/browser/rendererTestModules.ts');
      const findComposer = fiber => {
        if (!fiber) return null;
        return fiber.ref?.current?.passes ? fiber.ref.current : findComposer(fiber.child) ?? findComposer(fiber.sibling);
      };
      const composer = findComposer(getEditorFiber());
      const ao = composer?.passes.find(pass => 'renderTransparency' in pass);
      if (!ao?.enabled) throw Error('Profile needs the Build view with ambient occlusion enabled');
      const state = perfScene(), renderer = state.gl, data = state.scene.userData;
      const uniforms = data.getIndirectUniforms(), context = renderer.getContext();
      const timer = context.getExtension('EXT_disjoint_timer_query_webgl2');
      const render = composer.render, setPixelRatio = renderer.setPixelRatio;
      const originalWeight = uniforms.hdFastWeight.value;
      const width = renderer.domElement.width, height = renderer.domElement.height;
      const programs = renderer.info.programs.length, requests = data.modellingLighting.requests;
      const samples = {};
      const frame = () => new Promise(requestAnimationFrame);
      const median = values => values.length ? values.sort((a,b) => a-b)[values.length >> 1] : null;
      // Hold size and shader programs constant to isolate the cost of the
      // bounce lookup from that of the compositor's ambient occlusion pass.
      renderer.setPixelRatio = () => {};
      try {
        for (const [label, giEnabled, aoEnabled] of [
          ['normal', true, true], ['withoutBounceLookup', false, true],
          ['withoutAmbientOcclusion', true, false], ['normalRepeat', true, true],
        ]) {
          const cpu = [], gpu = [], queries = [], wallTime = [];
          composer.render = function(delta) {
            const oldAO = ao.enabled, oldWeight = uniforms.hdFastWeight.value;
            ao.enabled = aoEnabled;
            uniforms.hdFastWeight.value = giEnabled ? originalWeight : 0;
            const query = timer && !context.getQuery(timer.TIME_ELAPSED_EXT, context.CURRENT_QUERY) ? context.createQuery() : null;
            const start = performance.now();
            if (query) context.beginQuery(timer.TIME_ELAPSED_EXT, query);
            try { render.call(this, delta) }
            finally {
              cpu.push(performance.now() - start);
              if (query) { context.endQuery(timer.TIME_ELAPSED_EXT); queries.push(query) }
              ao.enabled = oldAO;
              uniforms.hdFastWeight.value = oldWeight;
            }
          };
          for (let i = 0; i < 40; i++) {
            state.camera.rotateY(i % 2 ? .007 : -.007);
            state.invalidate();
            const start = performance.now();
            await frame();
            context.finish();
            if (i > 4) wallTime.push(performance.now() - start);
          }
          const disjoint = timer && context.getParameter(timer.GPU_DISJOINT_EXT);
          for (const query of queries) {
            if (!disjoint && context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE)) {
              gpu.push(context.getQueryParameter(query, context.QUERY_RESULT) / 1e6);
            }
            context.deleteQuery(query);
          }
          samples[label] = { gpuMs: median(gpu.slice(5)), cpuMs: median(cpu.slice(5)), completedMs: median(wallTime), frames: cpu.length };
        }
      } finally {
        composer.render = render;
        renderer.setPixelRatio = setPixelRatio;
      }
      return { width, height, samples, requests: data.modellingLighting.requests - requests,
        newPrograms: renderer.info.programs.length - programs, state: data.modellingLighting.state };
    })()`)
    writeFileSync(`${out}/frame-cost.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    assert.ok(Object.values(report.samples).every(sample => sample.frames >= 30))
    assert.equal(report.requests, 0)
    assert.equal(report.newPrograms, 0)
    assert.deepEqual(browser.errors, [])
  } else if (process.argv.includes('--adaptive')) {
    if (project !== 'springfield_14.json') throw Error('The adaptive test uses Springfield room coordinates')
    const result = await browser.evaluate(`(async () => {
      const state = perfScene(), data = state.scene.userData, renderer = state.gl;
      const uniforms = data.getIndirectUniforms(), context = renderer.getContext();
      while (context.getError()) { if (context.isContextLost()) throw Error('WebGL context lost') }
      const field = uniforms.hdFastLight.value;
      const count = data.modellingLighting.requests;
      const programs = renderer.info.programs.length;
      const fullWidth = renderer.domElement.width;
      const frames = [];
      const frame = () => new Promise(requestAnimationFrame);
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const render = renderer.render.bind(renderer);
      let sceneDraws = 0;
      renderer.render = (scene, camera) => {
        if (scene === state.scene && camera === state.camera) sceneDraws++;
        return render(scene, camera);
      }
      let angle = 1;
      const moveFrame = async () => {
        angle = -angle;
        state.camera.rotateY(angle * .007);
        state.invalidate();
        sceneDraws = 0;
        const start = performance.now();
        await frame();
        context.finish();
        return { ...data.modellingDisplay, width: renderer.domElement.width,
          sceneDraws, completedMs: performance.now() - start };
      };
      try {
        const full = [];
        for (let i = 0; i < 8; i++) full.push(await moveFrame());
        for (let i = 0; i < 12; i++) {
          // Reproduce a sustained sub-10 FPS input cadence on all test GPUs.
          // Keep moving at every frame, including before any resize arrives.
          const start = performance.now();
          while (performance.now() - start < 112) {}
          frames.push(await moveFrame());
        }
        const reduced = [];
        for (let i = 0; i < 8; i++) reduced.push(await moveFrame());
        await sleep(450);
        const paused = { ...data.modellingDisplay, width: renderer.domElement.width };
        const resumed = await moveFrame();
        await sleep(1450);
        const still = { ...data.modellingDisplay, width: renderer.domElement.width };
        sceneDraws = 0;
        await sleep(1050);
        const idleDraws = sceneDraws;
        const rooms = [];
        for (const [x, z] of [[9.45, 4.05], [5.1, 4.46], [4.5, 5.6], [9.45, 4.05]]) {
          state.camera.position.set(x, 1.4, z);
          state.invalidate();
          await sleep(360);
          const cell = state.camera.position.clone().sub(uniforms.hdFastMin.value).divide(uniforms.hdFastSize.value);
          rooms.push({ x, z, scope: data.modellingLighting.scope, sameField: uniforms.hdFastLight.value === field,
            lit: uniforms.hdFastReady.value > .5 && uniforms.hdFastWeight.value > .5,
            covered: cell.toArray().every(value => value >= 0 && value <= 1) });
        }
        return { fullWidth, full, frames, reduced, paused, resumed, still, idleDraws, rooms, views: data.modellingLighting.stats.views,
          requests: data.modellingLighting.requests - count, programs: renderer.info.programs.length - programs,
          glError: context.getError() };
      } finally { renderer.render = render }
    })()`)
    writeFileSync(`${out}/adaptive.json`, JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
    assert.ok(result.frames.some(frame => frame.resolution <= .65 && frame.width <= Math.ceil(result.fullWidth * .65)),
      'sustained slow movement shrinks the actual drawing buffer')
    assert.ok(result.frames.filter(frame => frame.resolution <= .65).every(frame => frame.sceneDraws === 3),
      'reduced resolution keeps the scene draw and both ambient occlusion transparency draws')
    assert.equal(result.paused.moving, false)
    assert.equal(result.paused.width, result.reduced.at(-1).width, 'short pauses hold the current quality')
    assert.equal(result.resumed.width, result.paused.width)
    assert.equal(result.still.width, result.fullWidth, 'a still view restores the full pixel count')
    assert.equal(result.still.resolution, 1)
    assert.ok(result.idleDraws <= 9, 'settled idle frames do not redraw every animation tick')
    assert.ok(result.rooms.every(room => room.lit && room.covered && room.sameField &&
      room.scope === result.rooms[0].scope), 'the bounce field remains published across the doorway')
    assert.ok(result.views > 12, 'the storey field captures more than the primary room')
    assert.equal(result.requests, 0)
    assert.equal(result.programs, 0)
    assert.equal(result.glError, 0)
    assert.deepEqual(browser.errors, [])
  } else {
  const screenshot = async name => {
    const data = await browser.call('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`${out}/${name}.png`, Buffer.from(data.data, 'base64'))
  }
  for (const weight of [1, 0, 1]) {
    await browser.evaluate(`(() => {
      const s = perfScene(); s.scene.userData.getIndirectUniforms().hdFastWeight.value = ${weight};
      s.scene.userData.liveLightRevision++; s.invalidate();
    })()`)
    await new Promise(resolve => setTimeout(resolve, 350))
    await screenshot(weight ? 'interior' : 'bounce-off')
  }
  const report = await browser.evaluate(`(async () => {
    const s = perfScene(), data = s.scene.userData, uniforms = data.getIndirectUniforms();
    const context = s.gl.getContext(), requestCount = data.modellingLighting.requests;
    const startupError = context.getError();
    const orientation = s.camera.quaternion.clone(), samples = {};
    const frame = () => new Promise(requestAnimationFrame);
    const draw = s.gl.render.bind(s.gl);
    let displayed = 0;
    s.gl.render = (scene, camera) => {
      const result = draw(scene, camera);
      if (scene === s.scene && camera === s.camera) displayed++;
      return result;
    };
    try {
      for (const [name, linear, weight] of [['linear', 1, 1], ['quadratic', 0, 1], ['off', 1, 0], ['linearRepeat', 1, 1]]) {
        uniforms.hdFastLinearReceiver.value = linear;
        uniforms.hdFastWeight.value = weight;
        const times = [];
        displayed = 0;
        const links = s.gl.info.programs.length;
        for (let i = 0; i < 18; i++) {
          s.camera.quaternion.copy(orientation);
          s.camera.rotateY(Math.sin(i * .4) * .04);
          s.camera.updateMatrixWorld(true); s.invalidate();
          const start = performance.now();
          await frame(); await frame();
          // Wait for this frame to complete. Submission time alone omits the
          // cost of the fragment shader on a saturated GPU.
          context.finish();
          if (i >= 3) times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        samples[name] = { medianMs: times[times.length >> 1], displayed, newPrograms: s.gl.info.programs.length - links };
      }
    } finally {
      s.gl.render = draw;
      uniforms.hdFastLinearReceiver.value = uniforms.hdFastWeight.value = 1;
      s.camera.quaternion.copy(orientation); s.camera.updateMatrixWorld(true); s.invalidate();
    }
    const debug = context.getExtension('WEBGL_debug_renderer_info');
    return { samples, size: [s.gl.domElement.width, s.gl.domElement.height],
      renderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      startupError, requests: data.modellingLighting.requests - requestCount, glError: context.getError() };
  })()`)
  report.gpuMessages = browser.logs.filter(entry => /WebGL|GL_INVALID/.test(entry.text)).map(entry => entry.text)
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  assert.equal(report.requests, 0, 'camera movement within a room must reuse the published field')
  assert.equal(report.glError, 0)
  assert.ok(Object.values(report.samples).every(sample => sample.displayed >= 15 && sample.newPrograms === 0),
    'measure actual editor draws without compiling new shader programs')
  assert.deepEqual(browser.errors, [])
  }
} finally {
  browser.close()
}
