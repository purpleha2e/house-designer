// Compare actual GPU shadow masks against the original closest-hit traversal.
// Uses representative cards throughout the house, including imported furniture.
export const houseShadowTraversalCheck = `(async()=>{
  const lab=houseLightingLab,r=lab.renderer;
  const {ShaderMaterial,GLSL3}=await import('/node_modules/three/build/three.module.js');
  const {houseVisibilityFragment,houseQuadVertex}=await import('/src/lightingLab/houseShaders.ts');
  const targets=[lab.visibility.clone(),lab.visibility.clone()];
  const materials=[false,true].map(reference=>new ShaderMaterial({glslVersion:GLSL3,
    uniforms:lab.uniforms,vertexShader:houseQuadVertex,fragmentShader:houseVisibilityFragment,
    defines:reference?{HOUSE_REFERENCE_SHADOWS:1}:{BVH_STACK_DEPTH:lab.data.bvhStackDepth},depthTest:false,depthWrite:false}));
  const step=lab.step;lab.step=()=>{};
  const previousMaterial=lab.quad.material,previousGeometry=lab.quad.geometry;
  try{
    const ids=Array.from({length:256},(_,i)=>Math.floor(i*lab.data.cards.length/256));
    for(let pass=0;pass<2;pass++){
      lab.quad.material=materials[pass];lab.quad.geometry=lab.tileGeometry;
      await r.compileAsync(lab.fullScene,lab.flatCamera);
      r.setRenderTarget(targets[pass]);r.clear();r.autoClear=false;
      for(let offset=0;offset<ids.length;offset+=32)lab.renderPass(materials[pass],targets[pass],ids.slice(offset,offset+32));
      r.autoClear=true;r.setRenderTarget(null);
    }
    const pixels=await Promise.all(targets.map(async target=>{
      const values=new Float32Array(target.width*target.height*4);
      await r.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,values);return values;
    }));
    let differences=0,covered=0;
    for(const id of ids)for(let y=0;y<16;y++)for(let x=0;x<16;x++){
      const i=((Math.floor(id/32)*16+y)*targets[0].width+(id%32)*16+x)*4;
      if(pixels[0][i+3]>.5)covered++;for(let c=0;c<4;c++)if(pixels[0][i+c]!==pixels[1][i+c])differences++;
    }
    return {cards:ids.length,covered,differences};
  }finally{lab.step=step;lab.quad.material=previousMaterial;lab.quad.geometry=previousGeometry;
    r.autoClear=true;r.setRenderTarget(null);materials.forEach(m=>m.dispose());targets.forEach(t=>t.dispose());}
})()`
