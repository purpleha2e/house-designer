import {writeFileSync} from 'node:fs';
import {lightingBrowser} from '../../tests/browser/lightingHarness.mjs';
const browser=await lightingBrowser();
try {
 await browser.call('Page.navigate',{url:'http://127.0.0.1:5186/tmp/roof-artifact-audit/index.html?loft'});
 await browser.wait('window.springfieldWallScene?.()?.scene.userData.progressiveStartup?.phase==="full"');
 const result=await browser.evaluate(`(async()=>{
 const p=await(await fetch('/springfield_14.json')).json();const s=springfieldWallScene();
 const c=p.threeDView.camera;s.camera.position.set(c.position.x,c.position.y,c.position.z);s.camera.quaternion.set(c.quaternion.x,c.quaternion.y,c.quaternion.z,c.quaternion.w);s.camera.updateMatrixWorld();s.scene.updateMatrixWorld(true);
 await s.gl.compileAsync(s.scene,s.camera);s.gl.setRenderTarget(null);s.gl.render(s.scene,s.camera);
 const image=s.gl.domElement.toDataURL();
 const {Raycaster,Vector2}=await import('/tests/browser/rendererTestModules.ts');
 const samples=[];for(let y=-.2;y<.35;y+=.025)for(let x=-.8;x<.6;x+=.025){const r=new Raycaster();r.setFromCamera(new Vector2(x,y),s.camera);const hits=r.intersectObject(s.scene,true).filter(h=>{let o=h.object;while(o){if(!o.visible)return false;o=o.parent}return true});if(hits[0]){const h=hits[0];samples.push({x,y,point:h.point.toArray(),role:h.object.userData.houseDesignerRole,name:h.object.name,floorId:h.object.userData.floorId,faceIndex:h.faceIndex,normal:h.face.normal.toArray(),material:(Array.isArray(h.object.material)?h.object.material[h.face.materialIndex]:h.object.material).color?.getHexString()})}}
 return {image,samples,width:s.gl.domElement.width,height:s.gl.domElement.height};})()`);
 writeFileSync('tmp/roof-artifact-audit/before.png',Buffer.from(result.image.split(',')[1],'base64'));delete result.image;writeFileSync('tmp/roof-artifact-audit/samples.json',JSON.stringify(result,null,2));console.log({width:result.width,height:result.height,roles:[...new Set(result.samples.map(s=>s.role))],errors:browser.errors});
}finally{browser.close()}

