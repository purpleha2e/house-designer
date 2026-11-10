import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const browser=await lightingBrowser()
try{
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/exteriorDaylightRegression.html`});await browser.wait('!!window.exteriorDaylightResults')
  const result=await browser.evaluate('exteriorDaylightResults');console.log(JSON.stringify(result));assert.equal(result.error,undefined);assert.equal(result.glError,0)
  mkdirSync('tmp/exterior-daylight',{recursive:true});writeFileSync('tmp/exterior-daylight/results.json',JSON.stringify(result,null,2))
  assert.ok(result.roof.every(v=>v>.3),'an upward-facing roof above a room receives diffuse sky')
  assert.ok(result.facadeA.every((v,c)=>v>.1&&Math.abs(v-result.facadeB[c])<.001),'exterior facade samples on either side of a coarse mask boundary receive the same sky')
  for(const key of ['interior','underside','night'])assert.ok(result[key].every(v=>v<1e-5),`${key} must not gain unoccluded sky`)
  for(const [capture,display] of [['captureRoof','roof'],['captureFacadeA','facadeA'],['captureFacadeB','facadeB']])assert.ok(result[capture].every((v,c)=>Math.abs(v-result[display][c])<.001),'roof-sky capture correction must match display')
  for(const sample of result.skyIntensities){assert.ok(sample.display.every((v,c)=>Math.abs(v-result.roof[c]*sample.strength)<.002));assert.ok(sample.capture.every((v,c)=>Math.abs(v-sample.display[c])<.002));assert.ok(sample.underside.every(v=>v<1e-5))}
  assert.ok(result.captureFacadeB.every(v=>v>.1),'existing exterior capture transport is preserved')
  assert.ok(result.boostedFacade.every((v,c)=>Math.abs(v-result.facadeB[c])<.001),'indoor bounce gain must not change exterior daylight')
  assert.ok(result.pitchedWall.flat().every(v=>v<1e-5),'a gable wall stays indoors between ceiling-mask texel centres')
  assert.ok(result.pitchedUnderside.flat().every(v=>v<1e-5),'pitched undersides remain indoors')
  assert.ok(result.pitchedRoof.flat().every(v=>v>.3),'the same pitched roof exterior retains sky lighting')
  assert.deepEqual(browser.errors,[]);console.log('PASS exterior roofs/facades receive sky without changing indoor, underside, night; captures include exterior sky')
}finally{browser.close()}
