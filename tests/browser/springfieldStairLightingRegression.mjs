// Vite and the asset portal running: node tests/browser/springfieldStairLightingRegression.mjs [port]
import assert from 'node:assert/strict'
import {mkdirSync, writeFileSync} from 'node:fs'
import sharp from 'sharp'
import {lightingBrowser} from './lightingHarness.mjs'

const b = await lightingBrowser(), output = 'tmp/springfield-stair-lighting'
mkdirSync(output, {recursive: true})
try {
  // This old project references an unavailable custom front-door asset. Only
  // the isolated test substitutes it; the stair model and saved GI stay intact.
  await b.call('Page.addScriptToEvaluateOnNewDocument', {source: `
    const nativeFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url ?? String(input);
      return nativeFetch(url.includes('/bb35ad04a6c60479b06147e9ddd58e7e/processed/model.glb')
        ? '/src/models/assets/interior_door_closed.glb' : input, init);
    };
    window.confirm = () => false;
    window.showOpenFilePicker = async () => [{name:'springfield_14.json', getFile:async()=>
      new File([await (await fetch('/springfield_14.json')).text()], 'springfield_14.json')}];
  `})
  await b.call('Page.navigate', {url:`http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/editorRegression.html?lightingDiagnostics`})
  await b.wait('!!window.perfScene?.()', 240000)
  await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await b.wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`)
  await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
  await b.wait(`perfScene().scene.userData.indirectLighting?.probes===308 && perfScene().scene.userData.progressiveStartup?.phase==='full' && !perfScene().scene.userData.shaderWarmupPending`, 300000)
  await b.wait(`perfScene().scene.userData.roomLightOcclusion?.ready`, 300000)
  console.log('Springfield loaded after Colin')
  const pool = await b.evaluate(`(()=>{const s=perfScene();s.camera.position.set(10.1,3.8,8.3);s.camera.lookAt(10.5,4.4,11.78);s.camera.updateMatrixWorld();s.invalidate();
    return s.scene.children.filter(o=>o.isPointLight).map(o=>({power:o.power,shadow:o.castShadow,position:o.position.toArray()}))})()`)
  assert.ok(pool.filter(l=>l.shadow).every(l=>l.power>0), 'available shadow slots must serve powered lamps')
  assert.ok(pool.some(l=>l.power>0&&l.shadow), 'the limited shadow pool serves emitting lamps')
  await b.evaluate(`document.querySelector('button[aria-controls="three-settings-menu"]').click()`)
  await b.wait(`!![...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Light shadows')`)
  const toggle = async enabled => {
    await b.evaluate(`(()=>{const i=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Light shadows').querySelector('input');if(i.checked!==${enabled})i.click();perfScene().invalidate()})()`)
    await b.evaluate(`new Promise(resolve=>setTimeout(resolve,700))`)
  }
  await b.evaluate(`houseDesignerLighting.setMode('Direct lighting only')`)
  await toggle(false)
  const samples = await b.evaluate(`(async()=>{const {Vector3}=await import('/tests/browser/rendererTestModules.ts');const {snapshotIndirectGeometry,createIndirectVisibilityFromSnapshot}=await import('/src/indirectVisibility.ts');const s=perfScene();
    const lamp=s.scene.children.find(o=>o.isPointLight&&Math.abs(o.position.x-10.401601857546476)<.001);
    // Sample the opaque wall above the window, avoiding the glass sky reflection.
    const p=new Vector3(10.35,4.8,11.65), source=lamp.position.clone();
    const visibility=createIndirectVisibilityFromSnapshot(snapshotIndirectGeometry(s.scene));
    const hit=visibility.hit(source,p.clone().sub(source).normalize(),source.distanceTo(p)-.01);visibility.dispose();
    const pixel=p.clone().project(s.camera), rect=s.gl.domElement.getBoundingClientRect();
    return {blockers:hit?1:0,
      x:Math.round(rect.left+(pixel.x+1)*rect.width/2), y:Math.round(rect.top+(1-pixel.y)*rect.height/2)};
  })()`)
  assert.ok(samples.blockers>0, 'opaque scene geometry blocks the toilet-to-window ray, regardless of merged mesh names or face winding')
  const capture = async name => {
    await b.evaluate(`document.querySelector('#three-settings-menu').style.visibility='hidden'`)
    const {data}=await b.call('Page.captureScreenshot',{format:'png'}), png=Buffer.from(data,'base64')
    await b.evaluate(`document.querySelector('#three-settings-menu').style.visibility=''`)
    writeFileSync(`${output}/${name}.png`,png)
    const {data:pixels}=await sharp(png).extract({left:samples.x-2,top:samples.y-2,width:5,height:5}).removeAlpha().raw().toBuffer({resolveWithObject:true})
    return pixels.reduce((sum,v)=>sum+v,0)/pixels.length
  }
  const off=await capture('shadows-off')
  await toggle(true)
  const on=await capture('shadows-on')
  console.log(JSON.stringify({pool,samples,off,on}))
  assert.ok(off<10, 'the fallback must block the toilet lamp even with Light shadows off')
  assert.ok(Math.abs(on-off)<5, 'enabling detailed light shadows must not be needed to remove the bright patch')
  assert.deepEqual(b.errors.filter(e=>!e.includes('BufferGeometryUtils:')),[])
} finally {b.close()}
