import { Pass, ShaderPass } from 'postprocessing'
import { Data3DTexture, DataTexture, DataUtils,FloatType, GLSL3, HalfFloatType, Matrix4, NearestFilter, RedFormat, RedIntegerFormat,
  RGBAFormat, ShaderMaterial, UnsignedIntType, Vector3, Vector4, WebGLRenderTarget, type Camera, type DirectionalLight, type Texture, type WebGLRenderer } from 'three'
import { createDiffuseImageReader } from './diffuseSceneSnapshot'
import type { AtlasRow, SurfaceAtlas } from './lumenSurfaceCache'
import { firstBounceFragment } from './lumenFirstBounce'
import { maxLumenOpenings, skyVisibilityFragment, type LumenOpening } from './lumenSkyVisibility'
import { surfaceBounceFragment } from './lumenSurfaceBounce'
import { LumenFloorDetail } from './lumenFloorDetail'

export const lumenViews = ['Final lighting', 'Cache albedo', 'Cached reflected sunlight', 'Screen-space bounce', 'Off-screen fallback', 'First bounce', 'Trace hits', 'Frame-time cost', 'Off-screen carpet bounce', 'Window daylight', 'Cache occupancy', 'Surface normals', 'Material identity', 'Raw indirect', 'Resolved indirect', 'Bright contribution source', 'Cached sky irradiance', 'Direct solar diffuse', 'Exterior ground skylight', 'First bounce from geometry', 'Later diffuse bounce', 'Total GI (4 EV)', 'Total GI (normal exposure)'] as const
export const lumenVertex = `out vec2 screenUV;
void main() { screenUV = uv; gl_Position = vec4(position.xy,0.,1.); }`
export const lumenLookup = `
precision highp usampler3D;
uniform usampler3D cells;
uniform highp sampler3D distanceField;
uniform bool useDistanceField;
uniform sampler2D surfacePoint, surfaceNormal, surfaceAlbedo, reflectedSun, sceneDepth;
uniform sampler2D supportLo, supportHi;
uniform int layered;
uniform int patchLimit,traceLimit;
uniform vec4 groundBounds;
uniform float groundY;
uniform vec3 groundDiffuse;
uniform bool hasFloorDetail;
uniform bool filterFeedback;
bool onGround(vec3 p){return all(greaterThanEqual(p.xz,groundBounds.xy)) && all(lessThanEqual(p.xz,groundBounds.zw));}
uniform mat4 inverseProjection, cameraWorld;
uniform vec3 gridOrigin;
uniform float spacing;
vec3 worldAt(vec2 uv, float depth) {
  vec4 p = inverseProjection * vec4(uv*2.-1., depth*2.-1., 1.);
  return (cameraWorld * vec4(p.xyz/p.w,1.)).xyz;
}
// One-sided derivatives keep depth discontinuities out of the receiver guide.
vec3 boundaryNormal(vec2 uv,vec3 p){
  vec2 step=1./vec2(textureSize(sceneDepth,0));
  vec2 l=uv-vec2(step.x,0.),r=uv+vec2(step.x,0.),b=uv-vec2(0.,step.y),t=uv+vec2(0.,step.y);
  vec3 dx0=p-worldAt(l,texture(sceneDepth,l).r),dx1=worldAt(r,texture(sceneDepth,r).r)-p;
  vec3 dy0=p-worldAt(b,texture(sceneDepth,b).r),dy1=worldAt(t,texture(sceneDepth,t).r)-p;
  vec3 n=cross(dot(dx0,dx0)<dot(dx1,dx1)?dx0:dx1,dot(dy0,dy0)<dot(dy1,dy1)?dy0:dy1);
  return n/max(length(n),1.e-10);
}
int cellAt(ivec3 c) {
  if(any(lessThan(c,ivec3(0))) || any(greaterThanEqual(c,textureSize(cells,0)))) return -1;
  return int(texelFetch(cells,c,0).r)-1;
}
ivec2 address(int index) { return ivec2(index % 256,index / 256); }
bool floorIrradiance(ivec2 a){return hasFloorDetail && texelFetch(surfaceNormal,a,0).w==1.;}
float receiverIdentity(ivec2 a){
  float id=mod(texelFetch(supportLo,a,0).a*255.+texelFetch(supportHi,a,0).a*65280.+texelFetch(surfacePoint,a,0).w*103.,2047.);
  return floorIrradiance(a)?-2.-id:id;
}
int nextPatch(ivec2 a) {
  return layered==0 ? -1 : int(texelFetch(surfaceAlbedo,a,0).a+.5)-1;
}
bool containsPoint(ivec2 a,vec3 delta,float tolerance) {
  vec3 lo=(texelFetch(supportLo,a,0).rgb*2.-1.)*spacing;
  vec3 hi=(texelFetch(supportHi,a,0).rgb*2.-1.)*spacing;
  return all(greaterThanEqual(delta,lo-tolerance)) && all(lessThanEqual(delta,hi+tolerance));
}
int receiverAt(vec3 p, vec3 n) {
  ivec3 c = ivec3(floor((p-gridOrigin)/spacing));
  float best = 1.7; int index = -1;
  const ivec3 shifts[7] = ivec3[7](ivec3(0),ivec3(1,0,0),ivec3(-1,0,0),ivec3(0,1,0),ivec3(0,-1,0),ivec3(0,0,1),ivec3(0,0,-1));
  for(int k=0;k<7;k++) {
    int candidate = cellAt(c+shifts[k]); if(candidate<0) continue;
    for(int layer=0;layer<patchLimit && candidate>=0;layer++){
    ivec2 a = address(candidate);
    vec3 sn = texelFetch(surfaceNormal,a,0).xyz, delta = (p-texelFetch(surfacePoint,a,0).xyz)/spacing;
    float alignment=abs(dot(n,sn)),plane=abs(dot(delta,sn))*spacing;
    if(layered==1 && (alignment<.85 || plane>.016 || !containsPoint(a,delta*spacing,.008))){candidate=nextPatch(a);continue;}
    if(layered==1 && k==0 && alignment>.99 && plane<.0015)return candidate;
    float score = dot(delta,delta)*.1 + 9.*plane/spacing + 3.*(1.-alignment);
    if(layered==0)score=dot(delta,delta)+5.*plane/spacing+3.*(1.-alignment);
    if(score<best) { best=score; index=candidate; }
    candidate=nextPatch(a);
    }
  }
  return index;
}`

