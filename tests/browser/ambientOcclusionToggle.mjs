import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

const browser = await lightingBrowser(), out = 'docs/furniture-object-gi/ao-toggle'
mkdirSync(out, { recursive: true })
try {
  const cache = readFileSync('docs/gi-next/baseline/field-cache.json', 'utf8')
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `window.regressionSavedGI={project:{indirectLighting:${cache}}}` })
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5181}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi` })
  await browser.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`, 600000)
  console.log('READY')
  await browser.evaluate(`(async()=>{
    const {getEditorFiber}=await import('/tests/browser/rendererTestModules.ts');
    window.findAOComposer=()=>{let composer;const visit=f=>{if(!f)return;if(f.ref?.current?.passes)composer=f.ref.current;visit(f.child);visit(f.sibling)};visit(getEditorFiber());return composer};
    window.aoComposer=findAOComposer();window.aoPass=aoComposer.passes.find(p=>'renderTransparency'in p);
    const s=roofWallScene();s.camera.position.set(1.1,1.4,16.4);s.camera.lookAt(2.8,.65,16.6);s.camera.updateMatrixWorld();s.invalidate();
    window.aoAudit={compiles:0,links:0,draws:0};const gl=s.gl.getContext();
    for(const [name,key] of [['compileShader','compiles'],['linkProgram','links']]){const original=gl[name];gl[name]=function(...args){aoAudit[key]++;return original.apply(this,args)}}
    const render=aoComposer.render;aoComposer.render=function(...args){const result=render.apply(this,args);aoAudit.draws++;return result};
    window.aoBaseline={generation:s.scene.userData.indirectLighting.generation,warmups:s.scene.userData.shaderWarmupProfile.length,dpr:s.gl.getPixelRatio(),width:gl.drawingBufferWidth,height:gl.drawingBufferHeight};
    document.querySelector('[aria-label="3D view menu"]').click();
    window.aoInput=()=>[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Ambient occlusion').querySelector('input');
  })()`)
  await browser.wait('!!window.aoInput?.()')
  const states = []
  for (const enabled of [false, true, false, true]) {
    const state = await browser.evaluate(`(async()=>{
      const start=performance.now(),draws=aoAudit.draws;aoInput().click();
      while(aoPass.enabled!==${enabled}||aoAudit.draws<=draws){if(performance.now()-start>5000)throw Error('AO toggle exceeded five seconds');await new Promise(requestAnimationFrame)}
      const s=roofWallScene(),gl=s.gl.getContext();return {enabled:aoPass.enabled,latencyMs:performance.now()-start,sameComposer:findAOComposer()===aoComposer,samePass:aoComposer.passes.includes(aoPass),compiles:aoAudit.compiles,links:aoAudit.links,pending:!!s.scene.userData.shaderWarmupPending,generation:s.scene.userData.indirectLighting.generation,warmups:s.scene.userData.shaderWarmupProfile.length,dpr:s.gl.getPixelRatio(),width:gl.drawingBufferWidth,height:gl.drawingBufferHeight};
    })()`)
    states.push(state)
    const baseline = await browser.evaluate('aoBaseline')
    assert.ok(state.sameComposer && state.samePass)
    assert.equal(state.compiles, 0); assert.equal(state.links, 0); assert.equal(state.pending, false)
    for (const key of Object.keys(baseline)) assert.equal(state[key], baseline[key], key)
    assert.ok(state.latencyMs < 1500, JSON.stringify(state))
    const png = await browser.call('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`${out}/${enabled ? 'on' : 'off'}.png`, Buffer.from(png.data, 'base64'))
  }
  assert.deepEqual(browser.errors, [])
  writeFileSync(`${out}/verification.json`, JSON.stringify({ states, errors: browser.errors }, null, 2))
  console.log('PASS', JSON.stringify(states))
} finally { browser.close() }
