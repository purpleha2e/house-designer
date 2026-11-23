export async function measureHouseProbes(points,samples=8192){
const T=await import('/node_modules/three/build/three.module.js');const {houseBounceFragment}=await import('/src/lightingLab/houseShaders.ts');const lab=window.houseLightingLab;
const positions=new Float32Array(points.length*4),normals=new Float32Array(points.length*4);points.forEach((p,i)=>{positions.set([...p.point,1],i*4);normals.set([...p.normal,1],i*4)});
const texture=data=>{const t=new T.DataTexture(data,points.length,1,T.RGBAFormat,T.FloatType);t.needsUpdate=true;return t},p=texture(positions),n=texture(normals);
let shader=houseBounceFragment.replace('varying float updateBlend,updateSample;','uniform float updateBlend,updateSample;');
shader=shader.replace('out vec4 colour;','uniform sampler2D probePositions,probeNormals;out vec4 colour;').replace('vec4 receiver=texture(receivers,uv)','vec4 receiver=texelFetch(probePositions,ivec2(gl_FragCoord.xy),0)').replace('normalize(texture(normals,uv).xyz)','normalize(texelFetch(probeNormals,ivec2(gl_FragCoord.xy),0).xyz)').replace('colour=vec4(mix(previous.rgb/max(previous.a,.001),sum/float(rayCount),previous.a<.5?1.:updateBlend),1.);','colour=vec4(sum/float(rayCount),1.);');
const uniforms={...lab.uniforms,rayCount:{value:256},updateBlend:{value:1},updateSample:{value:0},probePositions:{value:p},probeNormals:{value:n}};
const material=new T.ShaderMaterial({glslVersion:T.GLSL3,defines:lab.bounceMaterial.defines,uniforms,vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:shader,depthWrite:false,depthTest:false});
const target=new T.WebGLRenderTarget(points.length,1,{type:T.FloatType,depthBuffer:false}),quad=new T.Mesh(new T.PlaneGeometry(2,2),material),scene=new T.Scene(),camera=new T.Camera();scene.add(quad);
const values=new Float32Array(points.length*4),sum=new Float64Array(points.length*3),batches=Math.ceil(samples/256);
for(let b=0;b<batches;b++){uniforms.updateSample.value=b;lab.renderer.setRenderTarget(target);lab.renderer.render(scene,camera);lab.renderer.setRenderTarget(null);await lab.renderer.readRenderTargetPixelsAsync(target,0,0,points.length,1,values);for(let i=0;i<points.length;i++)for(let c=0;c<3;c++)sum[i*3+c]+=values[i*4+c]/batches;}
p.dispose();n.dispose();target.dispose();material.dispose();quad.geometry.dispose();return points.map((p,i)=>({...p,rgb:Array.from(sum.slice(i*3,i*3+3))}));
}