const displayFragment = `in vec2 screenUV; out vec4 colour;
uniform sampler2D displayColour,bounceTexture,rawIndirect,rawGeometry,skyVisibility; uniform vec3 skyBase,groundRadiance; uniform mat4 worldToView; uniform int diagnostic;
uniform sampler2D frontTransparency,floorAlbedo;
uniform bool hasFrontTransparency;
uniform vec3 sunGain;
${lumenLookup}
void main() {
  colour=texture(displayColour,screenUV);
  float d=texture(sceneDepth,screenUV).r;
  vec3 p=worldAt(screenUV,d), n=normalize(cross(dFdx(p),dFdy(p)));
  if(d>=1.) {if(diagnostic>=2)colour.rgb=vec3(0.);return;}
  if(diagnostic>=10 && diagnostic<=12 || diagnostic==16){
    vec3 model=colour.rgb;
    int i=receiverAt(p,n);colour.rgb=diagnostic==10?model*.55:vec3(0.);
    if(i<0)return;
    ivec2 at=address(i);vec3 normal=texelFetch(surfaceNormal,at,0).xyz;
    if(diagnostic==10){
      vec3 pt=texelFetch(surfacePoint,at,0).xyz;
      vec3 lo=layered==1?pt+(texelFetch(supportLo,at,0).xyz*2.-1.)*spacing:gridOrigin+floor((pt-gridOrigin)/spacing)*spacing;
      vec3 hi=layered==1?pt+(texelFetch(supportHi,at,0).xyz*2.-1.)*spacing:lo+spacing;
      vec3 edge=min(p-lo,hi-p)/max(fwidth(p),vec3(.00001)),axis=abs(normal);
      float pixels=axis.x>=max(axis.y,axis.z)?min(edge.y,edge.z):axis.y>=axis.z?min(edge.x,edge.z):min(edge.x,edge.y);
      colour.rgb=mix(model*.8+vec3(.015,.035,.025),vec3(.12,.7,.45),1.-smoothstep(.2,1.2,pixels));
    }
    if(diagnostic==11)colour.rgb=normal*.5+.5;
    if(diagnostic==12){float id=texelFetch(surfacePoint,at,0).w;colour.rgb=fract((id+1.)*vec3(.61803,.75488,.41421));}
    if(diagnostic==16){vec4 w=texelFetch(skyVisibility,at,0);vec2 v=dot(normal,cameraWorld[3].xyz-p)>=0.?w.xy:w.zw;colour.rgb=v.x*skyBase+v.y*groundRadiance;}
    return;
  }
  if(diagnostic==13){colour.rgb=texture(rawIndirect,screenUV).rgb;return;}
  if(diagnostic==0 || diagnostic>=3){
    vec2 size=vec2(textureSize(bounceTexture,0)), pixel=screenUV*size-.5;
    ivec2 base=ivec2(floor(pixel)); vec2 f=fract(pixel);
    float weight=0.;vec3 indirect=vec3(0.);
    ivec2 bound=ivec2(size)-1;
    float first=texelFetch(rawGeometry,clamp(base,ivec2(0),bound),0).w,id=first;
    bool mixed=first!=texelFetch(rawGeometry,clamp(base+ivec2(1,0),ivec2(0),bound),0).w ||
       first!=texelFetch(rawGeometry,clamp(base+ivec2(0,1),ivec2(0),bound),0).w ||
       first!=texelFetch(rawGeometry,clamp(base+ivec2(1),ivec2(0),bound),0).w;
    vec4 finish=hasFloorDetail?texelFetch(floorAlbedo,ivec2(gl_FragCoord.xy),0):vec4(0.);
    int receiver=-1;
    if(mixed || (finish.a>0. && id>=-1.)){
      n=boundaryNormal(screenUV,p);
      receiver=receiverAt(p,n);
      id=receiver>=0?receiverIdentity(address(receiver)):-1.;
    }
    for(int j=0;j<2;j++)for(int k=0;k<2;k++){
      ivec2 xy=clamp(base+ivec2(k,j),ivec2(0),ivec2(size)-1);
      vec4 sampleGI=texelFetch(bounceTexture,xy,0);
      vec4 surface=texelFetch(rawGeometry,xy,0);
      if(abs(surface.w-id)>.25 || (surface.w!=-1. && dot(n,surface.xyz)<.85))continue;
      vec2 uv=(vec2(xy)+.5)/size;
      vec4 farView=inverseProjection*vec4(uv*2.-1.,1.,1.);
      vec3 neighbour=(cameraWorld*vec4(farView.xyz*(-sampleGI.a/farView.z),1.)).xyz;
      float w=(k==0?1.-f.x:f.x)*(j==0?1.-f.y:f.y)*(1.-smoothstep(.02,.08,abs(dot(n,neighbour-p))));
      weight+=w; indirect+=w*sampleGI.rgb;
    }
    indirect/=max(weight,.0001);
    if(id< -1. && (diagnostic==0 || diagnostic==7 || diagnostic==21 || diagnostic==22 || diagnostic==14)){
      if(finish.a==0. && receiver<0)receiver=receiverAt(p,n);
      if(finish.a>0.)indirect*=finish.rgb;
      else if(receiver>=0)indirect*=texelFetch(surfaceAlbedo,address(receiver),0).rgb;
      else indirect=vec3(0.);
    }
    // N8AO supplies the opacity in front of the ground. The total-GI views
    // show the same transmitted value that the normal composite adds.
    if((diagnostic==0 || diagnostic==7 || diagnostic==21 || diagnostic==22) &&
      hasFrontTransparency && abs(p.y-groundY)<.006 && onGround(p)){
      indirect*=1.-texture(frontTransparency,screenUV).a;
    }
    if(diagnostic==0 || diagnostic==7)colour.rgb+=indirect;
    else colour.rgb=indirect*(diagnostic>=17 && diagnostic<=21?16.:1.);
    return;
  }
  int i=receiverAt(p,n);
  if(i<0) return;
  ivec2 uv=address(i);
  colour.rgb=diagnostic==1 ? mix(colour.rgb,texelFetch(surfaceAlbedo,uv,0).rgb,.85) : texelFetch(reflectedSun,uv,0).rgb*sunGain;
}`

