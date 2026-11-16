import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'
import { installRenderLoopPreload } from './renderLoopAuditProbe.mjs'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'

const b = await lightingBrowser()
const report = {}
try {
  const project = JSON.parse(readFileSync('tests/fixtures/roofShaderRoom.json', 'utf8'))
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    (${installRenderLoopPreload.toString()})();
    ${projectFileInputFixtureSource}
    window.projectFileFixture=async()=>[{getFile:async()=>new File([${JSON.stringify(JSON.stringify(project))}],'spotlight-room.house.json')}];
    window.lightState=()=>loopFind().state;
    window.propsMatching=predicate=>{const host=document.getElementById('root');let found;
      const walk=f=>{if(!f)return;if(predicate(f.memoizedProps))found=f.memoizedProps;walk(f.child);walk(f.sibling)};
      walk(host[Object.keys(host).find(k=>k.startsWith('__reactContainer$'))].stateNode.current);return found};
  ` })
  await b.call('Page.navigate', { url: `http://localhost:${process.argv[2] ?? 4173}/` })
  await b.wait(`!!document.querySelector('[aria-label="Project menu"]')`)
  await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await b.wait(`!![...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()==='Load')`)
  await b.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()==='Load').click()`)
  await b.wait(`propsMatching(p=>p?.onSelectSurface&&p.floors)?.floors[0]?.id===${JSON.stringify(project.floors[0].id)}`)
  await b.wait(`lightState()?.scene.userData.progressiveStartup?.phase==='full'&&!lightState().scene.userData.shaderWarmupPending`, 180000)
  // Exercise actual shadowed illumination, not just a light object's power.
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await b.wait(`!![...document.querySelectorAll('#three-settings-menu label')].find(l=>l.textContent.trim()==='Light shadows')`)
  await b.evaluate(`(()=>{const input=[...document.querySelectorAll('#three-settings-menu label')].find(l=>l.textContent.trim()==='Light shadows').querySelector('input');if(!input.checked)input.click();document.querySelector('[aria-label="3D view menu"]').click()})()`)
  report.before = await b.evaluate(`({programs:lightState().gl.info.programs.map(p=>p.cacheKey),lights:(()=>{const a=[];lightState().scene.traverse(o=>{if(o.isPointLight||o.isSpotLight)a.push({type:o.type,power:o.power})});return a})()})`)
  console.log('Startup ready', report.before.lights)
  await b.evaluate(`propsMatching(p=>p?.onOpenModelSelector).onOpenModelSelector('objects')`)
  await b.wait(`!!propsMatching(p=>p?.onSelectModel&&p.models)`)
  await b.evaluate(`window.lightDrawAt=0;const s=lightState(),render=s.gl.renderBufferDirect.bind(s.gl);
    s.gl.renderBufferDirect=(...args)=>{const result=render(...args);if(window.lightApplyAt&&!lightDrawAt&&args[0]===s.camera&&args[1]===s.scene&&args[4].userData.houseDesignerRole==='wall-engine-render'){
      let emitting=false;s.scene.traverse(o=>{if(o.isSpotLight&&o.power>0)emitting=true});if(emitting&&s.scene.userData.localShadowAtlas?.ready&&s.scene.userData.localShadowAtlas.lights===1)lightDrawAt=performance.now();}return result};
    window.lightApplyAt=performance.now();propsMatching(p=>p?.onSelectModel&&p.models).onSelectModel('spotlight')`)
  await b.wait(`propsMatching(p=>p?.onSelectSurface&&p.floors).floors.some(f=>f.models?.some(m=>m.modelId==='spotlight'))`)
  await b.wait(`!!lightDrawAt&&!lightState().scene.userData.shaderWarmupPending&&!lightState().scene.userData.indirectScanPending`, 90000)
  report.after = await b.evaluate(`({ms:lightDrawAt-lightApplyAt,programs:lightState().gl.info.programs.map(p=>p.cacheKey),profiles:lightState().scene.userData.shaderWarmupProfile.filter(p=>p.startedAt>=lightApplyAt),atlas:lightState().scene.userData.localShadowAtlas,failure:lightState().scene.userData.shaderWarmupFailure})`)
  console.log('Spotlight visible', JSON.stringify({ ms: report.after.ms, profiles: report.after.profiles }))
  assert.ok(report.after.ms < 4000, `First spotlight should illuminate the prepared scene promptly: ${report.after.ms}ms`)
  assert.deepEqual(b.errors, [])
  console.log('PASS spotlight placement latency')
} finally {
  report.errors=b.errors
  report.state=await b.evaluate(`({body:document.body.innerText,atlas:window.lightState?.()?.scene.userData.localShadowAtlas,preparation:window.lightState?.()?.scene.userData.viewportPreparation,failure:window.lightState?.()?.scene.userData.shaderWarmupFailure})`).catch(()=>null)
  writeFileSync('tmp/spotlight-placement-profile.json', JSON.stringify(report,null,2))
  b.close()
}
