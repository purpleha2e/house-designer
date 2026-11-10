import fs from 'node:fs'
import {gzipSync} from 'node:zlib'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),out='docs/bedroom-sun-audit',save=(name,value)=>fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2))
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false})
 const navigation=await b.call('Page.navigate',{url:'http://localhost:5181/tests/browser/roofWallRegression.html?colin&materials&saved-colin'})
 if(navigation.errorText)throw Error(navigation.errorText)
 await b.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
 console.log('saved bedroom ready')
 save(process.argv.includes('--exposure')?'exposure-baseline':'baseline',await b.evaluate(`(()=>{const s=roofWallScene();return{gi:s.scene.userData.indirectLighting,programs:s.gl.info.programs.length,exposure:s.gl.toneMappingExposure,sun:regressionSunPosition,settings:s.scene.userData.getBakedIndirectLighting()?.settings,camera:{position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray()},warmups:s.scene.userData.shaderWarmupProfile}})()`))
 await b.evaluate(`import('/tests/browser/softGIView.ts').then(m=>{window.bedView=m.softGIView(roofWallScene());const u=roofWallScene().scene.userData.getIndirectUniforms();window.bedOriginal={strength:u.hdGIProbeStrength.value,fill:u.hdGIIndoorFill.value};return true})`)
 for(const [name,code,white] of (process.argv.includes('--exposure')?[['exposure-0','',false],['exposure-1','roofWallScene().gl.toneMappingExposure=2',false],['exposure-1_5','roofWallScene().gl.toneMappingExposure=2**1.5',false]]:[['baseline','',false],['white','',true],['without-gi','u.hdGIProbeStrength.value=0',false],['without-fill','u.hdGIIndoorFill.value=0',false]])){
  await b.evaluate(`(()=>{const u=roofWallScene().scene.userData.getIndirectUniforms();roofWallScene().gl.toneMappingExposure=1;u.hdGIProbeStrength.value=bedOriginal.strength;u.hdGIIndoorFill.value=bedOriginal.fill;${code};return true})()`)
  const frame=await b.evaluate(`bedView.capture(${white})`);fs.writeFileSync(`${out}/${name}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')))
  const rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()'),png=await b.call('Page.captureScreenshot',{format:'png',clip:rect});fs.writeFileSync(`${out}/${name}.png`,Buffer.from(png.data,'base64'))
 }
 await b.evaluate(`(()=>{const s=roofWallScene(),u=s.scene.userData.getIndirectUniforms();u.hdGIProbeStrength.value=bedOriginal.strength;u.hdGIIndoorFill.value=bedOriginal.fill;bedView.dispose();const gl=s.gl.getContext(),native=gl.compileShader.bind(gl);window.sunShaderCompiles=[];gl.compileShader=shader=>{sunShaderCompiles.push({t:performance.now(),type:gl.getShaderParameter(shader,gl.SHADER_TYPE),source:gl.getShaderSource(shader)?.slice(0,700)});return native(shader)};return true})()`)
 for(const [label,delta] of (process.argv.includes('--exposure')?[]:[['first',.03],['second',.03]])){
  await b.evaluate(`window.sunAuditAt=performance.now();window.sunShaderCompiles=[];window.sunAuditTrace=[];window.sunAuditTimer=setInterval(()=>{const s=roofWallScene();sunAuditTrace.push({t:performance.now()-sunAuditAt,gi:{...s.scene.userData.indirectLighting},programs:s.gl.info.programs.length,preparation:s.scene.userData.viewportPreparation})},500);updateRegressionSunPosition({...regressionSunPosition,azimuth:regressionSunPosition.azimuth+${delta}});true`)
  await b.wait(`sunAuditTrace.some(r=>r.gi.state!=='ready'||r.gi.pendingLighting||r.gi.pendingUpdate)`,30000)
  await b.wait(`(()=>{const g=roofWallScene().scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.volumePending&&!g.saving})()`,600000)
  save(label+'-sun',await b.evaluate(`(()=>{clearInterval(sunAuditTimer);return{elapsedMs:performance.now()-sunAuditAt,compiles:sunShaderCompiles,trace:sunAuditTrace,performance:roofWallScene().scene.userData.getLightingPerformance()}})()`));console.log(label,'sun complete')
 }
 save(process.argv.includes('--exposure')?'exposure-errors':'errors',b.errors)
}catch(error){save('failure',{error:String(error),errors:b.errors});throw error}finally{b.close()}
