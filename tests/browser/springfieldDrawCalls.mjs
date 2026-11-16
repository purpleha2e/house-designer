import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'
import { installSceneEditPreload } from './sceneEditTrace.js'

const output = 'tmp/springfield-draw-calls'
mkdirSync(output, { recursive: true })
const browser = await lightingBrowser()
try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true })
  await browser.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `(${installSceneEditPreload.toString()})()` })
  await browser.call('Page.navigate', { url: process.argv[2] ?? 'http://127.0.0.1:5183/' })
  await browser.wait(`(() => {
    const walk = f => { if (!f) return;
      if (f.memoizedProps?.value?.getState?.()?.scene) window.drawStore = f.memoizedProps.value;
      for (let d = f.dependencies?.firstContext; d; d = d.next)
        if (d.memoizedValue?.getState?.()?.scene) window.drawStore = d.memoizedValue;
      walk(f.child); walk(f.sibling);
    }; for (const root of sceneEditTrace.roots.keys()) walk(root.current);
    const u = window.drawStore?.getState().scene.userData;
    return u?.indirectLighting?.state === 'ready' && u.exteriorSkyOcclusion?.enabled && !u.shaderWarmupPending && u.progressiveStartup?.phase === 'full';
  })()`, 300000)
  console.log('Springfield fully prepared')
  await browser.evaluate(`(() => {
    document.querySelector('[aria-label="Open tour menu"]').click();
    [...document.querySelectorAll('.viewer-modes button')].find(b => b.textContent === 'Fly').click();
    const select = document.querySelector('[aria-label="Render quality"]');
    select.value = 'full'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await browser.wait(`document.querySelector('.viewer-modes button[aria-pressed="true"]').textContent === 'Fly' && drawStore.getState().gl.getPixelRatio() === 1`)
  await browser.evaluate(`document.querySelector('[aria-label="Close tour menu"]').click()`)
  // The menu commits before the deferred 3D controls. Do not let an outgoing
  // walk controller snap the first overhead camera back to head height.
  await browser.wait(`(() => { let ready = false; const walk = f => { if (!f) return;
    if (f.memoizedProps?.mode === 'fly' && typeof f.memoizedProps.floorElevation === 'number') ready = true;
    walk(f.child); walk(f.sibling); }; for (const root of sceneEditTrace.roots.keys()) walk(root.current); return ready; })()`)
  await new Promise(resolve => setTimeout(resolve, 200))
  const inventory = await browser.evaluate(`(() => {
    const s = drawStore.getState(), r = s.gl, context = r.getContext();
    const inventory = { meshes: 0, instancedMeshes: 0, materials: new Set(), geometries: new Set(), roles: {} };
    const role = object => { for (let o = object; o; o = o.parent) if (o.userData.houseDesignerRole) return o.userData.houseDesignerRole; return 'unlabelled'; };
    s.scene.traverse(o => { if (!o.isMesh) return; inventory.meshes++; if (o.isInstancedMesh) inventory.instancedMeshes++;
      inventory.geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) inventory.materials.add(m);
      const k = role(o); inventory.roles[k] = (inventory.roles[k] ?? 0) + 1;
    });
    window.drawAudit = { frames: [], active: null, draw: null, force: false };
    const render = r.render, direct = r.renderBufferDirect;
    r.render = function(scene, camera) {
      const previous = drawAudit.active, main = camera === s.camera && scene === s.scene;
      const frame = main ? { draws: 0, triangles: 0, roles: {}, passes: {}, meshes: new Set(), materials: new Set(), at: performance.now() } : previous;
      drawAudit.active = frame;
      try { return render.apply(this, arguments); } finally {
        if (main) { frame.cpuMs = performance.now() - frame.at; frame.meshes = frame.meshes.size; frame.materials = frame.materials.size;
          frame.gi = scene.userData.indirectLighting.state; frame.warming = scene.userData.shaderWarmupPending;
          drawAudit.frames.push(frame); if (drawAudit.frames.length > 240) drawAudit.frames.shift(); }
        drawAudit.active = previous;
      }
    };
    r.renderBufferDirect = function(camera, scene, geometry, material, object, group) {
      const previous = drawAudit.draw;
      drawAudit.draw = { role: role(object), pass: material.isMeshDepthMaterial || material.isMeshDistanceMaterial ? 'shadow' : material.transparent ? 'transparent' : 'opaque', object, material };
      try { return direct.apply(this, arguments); } finally { drawAudit.draw = previous; }
    };
    for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const original = context[method];
      context[method] = function(...args) {
        const frame = drawAudit.active, draw = drawAudit.draw;
        if (frame) {
          const count = method.startsWith('drawArrays') ? args[2] : args[1];
          const instances = method.endsWith('Instanced') ? args.at(-1) : 1;
          const triangles = args[0] === context.TRIANGLES ? count / 3 * instances : 0;
          frame.draws++; frame.triangles += triangles;
          const k = draw?.role ?? 'other', pass = draw?.pass ?? 'other';
          const row = frame.roles[k] ??= { draws: 0, triangles: 0 }; row.draws++; row.triangles += triangles;
          frame.passes[pass] = (frame.passes[pass] ?? 0) + 1;
          if (draw) { frame.meshes.add(draw.object); frame.materials.add(draw.material); }
        }
        return original.apply(this, args);
      };
    }
    let i = 0; const tick = () => { if (drawAudit.force) { s.camera.quaternion.copy(drawAudit.rotation); s.camera.rotateY((i++ % 2) * .00001); s.invalidate(); } requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    return { ...inventory, materials: inventory.materials.size, geometries: inventory.geometries.size,
      canvas: [r.domElement.width, r.domElement.height], dpr: r.getPixelRatio(), gi: s.scene.userData.indirectLighting.source,
      shOrder: s.scene.userData.getIndirectUniforms().hdGISHOrder.value, exterior: s.scene.userData.exteriorSkyOcclusion };
  })()`)
  const views = [
    { name: 'whole-house', position: [24, 17, 29], target: [9, 3.5, 8] },
    { name: 'close-exterior', position: [16, 5, 15], target: [10, 4, 7] },
    { name: 'interior', position: [9, 1.8, 9], target: [9, 1.8, 4] },
  ]
  const result = { inventory, views: {} }
  for (const view of views) {
    await browser.evaluate(`(() => { const s = drawStore.getState(); drawAudit.force = false;
      s.camera.position.set(...${JSON.stringify(view.position)}); s.camera.lookAt(...${JSON.stringify(view.target)});
      drawAudit.rotation = s.camera.quaternion.clone(); drawAudit.frames = []; drawAudit.force = true; })()`)
    await browser.wait('drawAudit.frames.length >= 60 && !drawStore.getState().scene.userData.shaderWarmupPending', 90000)
    result.views[view.name] = await browser.evaluate(`(() => { const frames = drawAudit.frames, steady = frames.slice(-20), middle = a => [...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
      return { frameCount: frames.length, first: frames[0], steady: steady.at(-1),
        minCalls: Math.min(...steady.map(f=>f.draws)), maxCalls: Math.max(...steady.map(f=>f.draws)),
        medianCalls: middle(steady.map(f=>f.draws)), medianTriangles: middle(steady.map(f=>f.triangles)), medianSubmitMs: middle(steady.map(f=>f.cpuMs)),
        camera: drawStore.getState().camera.position.toArray() };
    })()`)
    assert.deepEqual(result.views[view.name].camera, view.position, 'Camera must stay at the measured viewpoint')
    await browser.evaluate('drawAudit.force = false')
    const shot = await browser.call('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`${output}/${view.name}.png`, Buffer.from(shot.data, 'base64'))
    writeFileSync(`${output}/report.json`, JSON.stringify(result, null, 2))
    console.log(view.name, JSON.stringify(result.views[view.name]))
  }
  assert.deepEqual(browser.errors, [])
  console.log('PASS measured actual WebGL draw calls with all floors, saved GI and exterior occlusion')
} finally { browser.close() }
