import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {installAORecovery} from './rendererAORecovery.mjs'

export async function runAOVisual(b,report,save,out,name){
 await installAORecovery(b)
 const folder=`${out}/${name}`;mkdirSync(folder,{recursive:true})
 const cameras=JSON.parse(readFileSync('docs/lighting-correctness/verified/results.json')).map(r=>r.camera)
 cameras.push({id:'07-timeless-bedroom',position:[3.9,4.25,8.1],lookAt:[1.88,3.9,5.8],fov:65},
  {id:'08-sunlit-bedroom',position:[2.15,4,13.7],lookAt:[-.7,3.9,11.8],fov:65},
  {id:'09-bathroom-baseline',...report.initial.camera,fov:60},
  {id:'10-staircase-down',position:[4.8,4.3,15.7],lookAt:[5.2,1.2,15.3],fov:75},
  {id:'11-staircase-up',position:[4,1.7,16],lookAt:[5.2,2.5,15.3],fov:75})
 const bathroom=await b.evaluate(`(async()=>{const {Box3,Vector3}=await import('/tests/browser/rendererTestModules.ts');const s=rendererRecovery.state(),o=s.scene.getObjectByName('model-transform-dcca9ce0-c90a-4bb4-8d17-32134b8c2cab');if(!o)return null;const box=new Box3().setFromObject(o),p=box.getCenter(new Vector3());return{id:'12-bathroom-window',position:[p.x+.45,p.y+.15,p.z+1.3],lookAt:p.toArray(),fov:65,bounds:{min:box.min.toArray(),max:box.max.toArray()}}})()`)
 if(bathroom)cameras.push(bathroom)
 report.visual=[]
 await b.evaluate(`(()=>{
  const s=rendererRecovery.state(),c=s.camera;
  aoRecovery.savedCamera={position:c.position.clone(),rotation:c.quaternion.clone(),fov:c.fov};
  aoRecovery.capture=()=>new Promise((resolve,reject)=>{
   const composer=aoRecovery.composer,render=composer.render;
   composer.render=function(...args){composer.render=render;try{const result=render.apply(this,args);resolve({png:s.gl.domElement.toDataURL('image/png').split(',')[1],camera:{position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov},programs:s.gl.info.programs.length});return result}catch(e){reject(e);throw e}};
   s.scene.userData.displayEffectRevision=(s.scene.userData.displayEffectRevision??0)+1;s.invalidate();
  });
 })()`)
 const compare=async(before,after,path)=>{
  const a=await sharp(before).ensureAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(after).ensureAlpha().raw().toBuffer()
  assert.equal(a.data.length,b.length);const diff=Buffer.alloc(a.data.length);let changedPixels=0,max=0,sum=0,squares=0
  for(let i=0;i<b.length;i+=4){let changed=false;for(let c=0;c<3;c++){const d=Math.abs(a.data[i+c]-b[i+c]);changed||=d!==0;max=Math.max(max,d);sum+=d;squares+=d*d;diff[i+c]=Math.min(255,d*16)}if(changed)changedPixels++;diff[i+3]=255}
  await sharp(diff,{raw:a.info}).png().toFile(path)
  return{pixels:a.info.width*a.info.height,changedPixels,maxChannelError:max,meanAbsoluteError:sum/(b.length/4*3),rms:Math.sqrt(squares/(b.length/4*3)),differenceAmplification:16}
 }
 try{
  for(const camera of cameras){
   await b.evaluate(`(()=>{const c=rendererRecovery.state().camera,v=${JSON.stringify(camera)};c.position.fromArray(v.position);if(v.lookAt)c.lookAt(...v.lookAt);else c.quaternion.fromArray(v.quaternion);c.fov=v.fov;c.updateProjectionMatrix();c.updateMatrixWorld();aoRecovery.ao.firstFrame()})()`)
   await b.evaluate('rendererAudit.sample(1500,false)')
   const captures=[]
   for(const [label,reuse]of [['before',false],['after',true],['repeat',false],['production',null]]){
    await b.evaluate(reuse===null?'aoRecovery.restore()':`aoRecovery.set(${reuse})`);await b.evaluate('rendererAudit.sample(250,false)')
    const capture=await b.evaluate('aoRecovery.capture()'),png=Buffer.from(capture.png,'base64');delete capture.png
    writeFileSync(`${folder}/${camera.id}-${label}.png`,png);captures.push({label,png,...capture})
   }
   assert.deepEqual(captures[0].camera,captures[1].camera)
   const delta=await compare(captures[0].png,captures[1].png,`${folder}/${camera.id}-diff.png`)
   const control=await compare(captures[0].png,captures[2].png,`${folder}/${camera.id}-control-diff.png`)
   const production=await compare(captures[1].png,captures[3].png,`${folder}/${camera.id}-production-diff.png`)
   report.visual.push({camera,captures:captures.map(({png,...meta})=>meta),delta,control,production});save()
   console.log('VISUAL',camera.id,JSON.stringify({delta,control,production}))
  }
 }finally{
  await b.evaluate(`(()=>{const c=rendererRecovery.state().camera,v=aoRecovery.savedCamera;c.position.copy(v.position);c.quaternion.copy(v.rotation);c.fov=v.fov;c.updateProjectionMatrix();c.updateMatrixWorld();aoRecovery.restore();rendererRecovery.state().invalidate()})()`)
 }
 report.visualFinal=await b.evaluate('rendererAudit.snapshot()');save()
 assert.deepEqual(b.errors,[])
 assert.ok(report.visual.every(v=>v.delta.changedPixels===0&&v.control.changedPixels===0&&v.production.changedPixels===0),'Identical camera must have pixel-identical AO output')
}
