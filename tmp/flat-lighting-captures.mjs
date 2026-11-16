import {existsSync,readFileSync,writeFileSync} from 'node:fs'
const out='tmp/flat-lighting/springfield'
for(const [name,mode,strength,fill]of [['combined','Final composite',1,.32],['direct','Direct lighting only',1,.32],['indirect','Probe indirect only',1,.32],['gi-off','Final composite',0,.32],['no-fill','Final composite',1,0],['false-colour','Indirect irradiance false colour',1,.32]]){
 const expression=`(async()=>{const s=perfScene(),u=s.scene.userData.getIndirectUniforms();houseDesignerLighting.setMode('${mode}');u.hdGIProbeStrength.value=${strength};u.hdGIIndoorFill.value=${fill};s.invalidate();await new Promise(r=>setTimeout(r,700));const m=await import('/tests/browser/flatIndirectLighting.ts?floor=1');const samples=await m.captureLandingMaterial('${mode}',${strength},${fill});const panel=document.querySelector('[aria-label="Lighting diagnostics"]');if(panel)panel.style.display='none';return {samples,generation:s.scene.userData.indirectLighting.generation,faces:s.scene.userData.indirectLighting.capturedFaces,programs:s.gl.info.programs.length,exposure:s.gl.toneMappingExposure,toneMapping:s.gl.toneMapping,mode:'${mode}',strength:${strength},fill:${fill}}})()`
 writeFileSync('tmp/flat-lighting/command.json',JSON.stringify({name,expression,screenshot:true}))
 const start=Date.now();while(!existsSync(`${out}/${name}.png`)){if(Date.now()-start>120000)throw Error(name+' timeout');await new Promise(r=>setTimeout(r,250))}
 console.log(name,readFileSync(`${out}/${name}.json`,'utf8').slice(-250))
}
