import fs from 'node:fs'
const evaluate=async expression=>{const r=await fetch('http://127.0.0.1:9187/evaluate',{method:'POST',body:JSON.stringify({expression})}),d=await r.json();if(!r.ok)throw Error(d.error);return d.value},sleep=ms=>new Promise(r=>setTimeout(r,ms))
const original=await evaluate(`(()=>{sunlitReplay.restore();sunlitSources.check();const s=roofWallScene();s.internal.active=true;s.setFrameloop('always');s.invalidate();return {...regressionSunPosition}})()`),results=[]
for(const [name,sun]of [['cached sun direction update',{...original,azimuth:original.azimuth+.03}],['restore original sun',original]]){
 const before=await evaluate(`(()=>{const s=roofWallScene(),version=s.scene.userData.getLightingPerformance().version;window.sunlitIncrementalStart=performance.now();updateRegressionSunPosition(${JSON.stringify(sun)});return version})()`)
 const start=Date.now();while(true){const result=await evaluate(`(()=>{const s=roofWallScene(),g=s.scene.userData.indirectLighting,p=s.scene.userData.getLightingPerformance();return p.version>${before}&&p.complete&&g.state==='ready'&&!g.pendingLighting&&!g.pendingUpdate&&!g.volumePending&&!g.saving?{elapsedMs:performance.now()-sunlitIncrementalStart,profile:p,gi:g}:null})()`);if(result){results.push({name,...result});break}if(Date.now()-start>300000)throw Error('Incremental update timed out');await sleep(500)}
 fs.writeFileSync('docs/sunlit-bounce/incremental-performance.json',JSON.stringify(results,null,2));console.log(name,results.at(-1).elapsedMs)
}
