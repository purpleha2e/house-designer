export async function checkRoofSweep() {
 const {Vector3,Raycaster}=await import('/node_modules/.vite/deps/three.js');
 const s=window.roofWallScene(),{scene,camera,gl}=s;
 const sun=scene.children.find(o=>o.userData.houseDesignerRole==='sun-light'),tops=[];
 scene.traverse(o=>{if(o.userData.houseDesignerRole==='roof-top'){tops.push(o);o.material.shadowSide=2}});
 const saved={position:sun.position.clone(),camera:camera.position.clone(),quaternion:camera.quaternion.clone()};
 const render=()=>{sun.shadow.needsUpdate=true;gl.render(scene,camera);const c=gl.getContext(),width=c.drawingBufferWidth,height=c.drawingBufferHeight,pixels=new Uint8Array(width*height*4);c.readPixels(0,0,width,height,c.RGBA,c.UNSIGNED_BYTE,pixels);return {width,height,pixels}};
 const results=[];
 try{
 for(const side of [-1,1])for(const [sx,sy]of [[side*20,5],[side*20,20],[-side*20,15],[-side*20,17],[0,30]]){
 camera.position.set(4+side*10,10,14);camera.lookAt(4,5.7,6);camera.updateMatrixWorld();
 sun.position.copy(sun.target.position).add(new Vector3(sx,sy,5));scene.updateMatrixWorld(true);
 tops.forEach(o=>o.receiveShadow=true);const actual=render();tops.forEach(o=>o.receiveShadow=false);const reference=render();
 let samples=0,affected=0,maxError=0;
 for(let x=side<0?1.9:4.25;x<=(side<0?3.75:6.1);x+=.09)for(let z=2.2;z<10.2;z+=.19){
 const h=new Raycaster(new Vector3(x,10,z),new Vector3(0,-1,0)).intersectObjects(tops,false)[0];if(!h)continue;
 const normal=h.face.normal.clone().transformDirection(h.object.matrixWorld),direction=sun.position.clone().sub(sun.target.position).normalize();if(normal.dot(direction)<.04)continue;
 const p=h.point.clone().project(camera),px=Math.floor((p.x+1)*actual.width/2),py=Math.floor((p.y+1)*actual.height/2);if(px<0||py<0||px>=actual.width||py>=actual.height)continue;
 const i=(py*actual.width+px)*4,error=Math.max(...[0,1,2].map(c=>Math.abs(actual.pixels[i+c]-reference.pixels[i+c])));samples++;if(error>3)affected++;maxError=Math.max(maxError,error);
 }
 results.push({side,sx,sy,samples,affected,maxError});
 }
 return results;
 }finally{tops.forEach(o=>o.receiveShadow=true);sun.position.copy(saved.position);sun.shadow.needsUpdate=true;camera.position.copy(saved.camera);camera.quaternion.copy(saved.quaternion);camera.updateMatrixWorld();s.invalidate()}
}