// Resolve the nine distinct directional strata at tracing resolution. Equal
// weights on a continuous plane avoid printing the sample pattern onto walls.
const resolveFragment=`in vec2 screenUV;layout(location=0) out vec4 colour;layout(location=1) out vec4 historyMeta;
  uniform sampler2D rawBounce,rawGeometry,previousBounce,previousGeometry;
  uniform mat4 inverseProjection,cameraWorld,worldToView,previousViewProjection,previousView;
  uniform int reuse;
  vec2 encodeNormal(vec3 n){
    n/=max(.0001,abs(n.x)+abs(n.y)+abs(n.z));
    return n.z>=0.?n.xy:(1.-abs(n.yx))*vec2(n.x>=0.?1.:-1.,n.y>=0.?1.:-1.);
  }
  vec3 positionAt(ivec2 xy,vec2 size,float depth){
    vec2 uv=(vec2(xy)+.5)/size;
    vec4 ray=inverseProjection*vec4(uv*2.-1.,1.,1.);
    return ray.xyz*(-depth/ray.z);
  }
  void main(){
    ivec2 xy=ivec2(gl_FragCoord.xy), size=textureSize(rawBounce,0);
    vec4 center=texelFetch(rawBounce,xy,0);
    vec4 surface=texelFetch(rawGeometry,xy,0);
    vec3 p=positionAt(xy,vec2(size),center.a), n=mat3(worldToView)*surface.xyz;
    vec3 sum=center.rgb; float weight=1.;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      if(x==0 && y==0)continue;
      ivec2 at=clamp(xy+ivec2(x,y),ivec2(0),size-1);
      vec4 other=texelFetch(rawBounce,at,0);
      vec4 g=texelFetch(rawGeometry,at,0);
      if(g.w!=surface.w || dot(g.xyz,surface.xyz)<.97)continue;
      vec3 delta=positionAt(at,vec2(size),other.a)-p;
      float w=(1.-smoothstep(.018,.055,abs(dot(delta,n))))*(1.-smoothstep(.35,.65,abs(delta.z)));
      sum+=w*other.rgb;weight+=w;
    }
    colour=vec4(sum/weight,center.a);
    vec2 normal=encodeNormal(surface.xyz);
    historyMeta=vec4(normal,surface.w,1.);
    if(reuse==0 || surface.w==-1.)return;
    vec4 world=cameraWorld*vec4(p,1.),clip=previousViewProjection*world;
    if(clip.w<=0.)return;
    vec2 oldUV=clip.xy/clip.w*.5+.5;
    if(any(lessThan(oldUV,vec2(0.))) || any(greaterThanEqual(oldUV,vec2(1.))))return;
    ivec2 old=ivec2(oldUV*vec2(size));vec4 prior=texelFetch(previousBounce,old,0);
    vec4 meta=texelFetch(previousGeometry,old,0);
    if(meta.z!=surface.w || distance(meta.xy,normal)>.06 || abs(prior.a+(previousView*world).z)>.025)return;
    historyMeta.w=min(meta.w+1.,16.);
    colour.rgb=mix(prior.rgb,colour.rgb,1./historyMeta.w);
  }`

const atlasTexture = (data:Float32Array, width:number, height:number) => {
  const texture = new DataTexture(data,width,height,RGBAFormat,FloatType)
  texture.minFilter = texture.magFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}

function sunMaterial(compare:boolean) {
  return new ShaderMaterial({name:compare?'LumenFilteredSun':'LumenDepthSun',glslVersion:GLSL3,depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:{surfacePoint:{value:null},surfaceNormal:{value:null},albedo:{value:null},shadowDepth:{value:null},sunMatrix:{value:new Matrix4()},
      sunDirection:{value:new Vector3()},sunEnergy:{value:new Vector3()},bias:{value:0},normalBias:{value:0}},
    vertexShader:lumenVertex, fragmentShader:`uniform sampler2D surfacePoint,surfaceNormal,albedo;
      uniform highp ${compare?'sampler2DShadow':'sampler2D'} shadowDepth;
      uniform mat4 sunMatrix; uniform vec3 sunDirection,sunEnergy; uniform float bias,normalBias; out vec4 colour;
      void main(){
        ivec2 uv=ivec2(gl_FragCoord.xy);vec3 n=texelFetch(surfaceNormal,uv,0).xyz;
        float cosine=dot(n,sunDirection);vec3 p=texelFetch(surfacePoint,uv,0).xyz+n*sign(cosine)*normalBias;
        vec4 clip=sunMatrix*vec4(p,1.);vec3 q=clip.xyz/clip.w;q.z+=bias;
        float visibility=0.;
        if(all(greaterThanEqual(q,vec3(0.)))&&all(lessThanEqual(q,vec3(1.))))
          visibility=${compare?'texture(shadowDepth,q)':'step(q.z,texture(shadowDepth,q.xy).r)'};
        colour=vec4(texelFetch(albedo,uv,0).rgb*sunEnergy*abs(cosine)*visibility/3.14159265,sign(cosine)*visibility);
      }` })
}

