export async function checkWallSweep(){
 const {Vector3}=await import('/node_modules/.vite/deps/three.js'),s=window.roofWallScene(),{scene,camera,gl}=s;
 const sun=scene.children.find(o=>o.userData.houseDesignerRole==='sun-light'),walls=[];
 scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')walls.push([o,o.castShadow])});
 const original={sun:sun.position.clone(),camera:camera.position.clone(),quaternion:camera.quaternion.clone()};
 const render=()=>{sun.shadow.needsUpdate=true;gl.render(scene,camera);const c=gl.getContext(),width=c.drawingBufferWidth,height=c.drawingBufferHeight,pixels=new Uint8Array(width*height*4);c.readPixels(0,0,width,height,c.RGBA,c.UNSIGNED_BYTE,pixels);return{width,height,pixels}};
 const results=[];
 try{
 for(const [nx,nz,cx,cz,span]of [[1,0,6.65,6.277,3.8],[-1,0,1.35,6.277,3.8],[0,1,4,11.2042021,1.8],[0,-1,4,1.35,1.8]])for(const outward of [2,8,20]){
 camera.position.set(cx+nx*9,4.5,cz+nz*9);camera.lookAt(cx,3.7,cz);camera.updateMatrixWorld();
 sun.position.copy(sun.target.position).add(new Vector3(nx*outward+nz*20,15,nz*outward-nx*20));scene.updateMatrixWorld(true);
 walls.forEach(([o,cast])=>o.castShadow=cast);const actual=render();walls.forEach(([o])=>o.castShadow=false);const reference=render();
 let samples=0,affected=0,maxError=0;
 for(let t=-span;t<=span;t+=.1)for(let y=3.05;y<4.6;y+=.1){
 const p=new Vector3(cx+nz*t,y,cz-nx*t).project(camera),px=Math.floor((p.x+1)*actual.width/2),py=Math.floor((p.y+1)*actual.height/2);if(px<0||py<0||px>=actual.width||py>=actual.height)continue;
 const i=(py*actual.width+px)*4,error=Math.max(...[0,1,2].map(c=>Math.abs(actual.pixels[i+c]-reference.pixels[i+c])));samples++;if(error>3)affected++;maxError=Math.max(maxError,error);
 }
 results.push({nx,nz,outward,samples,affected,maxError});
 }
 return results;
 }finally{walls.forEach(([o,cast])=>o.castShadow=cast);sun.position.copy(original.sun);sun.shadow.needsUpdate=true;camera.position.copy(original.camera);camera.quaternion.copy(original.quaternion);camera.updateMatrixWorld();s.invalidate()}
}
