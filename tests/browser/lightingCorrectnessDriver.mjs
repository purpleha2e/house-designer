import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {gzipSync} from 'node:zlib'
import sharp from 'sharp'

export const auditCameras=[
  {id:'01-kitchen-windows',position:[4.65,1.6,9.95],lookAt:[2.1,1.25,4.95],fov:60},
  {id:'02-kitchen-inward',position:[2.6,1.6,5.55],lookAt:[4.2,1.35,11.5],fov:65},
  {id:'03-dining-kitchen',position:[.2,1.55,8.65],lookAt:[5.6,1.2,8.2],fov:65},
  {id:'04-stairwell',position:[4,4.25,15.8],lookAt:[6.22,3.85,15.31785],fov:75},
  {id:'05-bedroom',position:[.25,4.3,14.1],lookAt:[1.3,3.9,12.5],fov:100},
  {id:'06-hallway',position:[3.6,4.3,16],lookAt:[4.1,4,11],fov:65},
]
const configs=[['A',true,true,true],['B',true,true,false],['C',false,true,false],['D',true,false,false],['E',false,false,false]]
const pairs=[['A','B'],['B','C'],['B','D'],['D','E']]
const half=h=>{const s=h&32768?-1:1,e=h>>>10&31,m=h&1023;return e===0?s*2**-14*(m/1024):e===31?m?NaN:s*Infinity:s*2**(e-15)*(1+m/1024)}
function decode(base64,w,h){const bytes=Buffer.from(base64,'base64'),out=new Float32Array(w*h*3);for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++)out[(y*w+x)*3+c]=half(bytes.readUInt16LE(((h-1-y)*w+x)*8+c*2));assert.ok(out.every(Number.isFinite),'finite linear HDR readback');return out}
const at=(a,w,{x,y})=>Array.from(a.subarray((y*w+x)*3,(y*w+x)*3+3))
async function difference(dir,name,a,b,w,h,scale,linear){const raw=Buffer.alloc(w*h*3),delta=new Float32Array(w*h*3);let absolute=0,max=0,changed=0,signed=0;for(let i=0;i<delta.length;i++){const d=a[i]-b[i];delta[i]=d;raw[i]=Math.max(0,Math.min(255,Math.round(127.5+d*scale)));absolute+=Math.abs(d);signed+=d;max=Math.max(max,Math.abs(d));if(Math.abs(d)>(linear?.0005:0))changed++}await sharp(raw,{raw:{width:w,height:h,channels:3}}).png().toFile(`${dir}/${name}.png`);writeFileSync(`${dir}/${name}.rgb32f.gz`,gzipSync(Buffer.from(delta.buffer)));return{meanAbsolute:absolute/delta.length,meanSigned:signed/delta.length,maxAbsolute:max,changedComponents:changed,visualScale:scale,units:linear?'linear scene-relative HDR radiance':'sRGB byte difference'}}

