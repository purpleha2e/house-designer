(async()=>{
 const {OrthographicCamera,WebGLRenderTarget,Raycaster,Vector3,MeshStandardMaterial,Mesh}=await import('/node_modules/.vite/deps/three.js');
 const s=window.roofWallScene(),meshes=[];s.scene.updateMatrixWorld(true);
 s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')meshes.push(o)});
 const ray=new Raycaster(),hits=[];
 for(const y of [.2,.6,1,1.4,1.8,2.2]){
   ray.set(new Vector3(-2.69,y,4.328),new Vector3(-1,0,0));const h=ray.intersectObjects(meshes,false)[0];if(!h)continue;
   const m=h.object.material[h.face.materialIndex],u=s.gl.properties.get(m).uniforms;
   hits.push({y,p:h.point.toArray(),normal:h.face.normal.toArray(),mat:h.face.materialIndex,color:m.color?.toArray(),roughness:m.roughness,uniforms:u&&Object.fromEntries(Object.entries(u).filter(([k])=>['hdRoomLightEnabled','hdPointLightRoomIds','hdGIEnabled','hdGICapture','hdGIUseVolume','hdRoomLightFloorRange'].includes(k)).map(([k,v])=>[k,v.value]))})
 }
 const camera=new OrthographicCamera(-.65,.65,1.15,-1.15,.01,5);camera.position.set(-1.5,1.2,4.55);camera.lookAt(-3.24,1.2,4.55);camera.updateMatrixWorld(true);
 const target=new WebGLRenderTarget(256,256),point=s.scene.children.find(o=>o.isPointLight),intensity=point.shadow.intensity;
 const sample=()=>{s.gl.setRenderTarget(target);s.gl.render(s.scene,camera);const values=[];for(const y of [.2,.4,.6,.8,1,1.2,1.4,1.6,1.8,2,2.2]){const p=new Vector3(-3.24,y,4.55).project(camera),pixel=new Uint8Array(4);s.gl.readRenderTargetPixels(target,Math.floor((p.x+1)*128),Math.floor((p.y+1)*128),1,1,pixel);values.push({y,rgb:[...pixel.slice(0,3)]})}return values};
 const before=sample();point.shadow.intensity=0;const noShadow=sample();point.shadow.intensity=intensity;
 const uniforms=[];for(const o of meshes)for(const m of o.material){const u=s.gl.properties.get(m).uniforms;if(u?.hdGIEnabled){uniforms.push([u.hdGIEnabled,u.hdGIEnabled.value]);u.hdGIEnabled.value=0}}
 const noGI=sample();for(const [u,v]of uniforms)u.value=v;
 s.gl.setRenderTarget(null);target.dispose();s.invalidate();return {hits,before,noShadow,noGI,point:point.position.toArray()};
})()
