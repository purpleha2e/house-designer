// Numerical edit checks use the normal world-space background probe solver.
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const browser=await lightingBrowser(),results={}
try{
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/probeDaylightReference.html?probe`})
  await browser.wait('!!window.probeDaylight')
  results.open=await browser.evaluate(`probeDaylight.run('overcast',6,false)`)
  results.closed=await browser.evaluate(`probeDaylight.run('overcast',6,true)`)
  results.reopened=await browser.evaluate(`probeDaylight.run('overcast',6,false)`)
  for(let i=0;i<4;i++){
    assert.ok(results.open.receivers[i].irradiance.rgb.every(v=>v>.1),'an opening admits diffuse sky to all receivers')
    assert.ok(results.closed.receivers[i].irradiance.rgb.every(v=>v<1e-5),'closing the opening blocks diffuse sky')
    assert.ok(results.reopened.receivers[i].irradiance.rgb.every((v,c)=>Math.abs(v-results.open.receivers[i].irradiance.rgb[c])<.002),'removing the blocking wall restores the same light')
  }
  await browser.evaluate('probeDaylight.setWallReflectance(.2)')
  results.darkWalls=await browser.evaluate(`probeDaylight.run('overcast',6,false)`)
  assert.ok(results.darkWalls.receivers[2].irradiance.rgb.every((v,c)=>v<results.open.receivers[2].irradiance.rgb[c]*.7),'dark walls reduce reflected ceiling irradiance')
  await browser.evaluate('probeDaylight.setWallReflectance(.8,.2,.2)')
  results.redWalls=await browser.evaluate(`probeDaylight.run('overcast',6,false)`)
  const rgb=results.redWalls.receivers[2].irradiance.rgb
  assert.ok(rgb[0]/results.open.receivers[2].irradiance.rgb[0]>rgb[2]/results.open.receivers[2].irradiance.rgb[2]*1.3,'wall colour affects the reflected light spectrum')
  await browser.evaluate('probeDaylight.setWallReflectance(.8);probeDaylight.setOccluder(2.5)')
  results.blocked=await browser.evaluate(`probeDaylight.run('overcast',6,false)`)
  await browser.evaluate('probeDaylight.setOccluder(6.5)')
  results.moved=await browser.evaluate(`probeDaylight.run('overcast',6,false)`)
  assert.ok(results.moved.receivers.some((r,i)=>r.irradiance.rgb.some((v,c)=>v>results.blocked.receivers[i].irradiance.rgb[c]+.02)),'moving furniture out of the daylight path changes occlusion')
  for(const result of Object.values(results)){assert.equal(result.status.state,'ready');assert.equal(result.glError,0)}
  assert.deepEqual(browser.errors,[])
  mkdirSync('tmp/probe-edit-lighting',{recursive:true});writeFileSync('tmp/probe-edit-lighting/report.json',JSON.stringify(results,null,2))
  const png=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync('tmp/probe-edit-lighting/final.png',Buffer.from(png.data,'base64'))
  console.log('PASS opening closure/removal, wall reflectance/colour and furniture occlusion update background GI')
}finally{browser.close()}