export class LumenViewportPass extends Pass {
  readonly floorDetail = new LumenFloorDetail()
  private readonly floorView = new Matrix4()
  private floorWidth=0
  private floorHeight=0
  readonly imageReader = createDiffuseImageReader()
  // Exposed to the editor's startup fullscreen-shader warm-up.
  readonly readbackMaterial = this.imageReader.material
  readonly displayMaterial: ShaderMaterial
  readonly traceMaterial: ShaderMaterial
  readonly skyMaterial:ShaderMaterial
  private readonly skyPass:ShaderPass
  readonly skyAtlas=new WebGLRenderTarget(1,1,{count:2,type:HalfFloatType,depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter})
  readonly surfaceBounceMaterial:ShaderMaterial
  private readonly surfaceBouncePass:ShaderPass
  private readonly surfaceBounceAtlases=[this.skyAtlas.clone(),this.skyAtlas.clone()]
  private surfaceBounceRow=0
  private surfaceBounceOrder=0
  private apertures?:LumenOpening[]
  private openingKey=''
  private skyRow=0
  private cachePixelsPerFrame=128
  cacheBudgetMs=1.7
  private readonly cacheQueries:{gl:WebGL2RenderingContext;query:WebGLQuery;disjoint:number;pixels:number;stage:number;issued:number}[]=[]
  skyGpuPeakMs=0
  readonly cacheProfile={firstDaylightMs:0,firstDaylightAt:0,daylightCompleteMs:0,feedbackOneMs:0,feedbackTwoMs:0,
    uploads:[] as {name:string;cpuMs:number}[],submissions:[0,0,0],peakCpuMs:[0,0,0],peakGpuMs:[0,0,0],firstGpuMs:[0,0,0],gpuSamples:[0,0,0],deferred:0,expiredQueries:0,sunAtlasDraws:0}
  private cacheStarted=0
  private cacheStage=-1
  private readonly clearSky=new Float32Array(4)
  private readonly nextGround=new Vector3()
  get skyReady() {return this.skyRow>=this.skyAtlas.width*this.skyAtlas.height}
  readonly filteredSunMaterial = sunMaterial(true)
  readonly rawSunMaterial = sunMaterial(false)
  private readonly sunPass = new ShaderPass(this.filteredSunMaterial)
  private readonly sunAtlas = new WebGLRenderTarget(1,1,{type:HalfFloatType,depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter})
  sun?:DirectionalLight
  readTransparency?:()=>Texture|undefined
  onPresent?: (sunChanged:boolean)=>void
  onTiming?: (cpuMs:number,gpuMs:number|null)=>void
  private query?: {gl:WebGL2RenderingContext; handle:WebGLQuery; elapsed:number; disjoint:number}
  private lastQuery=-Infinity
  private lastShadow?:Texture
  private readonly lightDirection=new Vector3()
  private readonly lightEnergy=new Vector3()
  private readonly publishedSunEnergy=new Vector3()
  private cpuSun?:DataTexture
  private readonly trace: ShaderPass
  private inspection?:{x:number;y:number;resolve:(value:Record<string,number[]>)=>void;reject:(error:Error)=>void}
  private inspectionTarget?:WebGLRenderTarget
  inspect(x:number,y:number) {
    this.inspection?.reject(new Error('Inspection superseded'))
    return new Promise<Record<string,number[]>>((resolve,reject)=>{this.inspection={x,y,resolve,reject}})
  }
  private inspectPixel(renderer:WebGLRenderer,input:WebGLRenderTarget,output:WebGLRenderTarget){
    const pick=this.inspection
    if(!pick)return
    this.inspection=undefined
    const rt=this.inspectionTarget??=new WebGLRenderTarget(this.bounce.width,this.bounce.height,{type:FloatType,depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter})
    rt.setSize(this.bounce.width,this.bounce.height)
    const x=Math.max(0,Math.min(rt.width-1,Math.floor(pick.x*rt.width))), y=Math.max(0,Math.min(rt.height-1,Math.floor((1-pick.y)*rt.height)))
    rt.scissor.set(x&~1,y&~1,2,2);rt.scissorTest=true
    const u=this.traceMaterial.uniforms
    const previous=u.diagnostic.value;u.diagnostic.value=5
    const fields=['receiverPositionMaterial','receiverNormalSide','hitPositionMaterial','hitNormalVisibility','outgoingRadianceWeight','weightedReflectedRGBRoute','directSky','indirectRGB','sunVisibilitySkyGround','receiverAlbedo','cacheSamplePositionMaterial','integratedExteriorGroundRGB','directSolarDiffuse','firstBounceFromGeometry','laterDiffuseBounce','traceHitRatios']
    try{
      const reads=fields.map((name,index)=>{
        u.inspectField.value=index+1;this.trace.render(renderer,input,rt)
        const values=new Float32Array(4)
        return renderer.readRenderTargetPixelsAsync(rt,x,y,1,1,values).then(()=>[name,Array.from(values)] as const)
      })
      if(this.previous && previous===0){
        const values=new Uint16Array(4)
        reads.push(renderer.readRenderTargetPixelsAsync(this.previous,x,y,1,1,values).then(()=>['resolvedDiffuseAndDepth',Array.from(values,DataUtils.fromHalfFloat)] as const))
      }
      const readColour=(target:WebGLRenderTarget,name:string)=>{
        if(target.texture.type!==HalfFloatType)return
        const values=new Uint16Array(4)
        const px=Math.min(target.width-1,Math.max(0,Math.floor(pick.x*target.width)))
        const py=Math.min(target.height-1,Math.max(0,Math.floor((1-pick.y)*target.height)))
        reads.push(renderer.readRenderTargetPixelsAsync(target,px,py,1,1,values).then(()=>[name,Array.from(values,DataUtils.fromHalfFloat)] as const))
      }
      readColour(input,'baseSceneLinear')
      if(previous===0 && !this.renderToScreen)readColour(output,'composedSceneLinear')
      void Promise.all(reads).then(rows=>{
        const sample=Object.fromEntries(rows)
        const albedo=sample.receiverAlbedo
        if(albedo && sample.receiverPositionMaterial[3]>=0){
          const direct=[sample.directSolarDiffuse,sample.directSky,sample.indirectRGB]
          sample.incomingDiffuseIrradiance=albedo.slice(0,3).map((rho,c)=>rho>0?Math.PI*direct.reduce((sum,rgb)=>sum+rgb[c],0)/rho:0)
          if(sample.baseSceneLinear && sample.composedSceneLinear)sample.compositedIndirect=sample.composedSceneLinear.slice(0,3).map((v,c)=>v-sample.baseSceneLinear[c])
        }
        pick.resolve(sample)
      },pick.reject)
    }catch(error){pick.reject(error as Error)}
    finally{u.inspectField.value=0;u.diagnostic.value=previous}
  }
  readonly resolveMaterial:ShaderMaterial
  private readonly resolve:ShaderPass
  private readonly bounce = new WebGLRenderTarget(1,1,{count:2,type:HalfFloatType,minFilter:NearestFilter,magFilter:NearestFilter,depthBuffer:false})
  private readonly resolved=this.bounce.clone()
  private readonly alternate=this.bounce.clone()
  private previous:WebGLRenderTarget|undefined
  private historyFrames=0
  private sequence=0
  private previousMode=-1
  get bounceReady(){return this.surfaceBounceOrder>=2}
  get refining(){return this.skyReady && (!this.bounceReady || this.historyFrames<16 && this.temporalMode(this.displayMaterial.uniforms.diagnostic.value))}
  private temporalMode(mode:number){return mode===0 || mode===3 || mode===4 || mode===5 || mode===7 || mode===14 || mode>=17}
  private resetHistory(){this.historyFrames=0;this.sequence=0;this.previous=undefined}
  private resetSurfaceBounce(){
    this.surfaceBounceRow=0;this.surfaceBounceOrder=0
    this.displayMaterial.uniforms.surfaceBounceReady.value=0
    this.resetHistory()
  }
  private resources: Texture[] = []
  private readonly view: Camera
  constructor(view: Camera) {
    super('Lumen first bounce')
    this.view = view
    this.enabled = false
    this.needsDepthTexture = true
    this.displayMaterial = new ShaderMaterial({ name:'LumenSurfaceDisplay', glslVersion:GLSL3,
      depthTest:false, depthWrite:false, toneMapped:false, vertexShader:lumenVertex, fragmentShader:displayFragment,
      uniforms:{ auditTraceStage:{value:0},screenSteps:{value:12},bounceRays:{value:2},samplePattern:{value:0},sequence:{value:0},inspectField:{value:0},rawGeometry:{value:this.bounce.textures[1]},rawIndirect:{value:this.bounce.texture},displayColour:{value:null}, bounceTexture:{value:this.resolved.texture}, sceneDepth:{value:null}, cells:{value:null}, distanceField:{value:null},useDistanceField:{value:false},surfacePoint:{value:null},
        surfaceNormal:{value:null}, surfaceAlbedo:{value:null}, supportLo:{value:null}, supportHi:{value:null}, layered:{value:0},patchLimit:{value:4},traceLimit:{value:96},nearDirections:{value:64},skyStrata:{value:3}, reflectedSun:{value:null},sunGain:{value:new Vector3(1,1,1)}, diagnostic:{value:0},
        skyVisibility:{value:this.skyAtlas.texture},groundVisibility:{value:this.skyAtlas.textures[1]},skyBase:{value:new Vector3()},groundRadiance:{value:new Vector3()},
        surfaceBounceFront:{value:this.surfaceBounceAtlases[0].texture},surfaceBounceBack:{value:this.surfaceBounceAtlases[0].textures[1]},surfaceBounceReady:{value:0},
        frontTransparency:{value:null},hasFrontTransparency:{value:false},
        floorAlbedo:{value:this.floorDetail.target.texture},hasFloorDetail:{value:false},filterFeedback:{value:true},
        groundBounds:{value:new Vector4(1,1,-1,-1)},groundY:{value:0},groundDiffuse:{value:new Vector3()},
        openingCount:{value:0},openingCenter:{value:Array.from({length:maxLumenOpenings},()=>new Vector4())},
        openingTransmission:{value:new Float32Array(maxLumenOpenings).fill(1)},
        openingDepth:{value:new Float32Array(maxLumenOpenings)},
        openingAxis:{value:Array.from({length:maxLumenOpenings},()=>new Vector4())},overcast:{value:0},
        spacing:{value:1}, gridOrigin:{value:new Vector3()}, inverseProjection:{value:new Matrix4()},cameraWorld:{value:new Matrix4()},
        worldToView:{value:new Matrix4()},viewProjection:{value:new Matrix4()} } })
    this.fullscreenMaterial = this.displayMaterial
    this.skyMaterial=new ShaderMaterial({name:'LumenApertureVisibility',glslVersion:GLSL3,
      depthTest:false,depthWrite:false,toneMapped:false,uniforms:this.displayMaterial.uniforms,
      vertexShader:lumenVertex,fragmentShader:skyVisibilityFragment(lumenLookup)})
    this.skyPass=new ShaderPass(this.skyMaterial)
    this.surfaceBounceMaterial=new ShaderMaterial({name:'LumenSurfaceBounce',glslVersion:GLSL3,depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{...this.displayMaterial.uniforms,previousFront:{value:null},previousBack:{value:null},surfaceBounceOrder:{value:0},surfaceBounceSamples:{value:8},surfaceBouncePattern:{value:0}},
      vertexShader:lumenVertex,fragmentShader:surfaceBounceFragment(lumenLookup)})
    this.surfaceBouncePass=new ShaderPass(this.surfaceBounceMaterial)
    this.traceMaterial = new ShaderMaterial({name:'LumenQuarterResolutionTrace',glslVersion:GLSL3,
      depthTest:false,depthWrite:false,toneMapped:false,uniforms:this.displayMaterial.uniforms,
      vertexShader:lumenVertex,fragmentShader:firstBounceFragment(lumenLookup)})
    this.trace=new ShaderPass(this.traceMaterial)
    this.resolveMaterial=new ShaderMaterial({name:'LumenDirectionalResolve',glslVersion:GLSL3,depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{rawBounce:{value:this.bounce.texture},rawGeometry:{value:this.bounce.textures[1]},previousBounce:{value:null},previousGeometry:{value:null},
        inverseProjection:this.displayMaterial.uniforms.inverseProjection,cameraWorld:this.displayMaterial.uniforms.cameraWorld,
        worldToView:this.displayMaterial.uniforms.worldToView,
        previousView:{value:new Matrix4()},previousViewProjection:{value:new Matrix4()},reuse:{value:0}},vertexShader:lumenVertex,fragmentShader:resolveFragment})
    this.resolve=new ShaderPass(this.resolveMaterial)
  }
  setDepthTexture(texture:Texture) { this.displayMaterial.uniforms.sceneDepth.value = texture }
  get hasDistanceField() { return !!this.displayMaterial.uniforms.distanceField.value }
  setDistanceTracing(requested:boolean) {
    const active = requested && this.hasDistanceField
    const uniform = this.displayMaterial.uniforms.useDistanceField
    if (uniform.value !== active) {
      uniform.value = active
      this.skyRow = 0
      this.cacheStage = -1
      this.resetSurfaceBounce()
    }
    return active
  }
  setDaylight(openings:LumenOpening[],base:Vector3,solar:Vector3,overcast:boolean,compactCenter?:number[]) {
    const u=this.displayMaterial.uniforms
    this.nextGround.copy(base).multiplyScalar(overcast?7/6:17/15).addScaledVector(solar,1/Math.PI).multiplyScalar(.2)
    if(!u.skyBase.value.equals(base) || !u.groundRadiance.value.equals(this.nextGround))this.resetSurfaceBounce()
    u.skyBase.value.copy(base)
    u.groundRadiance.value.copy(this.nextGround)
    if(this.apertures===openings && u.overcast.value===Number(overcast))return
    this.apertures=openings
    u.overcast.value=Number(overcast)
    const [x,y,z]=compactCenter??this.view.position.toArray()
    const distance=(o:LumenOpening)=>(o.center[0]-x)**2+(o.center[1]-y)**2+(o.center[2]-z)**2
    const local=openings.slice().sort((a,b)=>distance(a)-distance(b)).slice(0,maxLumenOpenings)
    u.openingCount.value=local.length
    local.forEach((o,i)=>{
      const offset=o.exteriorOffset??0
      u.openingCenter.value[i].set(o.center[0]-o.u[2]*offset,o.center[1],o.center[2]+o.u[0]*offset,o.height)
      u.openingAxis.value[i].set(o.u[0],o.u[1],o.u[2],o.width)
      u.openingTransmission.value[i]=o.transmission??1
      u.openingDepth.value[i]=2*offset
    })
    const key=JSON.stringify([overcast,local.map(({center,u,width,height,exteriorOffset,transmission})=>[center,u,width,height,exteriorOffset,transmission])])
    if(this.openingKey!==key){this.openingKey=key;this.skyRow=0;this.cacheStage=-1;this.resetSurfaceBounce()}
  }
  setSize(width:number,height:number) {
    this.bounce.setSize(Math.max(1,Math.ceil(width/4)),Math.max(1,Math.ceil(height/4)))
    this.resolved.setSize(this.bounce.width,this.bounce.height)
    this.alternate.setSize(this.bounce.width,this.bounce.height);this.resetHistory()
  }
  setFloorMeshes(meshes:Parameters<LumenFloorDetail['setFloors']>[0]) {
    this.floorDetail.setFloors(meshes)
    this.floorWidth=0
  }
  releaseCache() {
    this.enabled = false
    this.floorWidth=0
    this.displayMaterial.uniforms.hasFloorDetail.value=false
    this.resources.forEach(t => t.dispose())
    this.resources = []
    this.resetSurfaceBounce()
    for(const task of this.cacheQueries)task.gl.deleteQuery(task.query)
    this.cacheQueries.length=0;this.cacheStage=-1;this.skyGpuPeakMs=0
    this.cpuSun=undefined; this.lastShadow=undefined; this.skyRow=0; this.apertures=undefined
    Object.assign(this.cacheProfile,{firstDaylightMs:0,firstDaylightAt:0,daylightCompleteMs:0,feedbackOneMs:0,feedbackTwoMs:0})
    for (const name of ['cells','distanceField','surfacePoint','surfaceNormal','surfaceAlbedo','supportLo','supportHi','reflectedSun']) this.displayMaterial.uniforms[name].value = null
    this.displayMaterial.uniforms.useDistanceField.value = false
  }
  upload(atlas:SurfaceAtlas) {
    this.installAtlas(atlas,this.createAtlasTextures(atlas))
  }
  private createAtlasTextures(atlas:SurfaceAtlas){
    const [x,y,z] = atlas.dimensions, grid = new Data3DTexture(atlas.cells,x,y,z)
    grid.format=RedIntegerFormat; grid.type=UnsignedIntType; grid.internalFormat='R32UI'; grid.needsUpdate=true
    const textures:Record<string,Texture>={cells:grid,surfacePoint:atlasTexture(atlas.positions,atlas.width,atlas.height),
      surfaceNormal:atlasTexture(atlas.normals,atlas.width,atlas.height),surfaceAlbedo:atlasTexture(atlas.albedo,atlas.width,atlas.height)}
    if (atlas.distanceField) {
      const texture = new Data3DTexture(atlas.distanceField.values, x, y, z)
      texture.format = RedFormat
      texture.type = FloatType
      texture.internalFormat = 'R32F'
      texture.needsUpdate = true
      textures.distanceField = texture
    }
    for(const [slot,data] of [['supportLo',atlas.boundsLo],['supportHi',atlas.boundsHi]] as const){
      if(!data)continue
      const texture=new DataTexture(data,atlas.width,atlas.height,RGBAFormat)
      texture.needsUpdate=true;textures[slot]=texture
    }
    return textures
  }
  private pendingAtlas?:{atlas:SurfaceAtlas;textures:Record<string,Texture>;slots:string[];targets:[string,WebGLRenderTarget][];complete:()=>void}
  queueAtlas(atlas:SurfaceAtlas,complete:()=>void){
    this.cancelUpload()
    const textures=this.createAtlasTextures(atlas)
    const targets:[string,WebGLRenderTarget][]=this.resources.length?[]:[
      ['sun atlas allocation',this.sunAtlas],['daylight atlas allocation',this.skyAtlas],
      ['first feedback atlas allocation',this.surfaceBounceAtlases[0]],['second feedback atlas allocation',this.surfaceBounceAtlases[1]],
    ]
    for(const [,target] of targets)target.setSize(atlas.width,atlas.height)
    this.cacheProfile.uploads=[]
    this.pendingAtlas={atlas,textures,slots:Object.keys(textures),targets,complete}
  }
  stepUpload(renderer:WebGLRenderer){
    const pending=this.pendingAtlas
    if(!pending)return false
    const slot=pending.slots.shift()
    if(slot){
      const start=performance.now()
      renderer.initTexture(pending.textures[slot])
      this.cacheProfile.uploads.push({name:slot,cpuMs:performance.now()-start})
      return true
    }
    const target=pending.targets.shift()
    if(target){
      const start=performance.now()
      renderer.initRenderTarget(target[1])
      this.cacheProfile.uploads.push({name:target[0],cpuMs:performance.now()-start})
      return true
    }
    this.pendingAtlas=undefined
    this.installAtlas(pending.atlas,pending.textures)
    pending.complete()
    return false
  }
  cancelUpload(){
    if(!this.pendingAtlas)return
    for(const texture of Object.values(this.pendingAtlas.textures))texture.dispose()
    this.pendingAtlas=undefined
  }
  private installAtlas(atlas:SurfaceAtlas,textures:Record<string,Texture>){
    this.releaseCache()
    this.cacheStarted=performance.now()
    const u=this.displayMaterial.uniforms
    for(const [slot,texture] of Object.entries(textures))u[slot].value=texture
    u.gridOrigin.value.fromArray(atlas.origin); u.spacing.value=atlas.spacing
    u.groundBounds.value.fromArray(atlas.ground?.bounds??[1,1,-1,-1]);u.groundY.value=atlas.ground?.height??0
    u.groundDiffuse.value.fromArray(atlas.ground?.rho??[0,0,0])
    this.sunAtlas.setSize(atlas.width,atlas.height)
    u.reflectedSun.value=this.sunAtlas.texture
    this.skyAtlas.setSize(atlas.width,atlas.height)
    for(const target of this.surfaceBounceAtlases)target.setSize(atlas.width,atlas.height)
    this.resources=Object.values(textures)
    u.layered.value=atlas.boundsLo && atlas.boundsHi?1:0
  }
  relight(radiance:Float32Array) {
    this.resetSurfaceBounce()
    this.lastShadow=undefined
    if(!this.cpuSun){
      this.cpuSun=atlasTexture(radiance,this.skyAtlas.width,this.skyAtlas.height)
      this.resources.push(this.cpuSun)
    }else{
      this.cpuSun.image.data=radiance;this.cpuSun.needsUpdate=true
    }
    this.displayMaterial.uniforms.reflectedSun.value=this.cpuSun
    this.displayMaterial.uniforms.sunGain.value.setScalar(1)
  }
  updateRows(rows:AtlasRow[]) {
    const u=this.displayMaterial.uniforms
    const update=(texture:DataTexture,row:number,data:Float32Array)=>{
      const start=row*texture.image.width*4
      const pixels=texture.image.data as Float32Array
      pixels.set(data,start)
      texture.addUpdateRange(start,data.length)
      texture.needsUpdate=true
    }
    for(const row of rows){
      update(u.surfacePoint.value,row.row,row.positions)
      update(u.surfaceNormal.value,row.row,row.normals)
      update(u.surfaceAlbedo.value,row.row,row.albedo)
    }
    if(rows.length){this.lastShadow=undefined;this.resetSurfaceBounce()}
  }
  private updateSun(renderer:WebGLRenderer,input:WebGLRenderTarget) {
    const sun=this.sun, depth=sun?.shadow.map?.depthTexture
    if(!sun || !depth || !sun.castShadow) return false
    const mat=depth.compareFunction==null ? this.rawSunMaterial : this.filteredSunMaterial
    const u=mat.uniforms, display=this.displayMaterial.uniforms
    this.lightDirection.setFromMatrixPosition(sun.matrixWorld).sub(sun.target.getWorldPosition(this.lightEnergy)).normalize()
    this.lightEnergy.set(sun.color.r,sun.color.g,sun.color.b).multiplyScalar(sun.intensity)
    const energyChanged=!this.publishedSunEnergy.equals(this.lightEnergy)
    this.publishedSunEnergy.copy(this.lightEnergy)
    display.sunGain.value.copy(this.lightEnergy)
    if(this.lastShadow===depth && u.sunDirection.value.equals(this.lightDirection) &&
      u.sunMatrix.value.equals(sun.shadow.matrix) && u.bias.value===sun.shadow.bias && u.normalBias.value===sun.shadow.normalBias)return energyChanged
    this.lastShadow=depth;u.sunDirection.value.copy(this.lightDirection);u.sunEnergy.value.setScalar(1)
    u.sunMatrix.value.copy(sun.shadow.matrix);u.bias.value=sun.shadow.bias;u.normalBias.value=sun.shadow.normalBias
    u.shadowDepth.value=depth;u.surfacePoint.value=display.surfacePoint.value
    u.surfaceNormal.value=display.surfaceNormal.value;u.albedo.value=display.surfaceAlbedo.value
    this.sunPass.fullscreenMaterial=mat
    this.sunPass.render(renderer,input,this.sunAtlas)
    this.cacheProfile.sunAtlasDraws++
    display.reflectedSun.value=this.sunAtlas.texture
    return true
  }
  render(renderer:WebGLRenderer,input:WebGLRenderTarget,output:WebGLRenderTarget) {
    const u=this.displayMaterial.uniforms
    const timing=u.diagnostic.value===7, start=timing?performance.now():0
    let gpuMs:number|null=null, measuring=false
    if(this.query){
      const {gl,handle,disjoint}=this.query
      if(gl.getQueryParameter(handle,gl.QUERY_RESULT_AVAILABLE)){
        if(!gl.getParameter(disjoint))gpuMs=gl.getQueryParameter(handle,gl.QUERY_RESULT)/1e6
        gl.deleteQuery(handle);this.query=undefined
      }
    }
    if(timing && !this.query && start-this.lastQuery>300){
      this.lastQuery=start
      const gl=renderer.getContext() as WebGL2RenderingContext
      const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2')
      if(ext && !gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)){
        const handle=gl.createQuery()
        if(handle){gl.beginQuery(ext.TIME_ELAPSED_EXT,handle);this.query={gl,handle,elapsed:ext.TIME_ELAPSED_EXT,disjoint:ext.GPU_DISJOINT_EXT};measuring=true}
      }
    }
    try {
      u.displayColour.value=input.texture
      u.frontTransparency.value=this.readTransparency?.()??null
      u.hasFrontTransparency.value=!!u.frontTransparency.value
      u.inverseProjection.value.copy(this.view.projectionMatrixInverse)
      u.cameraWorld.value.copy(this.view.matrixWorld)
      u.worldToView.value.copy(this.view.matrixWorldInverse)
      u.viewProjection.value.multiplyMatrices(this.view.projectionMatrix,this.view.matrixWorldInverse)
      if(!this.floorView.equals(u.viewProjection.value) || input.width!==this.floorWidth || input.height!==this.floorHeight){
        const available=this.floorDetail.render(renderer,this.view,u.sceneDepth.value,input.width,input.height)
        if(u.hasFloorDetail.value!==available)this.resetHistory()
        u.hasFloorDetail.value=available
        this.floorView.copy(u.viewProjection.value);this.floorWidth=input.width;this.floorHeight=input.height
      }
      const sunChanged=this.updateSun(renderer,input)
      if(sunChanged)this.resetSurfaceBounce()
      if(!this.skyReady || this.previousMode!==u.diagnostic.value)this.resetHistory()
      this.previousMode=u.diagnostic.value
      while(this.cacheQueries.length){
        const {gl,query,disjoint,pixels,stage,issued}=this.cacheQueries[0]
        const available=gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)
        if(!available && performance.now()-issued<250)break
        if(!available){this.cacheProfile.expiredQueries++;this.cachePixelsPerFrame=256}
        if(available && !gl.getParameter(disjoint)){
            const ms=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6
            this.skyGpuPeakMs=Math.max(this.skyGpuPeakMs,ms)
            this.cacheProfile.peakGpuMs[stage]=Math.max(this.cacheProfile.peakGpuMs[stage],ms)
            if(this.cacheProfile.gpuSamples[stage]++===0)this.cacheProfile.firstGpuMs[stage]=ms
            if(stage===this.cacheStage)this.cachePixelsPerFrame=Math.max(256,Math.min(3072,pixels*2,Math.floor(pixels*this.cacheBudgetMs/Math.max(.05,ms))))
        }
        gl.deleteQuery(query);this.cacheQueries.shift()
      }
      if((!this.skyReady || !this.bounceReady) && this.cacheQueries.length<2) {
        const skyPending=!this.skyReady
        const stage=skyPending?0:this.surfaceBounceOrder+1
        if(this.cacheStage!==stage){this.cacheStage=stage;this.cachePixelsPerFrame=128}
        const cpuStarted=performance.now()
        // Bound work on the first few frames. Clear stale factors before
        // publishing the first updated row of a changed visibility volume.
        if(skyPending && this.skyRow===0){
          this.skyAtlas.scissorTest=false
          renderer.setRenderTarget(this.skyAtlas)
          const gl=renderer.getContext() as WebGL2RenderingContext
          gl.clearBufferfv(gl.COLOR,0,this.clearSky)
          gl.clearBufferfv(gl.COLOR,1,this.clearSky)
        }
        const offset=skyPending?this.skyRow:this.surfaceBounceRow
        const target=skyPending?this.skyAtlas:this.surfaceBounceAtlases[this.surfaceBounceOrder%2]
        const column=offset%target.width,row=Math.floor(offset/target.width)
        const width=column===0 && this.cachePixelsPerFrame>=target.width?target.width:Math.min(this.cachePixelsPerFrame,target.width-column)
        const rows=width===target.width?Math.min(target.height-row,Math.floor(this.cachePixelsPerFrame/width)):1
        const pixels=width*rows
        target.scissor.set(column,row,width,rows)
        target.scissorTest=true
        const gl=renderer.getContext() as WebGL2RenderingContext
        const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2')
        const query=ext && !gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)?gl.createQuery():null
        if(query)gl.beginQuery(ext.TIME_ELAPSED_EXT,query)
        try{
          if(skyPending)this.skyPass.render(renderer,input,target)
          else{
            const prior=this.surfaceBounceAtlases[(this.surfaceBounceOrder+1)%2]
            const bounce=this.surfaceBounceMaterial.uniforms
            bounce.previousFront.value=prior.texture
            bounce.previousBack.value=prior.textures[1]
            bounce.surfaceBounceOrder.value=this.surfaceBounceOrder
            this.surfaceBouncePass.render(renderer,input,target)
          }
        }finally{
          if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);this.cacheQueries.push({gl,query,disjoint:ext.GPU_DISJOINT_EXT,pixels,stage,issued:cpuStarted})}
        }
        this.cacheProfile.submissions[stage]++
        this.cacheProfile.peakCpuMs[stage]=Math.max(this.cacheProfile.peakCpuMs[stage],performance.now()-cpuStarted)
        if(skyPending){
          if(this.skyRow===0){
            this.cacheProfile.firstDaylightAt=performance.now()
            this.cacheProfile.firstDaylightMs=this.cacheProfile.firstDaylightAt-this.cacheStarted
          }
          this.skyRow+=pixels
          if(this.skyReady)this.cacheProfile.daylightCompleteMs=performance.now()-this.cacheStarted
        }
        else{
          this.surfaceBounceRow+=pixels
          if(this.surfaceBounceRow>=target.width*target.height){
            this.surfaceBounceRow=0
            this.surfaceBounceOrder++
            if(this.surfaceBounceOrder===1)this.cacheProfile.feedbackOneMs=performance.now()-this.cacheStarted
            else this.cacheProfile.feedbackTwoMs=performance.now()-this.cacheStarted
            u.surfaceBounceFront.value=target.texture
            u.surfaceBounceBack.value=target.textures[1]
            u.surfaceBounceReady.value=this.surfaceBounceOrder
            this.resetHistory()
          }
        }
        if(!query)this.cachePixelsPerFrame=Math.max(256,this.cachePixelsPerFrame)
      }else if(this.cacheQueries.length>=2)this.cacheProfile.deferred++
      const moved=!this.resolveMaterial.uniforms.previousViewProjection.value.equals(u.viewProjection.value)
      const settled=this.historyFrames>=16 && !moved && this.temporalMode(u.diagnostic.value)
      if(!settled && (u.diagnostic.value===0 || (u.diagnostic.value>=3 && u.diagnostic.value<=9) || (u.diagnostic.value>=13 && u.diagnostic.value!==16))) {
        const temporal=this.temporalMode(u.diagnostic.value) && this.skyReady
        u.sequence.value=temporal?this.sequence:0
        this.trace.render(renderer,input,this.bounce)
        const ru=this.resolveMaterial.uniforms
        const target=this.previous===this.resolved?this.alternate:this.resolved
        const prior=this.previous??this.alternate
        ru.reuse.value=temporal && !!this.previous?1:0
        ru.previousBounce.value=prior.texture;ru.previousGeometry.value=prior.textures[1]
        this.resolve.render(renderer,this.bounce,target)
        u.bounceTexture.value=target.texture
        if(temporal){
          this.historyFrames=moved?1:this.historyFrames+1
          if(this.historyFrames<=16)this.sequence=(this.sequence+1)%64
          this.previous=target
          ru.previousView.value.copy(this.view.matrixWorldInverse);ru.previousViewProjection.value.copy(u.viewProjection.value)
        }
      }
      renderer.setRenderTarget(this.renderToScreen ? null : output)
      renderer.render(this.scene,this.camera)
      if(this.inspection)this.inspectPixel(renderer,input,output)
      this.onPresent?.(sunChanged)
    } finally {
      if(measuring)this.query!.gl.endQuery(this.query!.elapsed)
      if(timing)this.onTiming?.(performance.now()-start,gpuMs)
    }
  }
  dispose() { this.cancelUpload();this.releaseCache(); this.imageReader.dispose(); this.bounce.dispose(); this.resolved.dispose(); this.alternate.dispose(); this.resolve.dispose(); this.trace.dispose();this.sunAtlas.dispose();
    this.skyPass.dispose(); this.skyAtlas.dispose(); this.surfaceBouncePass.dispose();this.surfaceBounceMaterial.dispose()
    for(const target of this.surfaceBounceAtlases)target.dispose()
    this.inspectionTarget?.dispose();this.floorDetail.dispose()
    if(this.query)this.query.gl.deleteQuery(this.query.handle)
    this.rawSunMaterial.dispose(); this.filteredSunMaterial.dispose(); this.displayMaterial.dispose() }
}
