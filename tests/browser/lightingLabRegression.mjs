import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const out='tmp/lighting-lab';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),report={}
const save=()=>writeFileSync(out+'/regression.json',JSON.stringify({...report,errors:b.errors},null,2))
const frames=async count=>{const at=await b.evaluate('lightingLab.stats().frames');await b.wait(`lightingLab.stats().frames>=${at+count}`)}
const measure=(name='Left side wall',kind='indirect')=>b.evaluate(`lightingLab.measureCard(${JSON.stringify(name)},${JSON.stringify(kind)})`)
const shot=async name=>writeFileSync(out+'/'+name+'.png',Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
const luminance=rgb=>rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false})
 await b.call('Page.navigate',{url:process.argv[2]??'http://127.0.0.1:5188/lighting-lab/'})
 await b.wait('window.lightingLab?.stats().frames>120')
 report.initial=await b.evaluate('lightingLab.stats()');report.red=await measure();await shot('red')
 report.smoothing=await b.evaluate(`Promise.all(['indirect','filtered'].map(kind=>lightingLab.measureCard('Left side wall',kind,{x:4,y:4,width:24,height:24})))`)
 const [rawWall,smoothWall]=report.smoothing
 assert.ok(smoothWall.roughness<rawWall.roughness*.5,'Spatial filtering must reduce wall blotchiness')
 assert.ok(Math.abs(luminance(smoothWall.rgb)/luminance(rawWall.rgb)-1)<.1,'Smoothing must retain average wall brightness')
 report.filteredRed=await measure('Left side wall','filtered')
 await b.evaluate(`(()=>{const gl=lightingLab.renderer.getContext(),original=gl.linkProgram;window.newShaderLinks=0;gl.linkProgram=function(...args){newShaderLinks++;return original.apply(this,args)};lightingLab.resetMeasurements()})()`)
 await b.evaluate(`document.querySelector('[data-rug="blue"]').click()`);await frames(90);report.blue=await measure();await shot('blue')
 assert.ok(report.red.rgb[0]/report.red.rgb[2]>report.blue.rgb[0]/report.blue.rgb[2]*1.3,'Rug colour must change reflected wall light, not just the rug material')
 report.filteredBlue=await measure('Left side wall','filtered')
 assert.ok(report.filteredRed.rgb[0]/report.filteredRed.rgb[2]>report.filteredBlue.rgb[0]/report.filteredBlue.rgb[2]*1.3,'Smoothing must preserve visible rug colour bounce')
 await b.evaluate(`document.querySelector('[data-rug="neutral"]').click();document.querySelector('#daylight').click();document.querySelector('#right-lamp').click()`);await frames(120)
 report.lampOn=await measure();report.directOn=await measure('Left floor','direct');save()
 report.toggle=await b.evaluate(`(async()=>{const start=performance.now();document.querySelector('#left-lamp').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return{elapsedMs:performance.now()-start,direct:await lightingLab.measureCard('Left floor','direct')}})()`)
 assert.ok(luminance(report.toggle.direct.rgb)<luminance(report.directOn.rgb)*.05,'The local direct light must disappear on the next display frames')
 report.response=[]
 const changedAt=Date.now()
 for(let i=0;i<12;i++){await frames(5);report.response.push({elapsedMs:Date.now()-changedAt,...await measure()})}
 report.lampOff=await measure();assert.ok(luminance(report.lampOff.rgb)<luminance(report.lampOn.rgb)*.6,'Lamp change must propagate into bounced light')
 await shot('left-off');save()
 await frames(240);report.dark=await measure()
 assert.ok(luminance(report.dark.rgb)<.005,'With no sources, stored bounce light must decay rather than feed itself')
 report.filteredDark=await measure('Left side wall','filtered')
 assert.ok(luminance(report.filteredDark.rgb)<.005,'Filtered lighting must also decay when sources are off')
 await b.evaluate(`document.querySelector('#left-lamp').click();document.querySelector('#right-lamp').click();document.querySelector('#daylight').click();document.querySelector('[data-rug="red"]').click()`)
 await frames(120)
 // Place the cabinet below the left lamp, over the measured floor patch;
 // then move it into the neighbouring room. Direct visibility must change.
 await b.evaluate('lightingLab.setCabinet(-2.2)');await frames(90);report.blockedFloor=await b.evaluate(`lightingLab.measureCard('Left floor','direct',{x:10,y:13,width:8,height:6})`);await shot('cabinet-left')
 await b.evaluate('lightingLab.setCabinet(2.2)');await frames(90);report.clearFloor=await b.evaluate(`lightingLab.measureCard('Left floor','direct',{x:10,y:13,width:8,height:6})`);await shot('cabinet-right')
 assert.ok(luminance(report.clearFloor.rgb)>luminance(report.blockedFloor.rgb)*1.05,'Moving furniture must change geometric light visibility')
 report.beforeWalk=await b.evaluate('lightingLab.stats()')
 await b.evaluate(`(async()=>{const start=performance.now();await new Promise(resolve=>{const tick=()=>{const t=(performance.now()-start)/1000;lightingLab.camera.position.set(Math.sin(t)*2.6,1.55,.3);lightingLab.camera.lookAt(Math.cos(t)*2.5,1.2,-2.5);if(t<6)requestAnimationFrame(tick);else resolve()};requestAnimationFrame(tick)})})()`)
 report.final=await b.evaluate('lightingLab.stats()');report.newShaderLinks=await b.evaluate('newShaderLinks')
 assert.equal(report.newShaderLinks,0,'Lamp, material, geometry and camera changes must not compile shaders')
 assert.deepEqual(report.final.viewport,report.initial.viewport,'Camera movement must not reduce viewport resolution')
 assert.equal(report.final.programs,report.initial.programs)
 assert.deepEqual(b.errors,[])
 save()
 // A higher-DPI viewport must still update every atlas tile correctly.
 await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:700,deviceScaleFactor:2,mobile:false})
 await b.call('Page.reload')
 await b.wait('window.lightingLab?.stats().frames>180')
 report.hidpi=await b.evaluate('lightingLab.stats()');report.hidpiWall=await measure()
 assert.equal(report.hidpi.viewport.width,1400);assert.equal(report.hidpi.viewport.height,1400)
 assert.ok(luminance(report.hidpiWall.rgb)>.05)
 assert.deepEqual(b.errors,[])
 report.stage='passed';save();console.log(JSON.stringify(report))
}catch(error){report.error=String(error);save();throw error}finally{b.close()}