export async function runAudit(b,out){
  const all=[],references=[]
  const settings=await b.evaluate('correctness.settings()');const {width:w,height:h}=settings
  assert.equal(settings.packedEquivalence.roundingViolations,0,'packed diagnostic field preserves production pixels within RGBA16F rounding')
  assert.equal(settings.instrumentationEquivalence.roundingViolations,0,'instrumentation at default preserves production pixels within RGBA16F rounding')
  for(const camera of auditCameras){
    const dir=`${out}/${camera.id}`;mkdirSync(dir,{recursive:true})
    const transform=await b.evaluate(`correctness.setCamera(${JSON.stringify(camera.position)},${JSON.stringify(camera.lookAt)},${camera.fov})`)
    const result={camera:{...camera,...transform},configurations:{},differences:{},points:[]},hdr={},display={}
    for(const [name,shadows,gi,ao]of configs){
      console.log('CAPTURE',camera.id,name)
      await b.evaluate(`correctness.setConfig(${shadows},${gi},${ao})`)
      const frame=await b.evaluate('correctness.capture()');hdr[name]=decode(frame.hdr,w,h)
      assert.ok(frame.unchanged.generationUnchanged&&frame.unchanged.facesUnchanged&&frame.unchanged.fieldSame&&frame.unchanged.coefficientsUnchanged,'display switches preserve completed GI field')
      assert.ok(frame.unchanged.packedBound&&frame.unchanged.uniformHeight===frame.unchanged.packedHeight,'diagnostic sampler bindings match the packed texture layout on every draw')
      writeFileSync(`${dir}/${name}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')))
      const rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()')
      const screenshot=await b.call('Page.captureScreenshot',{format:'png',clip:rect}),png=Buffer.from(screenshot.data,'base64');writeFileSync(`${dir}/${name}.png`,png)
      const raw=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(raw.info.width,w);assert.equal(raw.info.height,h);display[name]=raw.data
      assert.ok(raw.data.some(v=>v>0),'display capture contains the rendered scene')
      result.configurations[name]={shadows,gi,ao,unchanged:frame.unchanged}
    }
    for(const [a,z]of pairs){result.differences[`${a}-${z}`]={hdr:await difference(dir,`${a}-${z}-linear`,hdr[a],hdr[z],w,h,64,true),display:await difference(dir,`${a}-${z}-display`,display[a],display[z],w,h,2,false)}}
    let residual=0,residualMax=0,violations=0;for(let i=0;i<hdr.B.length;i++){const d=Math.abs((hdr.B[i]-hdr.C[i])-(hdr.D[i]-hdr.E[i])),tolerance=.002*(1+Math.max(...['B','C','D','E'].map(k=>Math.abs(hdr[k][i]))));residual+=d;residualMax=Math.max(residualMax,d);if(d>tolerance)violations++}
    result.shadowAdditivity={meanAbsoluteHDRResidual:residual/hdr.B.length,maxAbsoluteHDRResidual:residualMax,expression:'(B-C)-(D-E)',tolerance:'.002*(1+max(abs(B),abs(C),abs(D),abs(E)))',violations}
    assert.equal(violations,0,'shadow-map difference must be additive and independent of reflected diffuse GI within RGBA16F rounding')
    // AO sensitivity preserves every other setting, including the GI field.
    for(const [name,radius,intensity]of [['AO-half-radius',settings.ao.radius/2,settings.ao.intensity],['AO-half-intensity',settings.ao.radius,settings.ao.intensity/2]]){
      await b.evaluate(`correctness.setConfig(true,true,true,${radius},${intensity})`)
      const frame=await b.evaluate('correctness.capture()'),values=decode(frame.hdr,w,h)
      writeFileSync(`${dir}/${name}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')))
      const rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()')
      const screenshot=await b.call('Page.captureScreenshot',{format:'png',clip:rect});writeFileSync(`${dir}/${name}.png`,Buffer.from(screenshot.data,'base64'))
      result.differences[name]=await difference(dir,`${name}-minus-B-linear`,values,hdr.B,w,h,64,true)
    }
    await b.evaluate('correctness.setConfig(true,true,false)')
    const names=['position','normal','geometricNormal','albedo','sunUnoccludedIrradiance','sunVisibleIrradiance','localUnoccludedIrradiance','localVisibleIrradiance','skyIrradiance','reflectedIrradiance','artistFillIrradiance','sunVisibility','localVisibilityWeighted','materialAO','indirectDiffuseRadiance','directRadiance','otherRadiance']
    const grid=[];for(let y=30;y<h-20;y+=30)for(let x=25;x<w-20;x+=30)grid.push({x,y})
    const targets=camera.id.includes('stair')?[[6.26,3.25,14.7178535],[6.26,3.25,15.9178534],[5.95,5.08,15.31785],[6.22,2.4,15.31785]]:[[1.7,2.38,5.7],[2.8,2.38,9.1],[3.43,1.4,10.02],[1.6,.78,7.5],[.73,2.25,5.05159]]
    const projected=await b.evaluate(`correctness.project(${JSON.stringify(targets)})`);for(const p of projected)if(p.visible)for(const dx of [-1,0,1])for(const dy of [-1,0,1]){const x=Math.max(0,Math.min(w-1,p.x+dx)),y=Math.max(0,Math.min(h-1,p.y+dy));if(!grid.some(q=>q.x===x&&q.y===y))grid.push({x,y})}
    const candidateValues={}
    for(const [i,name]of names.entries())candidateValues[name]=await b.evaluate(`correctness.component(${i+1},${JSON.stringify(grid)})`)
    const candidates=grid.map((pixel,i)=>({pixel,...Object.fromEntries(names.map(name=>[name,candidateValues[name][i]]))})).filter(p=>Math.abs(Math.hypot(...p.normal)-1)<.02&&Math.hypot(...p.position)>1)
    const luminance=v=>v[0]*.2126+v[1]*.7152+v[2]*.0722
    writeFileSync(`${dir}/surface-grid.json`,JSON.stringify(candidates))
    const gradient=points=>{if(!points.length)return null;const values=points.map(p=>({position:p.position,E:luminance(p.skyIrradiance)+luminance(p.reflectedIrradiance)})).sort((a,b)=>a.E-b.E),mean=values.reduce((s,p)=>s+p.E,0)/values.length;return{samples:values.length,min:values[0],max:values.at(-1),mean,standardDeviation:Math.sqrt(values.reduce((s,p)=>s+(p.E-mean)**2,0)/values.length)}}
    result.gradients={ceiling:gradient(candidates.filter(p=>p.geometricNormal[1]<-.9&&Math.abs(p.position[1]-(camera.position[1]>3?5.08:2.38))<.025)),windowWall:gradient(candidates.filter(p=>camera.id.includes('stair')?Math.abs(p.position[0]-6.220947)<.02&&p.geometricNormal[0]<-.9:Math.abs(p.position[2]-(camera.id.includes('bedroom')?10.31069:5.05159))<.02&&Math.abs(p.geometricNormal[2])>.9))}
    const used=new Set();function select(name,filter,score){const choices=candidates.filter((p,i)=>!used.has(i)&&filter(p)).map(p=>({p,score:score(p)})).sort((a,b)=>a.score-b.score);if(!choices.length){result.points.push({name,unavailable:'No suitable visible receiver in this fixed view'});return}const p=choices[0].p;used.add(candidates.indexOf(p));result.points.push({name,...p})}
    const vertical=p=>Math.abs(p.geometricNormal[1])<.1
    select('ceiling',p=>p.geometricNormal[1]<-.9,p=>Math.hypot(p.pixel.x-w/2,p.pixel.y-h*.15))
    select('floor',p=>p.geometricNormal[1]>.9&&Math.abs(p.position[1]-(camera.position[1]>3?2.712:.012))<.08,p=>Math.hypot(p.pixel.x-w/2,p.pixel.y-h*.8))
    select('wall facing window',p=>vertical(p)&&Math.abs(p.geometricNormal[camera.id.includes('stair')?0:2])>.9&&(!camera.id.includes('stair')||Math.abs(p.position[0]-6.220947)<.025),p=>Math.hypot(p.pixel.x-w*.5,p.pixel.y-h*.4))
    select('wall perpendicular to window',p=>vertical(p)&&Math.abs(p.geometricNormal[camera.id.includes('stair')?2:0])>.9,p=>Math.hypot(p.pixel.x-w*.2,p.pixel.y-h*.5))
    // These are candidate descriptions, subsequently identified against real mesh metadata.
    select('structural column',p=>camera.position[1]<3&&vertical(p)&&p.position[0]>2.8&&p.position[0]<3.55&&p.position[2]>9.8&&p.position[2]<10.4,p=>Math.hypot(p.pixel.x-w*.65,p.pixel.y-h*.5))
    select('furniture surface',p=>!camera.id.includes('hall')&&!camera.id.includes('stair')&&p.position[1]>(camera.position[1]>3?2.95:.2)&&p.position[1]<(camera.position[1]>3?3.8:1.3)&&(camera.position[1]>3?p.geometricNormal[1]>.3&&p.position[0]<2&&p.position[2]>11:p.position[2]>6&&p.position[2]<9&&p.position[0]>.2&&p.position[0]<4.5),p=>Math.hypot(p.pixel.x-w*.5,p.pixel.y-h*.65))
    select('window reveal',p=>vertical(p)&&(camera.id.includes('stair')?p.position[0]>6.22&&p.position[0]<6.4&&Math.abs(p.geometricNormal[2])>.9&&p.position[2]>14.7&&p.position[2]<15.95:camera.position[1]<3&&p.position[2]>4.86&&p.position[2]<5.06&&Math.abs(p.geometricNormal[0])>.9),p=>camera.id.includes('stair')?Math.abs(p.position[0]-6.26)+Math.abs(p.position[2]-14.71785):Math.abs(p.position[2]-4.98))
    select('occluded contact',p=>luminance(at(hdr.B,w,p.pixel))>.005,p=>{const v=luminance(at(hdr.B,w,p.pixel));return luminance(at(hdr.A,w,p.pixel))/Math.max(.00001,v)})
    const visible=result.points.filter(p=>!p.unavailable),identities=await b.evaluate(`correctness.identify(${JSON.stringify(visible)})`);visible.forEach((p,i)=>p.identity=identities[i])
    for(const p of result.points){if(p.unavailable)continue;p.configurations=Object.fromEntries(configs.map(([name])=>[name,{linearHDR:at(hdr[name],w,p.pixel),displaySRGB:at(display[name],w,p.pixel)}]));p.screenAO=luminance(p.configurations.A.linearHDR)/Math.max(.000001,luminance(p.configurations.B.linearHDR));p.camera=camera.id;references.push(p)}
    const visibility=await b.evaluate('correctness.component(12)'),v=decode(visibility.data,w,h),vraw=Buffer.alloc(w*h*3);for(let i=0;i<vraw.length;i++)vraw[i]=Math.round(Math.max(0,Math.min(1,v[i]))*255);await sharp(vraw,{raw:{width:w,height:h,channels:3}}).png().toFile(`${dir}/sun-visibility.png`)
    writeFileSync(`${dir}/measurements.json`,JSON.stringify(result,null,2));all.push(result)
  }
  writeFileSync(`${out}/results.json`,JSON.stringify(all,null,2))
  if(process.argv.includes('--captures-only')){writeFileSync(`${out}/index.html`,html(all,'../production-performance-before.json'));console.log('PASS complete comparison captures and invariants');return}
  console.log('REFERENCE',references.length,'visible receivers')
  await b.evaluate(`(async()=>{window.auditReferenceProgress='snapshot';const {snapshotReferenceScene}=await import('/tests/browser/sceneReferenceSnapshot.ts');const snapshot=await snapshotReferenceScene(roofWallScene());window.auditReferenceMetadata={...snapshot,data:undefined};window.auditReferenceWorker=new Worker('/tests/browser/lightingCorrectnessReference.worker.ts',{type:'module'});auditReferenceWorker.onmessage=e=>{if(e.data.progress)auditReferenceProgress=e.data.progress;else{window.auditReferenceResult=e.data;auditReferenceWorker.terminate()}};auditReferenceWorker.postMessage({scene:snapshot.data,points:${JSON.stringify(references)},samples:8192});})()`)
  let last=0;const start=Date.now()
  while(!await b.evaluate('!!window.auditReferenceResult')){if(Date.now()-last>15000){console.log('REFERENCE PROGRESS',JSON.stringify(await b.evaluate('auditReferenceProgress')));last=Date.now()}assert.ok(Date.now()-start<1200000,'independent reference completes');await new Promise(r=>setTimeout(r,500))}
  const reference=await b.evaluate('({metadata:auditReferenceMetadata,...auditReferenceResult})');assert.equal(reference.ok,true)
  writeFileSync(`${out}/reference.json`,JSON.stringify(reference,null,2))
  // Bracket diagnostics with restored production shaders, AO and shadow settings.
  const performance=await b.evaluate(`(async()=>{const m=await import('/tests/browser/kitchenFrameMeasurements.ts');const visit=f=>{if(!f)return;const v=f.ref?.current;if(v?.passes)window.auditComposer=v;visit(f.child);visit(f.sibling)};const t=await import('/tests/browser/rendererTestModules.ts');visit(t.getEditorFiber());correctness.setCamera([4.65,1.6,9.95],[2.1,1.25,4.95],60);correctness.setConfig(true,true,true);const diagnostic=await m.measureKitchenFrames(roofWallScene(),auditComposer,{cases:[['diagnostic shader',()=>{}]],restore:()=>{}});await correctness.dispose();const restored=await m.measureKitchenFrames(roofWallScene(),auditComposer);return{diagnostic,restored}})()`)
  writeFileSync(`${out}/performance.json`,JSON.stringify(performance,null,2))
  writeFileSync(`${out}/index.html`,html(all))
  console.log('PASS 30-image matrix, HDR/display differences, measurements, references, GI invariance and restored-renderer performance')
}
function html(results,performancePath='performance.json'){return`<!doctype html><meta charset="utf-8"><title>Colin lighting correctness audit</title><style>body{background:#202228;color:#eee;font:14px system-ui;margin:24px}section{margin:32px 0}.row{display:flex;gap:8px;overflow-x:auto}figure{margin:0;min-width:300px;flex:1}img{width:100%;cursor:zoom-in}figcaption{padding:8px}a{color:#9df}code{color:#fdc}</style><h1>Colin lighting correctness audit</h1><p>Fixed camera, geometry, materials, sun, local lights, sky, exposure and completed GI field. A: shadows/GI/AO; B: shadows/GI; C: GI; D: shadows; E: all three off. GI off removes reflected diffuse transport while retaining cached sky, artist fill and specular reflections.</p><p>Signed difference images: neutral grey = zero; lighter = positive. HDR: 64 byte levels per scene-relative radiance unit. Display: 2 levels per sRGB byte. Exact signed RGB32F differences and original RGBA16F HDR buffers are provided as gzip files. HDR rows are bottom-up; RGB32F differences are top-down, all little endian.</p>${results.map(r=>`<section><h2>${r.camera.id}</h2><code>${JSON.stringify(r.camera)}</code><div class="row">${configs.map(([n])=>`<figure><a href="${r.camera.id}/${n}.png"><img src="${r.camera.id}/${n}.png"></a><figcaption>${n}</figcaption></figure>`).join('')}</div><h3>Linear HDR differences before tone mapping</h3><div class="row">${pairs.map(([a,b])=>`<figure><a href="${r.camera.id}/${a}-${b}-linear.png"><img src="${r.camera.id}/${a}-${b}-linear.png"></a><figcaption>${a} minus ${b}</figcaption></figure>`).join('')}</div><h3>Display differences</h3><div class="row">${pairs.map(([a,b])=>`<figure><img src="${r.camera.id}/${a}-${b}-display.png"><figcaption>${a} minus ${b}</figcaption></figure>`).join('')}</div><div class="row">${['sun-visibility','AO-half-radius','AO-half-intensity'].map(n=>`<figure><img src="${r.camera.id}/${n}.png"><figcaption>${n}</figcaption></figure>`).join('')}</div><a href="${r.camera.id}/measurements.json">Surface measurements and invariants</a></section>`).join('')}<p><a href="reference.json">Independent path reference and BVH visibility</a> · <a href="${performancePath}">Performance</a> · <a href="settings.json">Settings/equivalence checks</a></p>`}
