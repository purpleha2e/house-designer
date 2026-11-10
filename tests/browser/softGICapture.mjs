import fs from 'node:fs'
import {gzipSync} from 'node:zlib'
import {lightingBrowser} from './lightingHarness.mjs'
const pose=process.argv[2]??'original',out=`docs/soft-gi/${pose}`,b=await lightingBrowser(),save=(name,data)=>fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(data,null,2))
const door=JSON.parse(fs.readFileSync('docs/door-confidence/original-capture.json')).camera
const cameras=[{id:'door',position:door.position,quaternion:door.quaternion,fov:45},{id:'staircase',position:[3.5,2.4,16.8],lookAt:[4.6,.05,15.25],fov:65},{id:'kitchen-junction',position:[4.55,1.4,13.2],lookAt:[6.1,.9,10.2],fov:65},{id:'kitchen-windows',position:[4.65,1.6,9.95],lookAt:[2.1,1.25,4.95],fov:60},{id:'bedroom',position:[.25,4.3,14.1],lookAt:[1.3,3.9,12.5],fov:85},{id:'limited-daylight',position:[3.6,4.3,16],lookAt:[4.1,4,11],fov:65}]
try{
 const cache=JSON.parse(fs.readFileSync(`docs/door-confidence/${pose}-field.json`,'utf8'))
 await b.call('Emulation.setDeviceMetricsOverride',{width:1310,height:888,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(cache)}}};addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='#root,.editor-pane{height:888px!important}body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.append(style)})`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:5181/tests/browser/roofWallRegression.html?colin&materials&saved-gi${pose==='original'?'':`&door-confidence-pose=${pose}`}`})
 await b.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
 await b.evaluate(`import('/tests/browser/softGIView.ts').then(m=>{window.softView=m.softGIView(roofWallScene());return true})`)
 save('uploads',await b.evaluate(`softView.load('${pose}')`));save('baseline-state',await b.evaluate('softView.state()'))
 if(process.argv.includes('--worker'))save('worker-visible',await b.evaluate('softView.workerVisible()'))
 for(const camera of (pose==='original'?cameras:cameras.slice(0,2)).filter(c=>!process.argv.includes('--worker')&&(!process.argv.includes('--stairs')||c.id==='staircase'))){
  const transform=await b.evaluate(`softView.setCamera(${JSON.stringify(camera)})`);save(camera.id+'-camera',transform)
  for(const neutral of [false,true])for(const name of ['baseline','5cm','10cm','20cm']){
   await b.evaluate(`softView.setMode('${name}');true`)
   const frame=await b.evaluate(`softView.capture(${neutral})`),file=`${camera.id}-${neutral?'white':'authored'}-${name}`
   fs.writeFileSync(`${out}/${file}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')))
   const rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()'),png=await b.call('Page.captureScreenshot',{format:'png',clip:rect})
   fs.writeFileSync(`${out}/${file}.png`,Buffer.from(png.data,'base64'));console.log('capture',pose,file)
  }
 }
 if(pose==='original'&&!process.argv.includes('--stairs')&&!process.argv.includes('--worker')){const frames=[];for(const name of ['baseline','5cm','10cm','20cm']){await b.evaluate(`softView.setMode('${name}');true`);frames.push({name,frames:await b.evaluate('softView.frames()')})}save('frame-times',frames)}
 save('final-state',await b.evaluate('softView.state()'));save('browser-errors',b.errors);if(b.errors.length)throw Error(b.errors.join('\n'));await b.evaluate('softView.dispose();true')
}catch(error){save('capture-failure',{error:String(error),errors:b.errors});throw error}finally{b.close()}


