import fs from 'node:fs'
const profile=fs.readdirSync('node_modules/.cache/browser-test-profiles').filter(p=>p.startsWith('lighting-audit-')).map(p=>({p,time:fs.statSync(`node_modules/.cache/browser-test-profiles/${p}`).birthtimeMs})).sort((a,b)=>b.time-a.time)[0].p
const [port]=fs.readFileSync(`node_modules/.cache/browser-test-profiles/${profile}/DevToolsActivePort`,'utf8').split('\n')
const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json(),target=targets.find(t=>t.url.includes('editorRegression'))
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}))
const old=`float tolerance=max(.015,depth*3./min(hdLocalSunSize.x,hdLocalSunSize.y));\n    if(sampleNormal.a>.5&&abs(sampleValue.a-depth)<tolerance&&dot(sampleNormal.xyz,normal)>.95){`
const replacement=`vec2 ndc=(cell+.5)/hdLocalSunSize*2.-1.;
    vec3 sampleView=vec3((ndc.x+projectionMatrix[2][0])*sampleValue.a/projectionMatrix[0][0],
      (ndc.y+projectionMatrix[2][1])*sampleValue.a/projectionMatrix[1][1],-sampleValue.a);
    float planeDistance=abs(dot(mat3(viewMatrix)*sampleNormal.xyz,-vViewPosition-sampleView));
    if(sampleNormal.a>.5&&planeDistance<.015&&dot(sampleNormal.xyz,normal)>.95){`
const expression=`(async()=>{const s=perfScene(),materials=new Set();s.scene.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m)materials.add(m)});for(const m of materials){const prior=m.onBeforeCompile,key=m.customProgramCacheKey;m.onBeforeCompile=function(shader,renderer){prior.call(this,shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('uniform mat4 hdLocalSunViewProjection;','uniform mat4 hdLocalSunViewProjection;\\nuniform mat4 projectionMatrix;').replace(${JSON.stringify(old)},${JSON.stringify(replacement)})};m.customProgramCacheKey=function(){return key.call(this)+'-plane-check'};m.needsUpdate=true}const module=await import('/src/shaderWarmupState.ts');module.requestShaderWarmup(s.scene);s.invalidate();return materials.size})()`
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1){console.log(JSON.stringify(m.result));ws.close()}})
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))
