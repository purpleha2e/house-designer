(async()=>{
 window.updateRegressionFloors(fs=>fs.map(f=>({...f,models:f.models.map(m=>m.modelId==='point-light'?{...m,lightDistance:20.5}:m)})));
 await new Promise(r=>setTimeout(r,1500));
 const s=window.roofWallScene();return {light:s.scene.children.filter(o=>o.isPointLight).map(o=>({position:o.position.toArray(),distance:o.distance,power:o.power,far:o.shadow.camera.far})),pending:s.scene.userData.shaderWarmupPending,gi:s.scene.userData.indirectLighting};
})()
