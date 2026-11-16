import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser()
try{
 await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5181}/tests/browser/groundShadowContrast.html`})
 await b.wait('!!window.groundWeatherResults')
 const results=await b.evaluate('groundShadowResults')
 mkdirSync('tmp/ground-shadow',{recursive:true})
 for(const r of results){
  for(const name of ['before','after']){if(r.mode==='on')writeFileSync(`tmp/ground-shadow/${name}.png`,Buffer.from(r[name].png.split(',')[1],'base64'));delete r[name].png}
  assert.ok(Math.abs(r.after.lit-r.before.lit)<1,'unshadowed ground stays unchanged')
  assert.ok(Math.abs(r.after.wall-r.before.wall)<1,'the building stays unchanged')
  if(r.mode==='on')assert.ok(r.after.shadow<r.before.shadow-10,'the cast ground shadow is visibly stronger')
  else assert.ok(Math.abs(r.after.shadow-r.before.shadow)<1,`${r.mode} leaves no artificial shadow`)
 }
 assert.deepEqual(b.errors,[])
 console.log('PASS ground-shadow contrast and off states',JSON.stringify(results))
 const weather=await b.evaluate('groundWeatherResults')
 for(const r of weather.rows){writeFileSync(`tmp/ground-shadow/${r.mode}-${r.elevation}.png`,Buffer.from(r.png.split(',')[1],'base64'));delete r.png}
 const [clearHigh,clearLow,cloudHigh,cloudLow]=weather.rows
 assert.ok(clearHigh.shadowRGB[2]>clearHigh.shadowRGB[0]+3,'clear daylight shadows have cool sky fill')
 assert.ok(clearLow.shadow<clearHigh.shadow-15,'sunset shadows are darker')
 assert.ok(clearLow.shadowRGB[2]>clearLow.shadowRGB[0]&&clearLow.shadowRGB[0]>clearLow.shadowRGB[1],'sunset shadows become muted violet')
 for(const cloud of [cloudHigh,cloudLow]){
  assert.ok(Math.max(...cloud.shadowRGB)-Math.min(...cloud.shadowRGB)<4,'cloud shadows are neutral grey')
  assert.ok(cloud.lit-cloud.shadow<8,'cloud has little directional contrast')
 }
 assert.equal(weather.programsAfter,weather.programsBefore,'weather and sun height reuse existing shaders')
 console.log('PASS weather palette and stable shaders',JSON.stringify(weather))
}finally{b.close()}
