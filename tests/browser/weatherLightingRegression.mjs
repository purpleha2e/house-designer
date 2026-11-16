import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'

const browser=await lightingBrowser()
try {
  await browser.call('Page.navigate',{url:`http://localhost:${process.argv[2]??5181}/`})
  await browser.wait(`document.querySelector('[aria-label="3D engine status"]')?.textContent.startsWith('GI ready')`,30000)
  await browser.evaluate(`import('/tests/browser/rendererTestModules.ts').then(m=>window.weatherScene=m.getEditorState)`)
  await browser.wait(`!!weatherScene()?.scene.userData.getIndirectUniforms`)
  await browser.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await browser.wait(`!!document.querySelector('[aria-label="Daylight sky"]')`)
  const result=async()=>browser.evaluate(`(()=>{
    const s=weatherScene(),u=s.scene.userData.getIndirectUniforms(),lights={};
    s.scene.traverse(o=>{if(['sun-light','ambient-fill'].includes(o.userData.houseDesignerRole))lights[o.userData.houseDesignerRole]={intensity:o.intensity,color:o.color.toArray()}});
    return {lights,sky:u.hdSkyDisplayRadianceBase.value.toArray(),programs:s.gl.info.programs.length,status:document.querySelector('[aria-label="3D engine status"]').textContent}
  })()`)
  const clear=await result()
  for(const mode of ['overcast','clear']) {
    await browser.evaluate(`(()=>{const e=document.querySelector('[aria-label="Daylight sky"]');e.value='${mode}';e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await browser.wait(`weatherScene().scene.userData.getIndirectUniforms().hdSkyMode.value===${mode==='clear'?1:2}`)
    await browser.wait(`(()=>{let sun;weatherScene().scene.traverse(o=>{if(o.userData.houseDesignerRole==='sun-light')sun=o});return Math.abs(sun.intensity-${clear.lights['sun-light'].intensity*(mode==='overcast'?.06:1)})<1e-8})()`)
    await browser.evaluate('window.weatherReadySince=0')
    await browser.wait(`(()=>{const g=weatherScene().scene.userData.indirectLighting,ready=document.querySelector('[aria-label="3D engine status"]').textContent.startsWith('GI ready')&&!g.pendingLighting&&!g.pendingUpdate;
      if(!ready){window.weatherReadySince=0;return false}window.weatherReadySince||=performance.now();return performance.now()-window.weatherReadySince>1000})()`,30000)
    const actual=await result(),sun=actual.lights['sun-light'],fill=actual.lights['ambient-fill']
    if(mode==='overcast'){
      assert.ok(sun.intensity<clear.lights['sun-light'].intensity*.1)
      assert.equal(fill.color[0],fill.color[1]);assert.equal(fill.color[1],fill.color[2])
      assert.equal(actual.sky[0],actual.sky[1]);assert.equal(actual.sky[1],actual.sky[2])
    } else {
      assert.deepEqual(sun,clear.lights['sun-light']);assert.deepEqual(actual.sky,clear.sky)
    }
    assert.equal(actual.programs,clear.programs,'weather updates existing lighting programs')
    console.log(`PASS actual editor ${mode}`,JSON.stringify(actual))
  }
  assert.deepEqual(browser.errors,[])
} finally {browser.close()}
