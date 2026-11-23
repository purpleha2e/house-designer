/** Offline diffuse reference: independent 32-bounce paths, no cached lighting. */
export async function renderHouseReference({width=570,height=480,samples=256}={}) {
 const T=await import('/node_modules/three/build/three.module.js');
 const {houseBounceFragment}=await import('/src/lightingLab/houseShaders.ts');
 const lab=window.houseLightingLab,r=lab.renderer;
 if(!lab.uniforms.prototypeDaylight.value||lab.uniforms.activeLightCount.value||lab.uniforms.sunColour.value.lengthSq())throw Error('This reference supports window daylight with room lamps and direct sun off.');
 const originalStep=lab.step;lab.step=()=>{};
 const target=(count=1)=>new T.WebGLRenderTarget(width,height,{count,type:T.FloatType,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:count>1});
 const primary=target(3),history=[target(),target()];
 const geometryScene=new T.Scene();
 const captures=lab.scene.children[0].material.map(m=>new T.ShaderMaterial({glslVersion:T.GLSL3,side:m.side,uniforms:m.uniforms,
 vertexShader:`uniform mat3 mapMatrix;out vec3 point,normalWorld;out vec2 finishUV;void main(){point=position;normalWorld=normal;finishUV=(mapMatrix*vec3(uv,1.)).xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
 fragmentShader:`uniform sampler2D finishMap;uniform vec3 finishColour,emission;uniform float alphaCut,daylightEmitter;in vec3 point,normalWorld;in vec2 finishUV;layout(location=0)out vec4 receiver;layout(location=1)out vec4 direction;layout(location=2)out vec4 finish;void main(){vec4 texel=texture(finishMap,finishUV);if(texel.a<alphaCut)discard;receiver=vec4(point,1.);direction=vec4(normalize(normalWorld),1.);finish=daylightEmitter>.5?vec4(emission,-1.):vec4(finishColour*texel.rgb,1.);}` }));
 geometryScene.add(new T.Mesh(lab.displayGeometry,captures));
 const oldClear=r.getClearColor(new T.Color()),oldAlpha=r.getClearAlpha();r.setClearColor(0,0);r.setRenderTarget(primary);r.render(geometryScene,lab.camera);
 const prefix=houseBounceFragment.slice(0,houseBounceFragment.indexOf('uniform float daylightEnabled'));
 const uniforms={...lab.uniforms,viewReceivers:{value:primary.textures[0]},viewNormals:{value:primary.textures[1]},viewFinishes:{value:primary.textures[2]},previous:{value:history[0].texture},resolution:{value:new T.Vector2(width,height)},batch:{value:0}};
 const mat=new T.ShaderMaterial({glslVersion:T.GLSL3,defines:{BVH_STACK_DEPTH:lab.data.bvhStackDepth},uniforms,depthTest:false,depthWrite:false,
 vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:prefix+`
 uniform sampler2D viewReceivers,viewNormals,viewFinishes,previous;uniform vec2 resolution;uniform uint batch;uniform float daylightEnabled;uniform vec3 skyColour;out vec4 colour;
 uint state;float randomValue(){state=state*1664525u+1013904223u;uint x=state;x^=x>>16;x*=2246822519u;x^=x>>13;x*=3266489917u;x^=x>>16;return (float(x)+.5)/4294967296.;}
 void main(){vec2 pixel=gl_FragCoord.xy/resolution;vec4 primary=texture(viewReceivers,pixel),base=texture(viewFinishes,pixel);vec3 sum=vec3(0.);
 if(primary.a<.5){colour=vec4(0.,0.,0.,1.);return;}
 if(base.a<0.){colour=vec4(base.rgb*daylightEnabled,1.);return;}
 state=uint(gl_FragCoord.x)+uint(gl_FragCoord.y)*uint(resolution.x)+batch*747796405u+2891336453u;
 for(int sampleId=0;sampleId<4;sampleId++){
 vec3 origin=primary.xyz,n=normalize(texture(viewNormals,pixel).xyz),throughput=base.rgb,value=vec3(0.);
 for(int depth=0;depth<32;depth++){
 origin+=n*.012;vec3 tangent=normalize(cross(abs(n.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.),n)),bitangent=cross(n,tangent);
 float a=randomValue(),phi=2.*PI*randomValue();vec3 d=tangent*sqrt(a)*cos(phi)+bitangent*sqrt(a)*sin(phi)+n*sqrt(1.-a);
 vec2 uv;float distance,side;vec3 hitNormal;if(!castSurfaceRay(origin,d,uv,distance,side,hitNormal)){value=throughput*skyColour;break;}
 vec4 finish=readFinish(uv);if(finish.a<0.){value=throughput*finish.rgb*daylightEnabled;break;}if(side<0.)break;
 throughput*=clamp(finish.rgb,vec3(0.),vec3(1.));
 if(depth>=3){float survive=max(max(throughput.r,throughput.g),throughput.b);if(randomValue()>=survive)break;throughput/=survive;}
 origin+=d*distance;n=hitNormal;
 }sum+=value;
 }
 colour=vec4(mix(texture(previous,pixel).rgb,sum*.25,1./(float(batch)+1.)),1.);
 }`});
 const quad=new T.Mesh(new T.PlaneGeometry(2,2),mat),scene=new T.Scene(),camera=new T.Camera();scene.add(quad);
 window.hallReferenceProgress={samples:0,total:samples};let index=0;const fencePixel=new Float32Array(4);
 for(let b=0;b<Math.ceil(samples/4);b++){
  uniforms.batch.value=b;uniforms.previous.value=history[index].texture;index=1-index;r.setRenderTarget(history[index]);r.render(scene,camera);r.setRenderTarget(null);
  if(b%8===7){await r.readRenderTargetPixelsAsync(history[index],0,0,1,1,fencePixel);window.hallReferenceProgress.samples=(b+1)*4;}await new Promise(resolve=>setTimeout(resolve,0));
 }
 const linear=new Float32Array(width*height*4);await r.readRenderTargetPixelsAsync(history[index],0,0,width,height,linear);
 const display=new T.ShaderMaterial({uniforms:{source:{value:history[index].texture}},depthTest:false,depthWrite:false,
 vertexShader:'varying vec2 vUV;void main(){vUV=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`uniform sampler2D source;varying vec2 vUV;void main(){gl_FragColor=texture2D(source,vUV);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`});
 quad.material=display;r.setRenderTarget(null);r.render(scene,camera);const image=r.domElement.toDataURL('image/png');
 const measurements=[[-.9,.2],[-.7,.2],[-.4,.75],[.6,.5]].map(([x,y])=>{const at=(Math.floor((y+1)*.5*height)*width+Math.floor((x+1)*.5*width))*4;return Array.from(linear.slice(at,at+3))});
 r.setClearColor(oldClear,oldAlpha);lab.step=originalStep;primary.dispose();history.forEach(t=>t.dispose());captures.forEach(m=>m.dispose());mat.dispose();display.dispose();quad.geometry.dispose();
 return {image,width,height,samples,measurements,exposure:r.toneMappingExposure,camera:{position:lab.camera.position.toArray(),quaternion:lab.camera.quaternion.toArray()},method:'Independent 32-bounce diffuse paths; prototype window radiance; authored reflectance; no lighting cache; shared transport geometry and material atlas.'};
}

