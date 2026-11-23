import { shaderStructs, shaderIntersectFunction } from 'three-mesh-bvh'
import { HOUSE_COLUMNS, HOUSE_TILE } from './houseGeometry'
import { LAB_FILTER_RADIUS, LAB_FILTER_SIGMA } from './calibration'

export const houseQuadVertex = `attribute vec2 tileOrigin;attribute float tileBlend,tileSample;varying float updateBlend,updateSample;uniform vec2 atlasSize;uniform float useTiles;
void main(){updateBlend=tileBlend;updateSample=tileSample;vec2 p=position.xy;if(useTiles>.5)p=(tileOrigin+(position.xy*.5+.5)*${HOUSE_TILE}.)/atlasSize*2.-1.;gl_Position=vec4(p,0.,1.);}`
export const houseCaptureVertex = `
attribute vec2 cacheChart;attribute float cacheDepth,vertexLighting;
uniform vec2 atlasSize;uniform mat3 mapMatrix;
uniform sampler2D vertexCharts;uniform int vertexTextureSize;uniform float paddingPass;
flat out int firstVertex;
varying vec3 worldPoint;varying vec3 worldNormal;varying vec2 finishUV;varying float repairReceiver;
vec2 captureChart(int id){return texelFetch(vertexCharts,ivec2(id%vertexTextureSize,id/vertexTextureSize),0).xy;}
void main(){worldPoint=position;worldNormal=normal;finishUV=(mapMatrix*vec3(uv,1.)).xy;repairReceiver=1.-vertexLighting;
firstVertex=gl_VertexID-gl_VertexID%3;vec2 p=cacheChart;
if(paddingPass>.5){
int corner=gl_VertexID%3;vec2 before=captureChart(firstVertex+(corner+2)%3),after=captureChart(firstVertex+(corner+1)%3);
vec2 e0=normalize(p-before),e1=normalize(after-p);float winding=sign(e0.x*e1.y-e0.y*e1.x);
vec2 n0=vec2(e0.y,-e0.x)*winding,n1=vec2(e1.y,-e1.x)*winding,bisector=n0+n1;
p+=bisector*(.8/max(dot(bisector,n0),.00001));
}
gl_Position=vec4(p/atlasSize*2.-1.,cacheDepth*1.8-.9,1.);}`
export const houseCaptureFragment = `
precision highp usampler2D;
${shaderStructs}
${shaderIntersectFunction}
uniform BVH bvh;
uniform sampler2D finishMap;uniform vec3 finishColour,emission;uniform float alphaCut,daylightEmitter;
uniform sampler2D captureData,vertexCharts;uniform int captureDataWidth,vertexTextureSize;uniform float paddingPass;uniform mat3 mapMatrix;
flat in int firstVertex;
varying vec3 worldPoint;varying vec3 worldNormal;varying vec2 finishUV;varying float repairReceiver;
layout(location=0) out vec4 receiver;
layout(location=1) out vec4 direction;
layout(location=2) out vec4 albedo;
vec2 captureChart(int id){return texelFetch(vertexCharts,ivec2(id%vertexTextureSize,id/vertexTextureSize),0).xy;}
vec4 captureValue(int id){return texelFetch(captureData,ivec2(id%captureDataWidth,id/captureDataWidth),0);}
vec3 closestWeights(vec2 p,vec2 a,vec2 b,vec2 c){
vec2 ab=b-a,ac=c-a,ap=p-a;float denominator=ab.x*ac.y-ab.y*ac.x;
vec2 yz=vec2(ap.x*ac.y-ap.y*ac.x,ab.x*ap.y-ab.y*ap.x)/denominator;
vec3 weights=vec3(1.-yz.x-yz.y,yz);if(min(min(weights.x,weights.y),weights.z)>=0.)return weights;
float t=clamp(dot(ap,ab)/max(dot(ab,ab),1e-12),0.,1.);vec3 best=vec3(1.-t,t,0.);float distance=length(p-(a+ab*t));
t=clamp(dot(ap,ac)/max(dot(ac,ac),1e-12),0.,1.);float candidate=length(p-(a+ac*t));if(candidate<distance){distance=candidate;best=vec3(1.-t,0.,t);}
vec2 bc=c-b;t=clamp(dot(p-b,bc)/max(dot(bc,bc),1e-12),0.,1.);if(length(p-(b+bc*t))<distance)best=vec3(0.,1.-t,t);
return best;}
vec3 insetReceiver(vec3 p){
vec3 a=captureValue(firstVertex*2).xyz,b=captureValue((firstVertex+1)*2).xyz,c=captureValue((firstVertex+2)*2).xyz;
vec3 ab=b-a,ac=c-a,ap=p-a;float aa=dot(ab,ab),bb=dot(ac,ac),cc=dot(ab,ac),det=aa*bb-cc*cc;
if(det<=1e-12)return p;
float y=(bb*dot(ap,ab)-cc*dot(ap,ac))/det,z=(aa*dot(ap,ac)-cc*dot(ap,ab))/det;
vec3 weights=vec3(1.-y-z,y,z);
// Exact wall/ceiling corners can round into the adjoining solid wall. The
// normal offset alone cannot fix that. Keep receivers 12 mm inside triangle
// edges (less on tiny triangles), including padded boundary samples.
vec3 margin=min(vec3(.1),.012*vec3(length(b-c),length(c-a),length(a-b))/sqrt(det));
weights=max(weights,margin);weights/=weights.x+weights.y+weights.z;
return a*weights.x+b*weights.y+c*weights.z;}
// Finish planes can overlap the wall footprint. An edge texel inside that
// solid sees back faces forever, which interpolation spreads into the room.
// Move only enclosed receivers to the nearest local exit along their plane.
// The transport geometry is unchanged: walls still block every lighting ray.
vec3 exposedReceiver(vec3 p,vec3 n){
vec3 tangent=normalize(cross(abs(n.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.),n));
vec3 bitangent=cross(n,tangent),origin=p+n*.012,correction=vec3(0.);float nearest=.15;
for(int i=0;i<8;i++){
float angle=float(i)*.78539816339;vec3 d=tangent*cos(angle)+bitangent*sin(angle);
uvec4 indices=uvec4(0u);vec3 faceNormal=vec3(0.),bary=vec3(0.);float side=1.,distance=1e20;
if(bvhIntersectFirstHit(bvh,origin,d,indices,faceNormal,bary,side,distance)&&side<0.&&distance<nearest){
// Stay on the receiver plane. A sloped or perpendicular exit cannot safely
// relocate this sample without changing which surface it represents.
if(abs(dot(faceNormal,n))<.01){nearest=distance;correction=d*(distance+.012)-faceNormal*.012;}
}
}
return p+correction;}
void main(){vec3 p=worldPoint,n=worldNormal;vec2 uv=finishUV;gl_FragDepth=gl_FragCoord.z;
if(paddingPass>.5){
vec2 a=captureChart(firstVertex),b=captureChart(firstVertex+1),c=captureChart(firstVertex+2);
if(any(notEqual(floor(gl_FragCoord.xy/${HOUSE_TILE}.),floor(a/${HOUSE_TILE}.))))discard;
vec3 weights=closestWeights(gl_FragCoord.xy,a,b,c);float distance=length(gl_FragCoord.xy-(a*weights.x+b*weights.y+c*weights.z));
if(distance>.8)discard;
p=vec3(0.);n=vec3(0.);uv=vec2(0.);
for(int i=0;i<3;i++){vec4 v=captureValue((firstVertex+i)*2),normal=captureValue((firstVertex+i)*2+1);p+=v.xyz*weights[i];n+=normal.xyz*weights[i];uv+=vec2(v.w,normal.w)*weights[i];}
uv=(mapMatrix*vec3(uv,1.)).xy;
// Genuine covered texels (depth <= .95) always win. Among padded samples,
// prefer the nearest real triangle, never an extrapolated point inside a wall.
gl_FragDepth=.97+distance*.025;
}
vec4 texel=texture(finishMap,uv);if(texel.a<alphaCut)discard;
p=insetReceiver(p);if(repairReceiver>.5)p=exposedReceiver(p,normalize(n));
receiver=vec4(p,1.);direction=vec4(normalize(n),1.);
// Signed coverage distinguishes a luminous daylight opening from reflectance.
// Empty padding stays zero; interpolation preserves the sign at its borders.
albedo=daylightEmitter>.5?vec4(emission,-1.):vec4(finishColour*texel.rgb,1.);}`

const cache = `
uniform sampler2D receivers,normals,albedos,directCache,historyCache;
uniform vec2 atlasSize;
const float PI=3.14159265359;
vec3 readLight(sampler2D source,vec2 uv){vec4 s=texture(source,uv);return s.rgb/max(s.a,.001);}
vec3 readHistory(vec2 uv){
#ifdef HOUSE_HISTORY_LINEAR
return readLight(historyCache,uv);
#else
vec2 p=uv*atlasSize-.5,f=fract(p);ivec2 b=ivec2(floor(p));
vec4 s=mix(mix(texelFetch(historyCache,b,0),texelFetch(historyCache,b+ivec2(1,0),0),f.x),
mix(texelFetch(historyCache,b+ivec2(0,1),0),texelFetch(historyCache,b+ivec2(1,1),0),f.x),f.y);
return s.rgb/max(s.a,.001);
#endif
}
// Captured albedo has transparent padding around each chart. A nearest sample
// there incorrectly turns a real ray hit black, losing energy on every bounce.
// Reconstruct from covered texels, just as the radiance lookup does. Explicit
// taps also work on GPUs without linear filtering of float32 textures.
vec4 readFinish(vec2 uv){
vec2 p=uv*atlasSize-.5,f=fract(p);ivec2 b=ivec2(floor(p));
vec4 s=mix(mix(texelFetch(albedos,b,0),texelFetch(albedos,b+ivec2(1,0),0),f.x),
mix(texelFetch(albedos,b+ivec2(0,1),0),texelFetch(albedos,b+ivec2(1,1),0),f.x),f.y);
return vec4(s.rgb/max(abs(s.a),.001),s.a);
}
vec2 clampedChart(vec2 pixel,vec2 offset){vec2 tile=floor(pixel/${HOUSE_TILE}.);return (tile*${HOUSE_TILE}.+clamp(mod(pixel,${HOUSE_TILE}.)+offset,vec2(.5),vec2(${HOUSE_TILE}.-.5)))/atlasSize;}
`
const rays = `
precision highp usampler2D;
${shaderStructs}
${shaderIntersectFunction}
uniform BVH bvh;uniform sampler2D vertexCharts;uniform int vertexTextureSize;
vec2 chartAt(uint index){return texelFetch(vertexCharts,ivec2(int(index)%vertexTextureSize,int(index)/vertexTextureSize),0).xy/atlasSize;}
bool castSurfaceRay(vec3 p,vec3 d,out vec2 uv,out float distance,out float facing,out vec3 hitNormal){
 uvec4 indices=uvec4(0u);vec3 faceNormal=vec3(0.),bary=vec3(0.);float side=1.;distance=1e20;
 bool hit=bvhIntersectFirstHit(bvh,p,d,indices,faceNormal,bary,side,distance);
 uv=chartAt(indices.x)*bary.x+chartAt(indices.y)*bary.y+chartAt(indices.z)*bary.z;facing=side;hitNormal=faceNormal;return hit;
}
bool castRay(vec3 p,vec3 d,out vec2 uv,out float distance,out float facing){vec3 hitNormal;return castSurfaceRay(p,d,uv,distance,facing,hitNormal);}
`

// Shadow rays need any blocker before the lamp, not the nearest hit and its
// material coordinates. Reuse the library's packed-BVH bounds/triangle helpers,
// stop at the first blocker, and reject nodes beyond the light's distance.
const shadowRays = `
float visible(vec3 p,vec3 d,float limit){
#ifdef HOUSE_REFERENCE_SHADOWS
vec2 uv;float distance,side;return castRay(p,d,uv,distance,side)&&distance<limit-.015?0.:1.;
#else
limit-=.015;int pointer=0;uint stack[BVH_STACK_DEPTH];stack[0]=0u;
while(pointer>=0&&pointer<BVH_STACK_DEPTH){
uint node=stack[pointer--];float distance;
if(!intersectsBVHNodeBounds(p,d,bvh.bvhBounds,node,distance)||distance>=limit)continue;
uvec2 info=uTexelFetch1D(bvh.bvhContents,node).xy;
if((info.x&0xffff0000u)!=0u){
uint end=info.y+(info.x&0x0000ffffu);
for(uint i=info.y;i<end;i++){
uvec3 indices=uTexelFetch1D(bvh.index,i).xyz;
vec3 a=texelFetch1D(bvh.position,indices.x).xyz,b=texelFetch1D(bvh.position,indices.y).xyz,c=texelFetch1D(bvh.position,indices.z).xyz;
vec3 bary,normal;float side;
if(intersectsTriangle(p,d,a,b,c,bary,normal,distance,side)&&distance<limit)return 0.;
}
}else{
uint left=node+1u,right=node+info.y;bool forward=d[info.x&0x0000ffffu]>=0.;
stack[++pointer]=forward?right:left;stack[++pointer]=forward?left:right;
}
}
return 1.;
#endif
}
`

const houseLights = `
uniform int lightCount;
uniform vec3 lightPositions[32],lightColours[32],lightDirections[32];
uniform vec4 lightParameters[32];
uniform vec3 sunDirection,sunColour;
`
export const houseVisibilityFragment = cache + rays + shadowRays + houseLights + `
out vec4 colour;
void main(){vec2 uv=gl_FragCoord.xy/atlasSize;vec4 receiver=texture(receivers,uv);if(receiver.a<.5){colour=vec4(0.);return;}
vec3 p=receiver.xyz,n=normalize(texture(normals,uv).xyz);uvec2 mask=uvec2(0u);
for(int i=0;i<lightCount;i++){
vec3 delta=lightPositions[i]-p;float dist=length(delta);vec4 settings=lightParameters[i];vec3 d=delta/max(dist,.001);
if((settings.x>0.&&dist>settings.x)||dot(n,d)<=0.)continue;
if(settings.z>=0.&&dot(-d,lightDirections[i])<=settings.z)continue;
if(visible(p+n*.006,d,dist)>.5)mask[i/16]|=1u<<uint(i%16);
}
float sun=dot(n,sunDirection)>0.?visible(p+n*.006,sunDirection,1000.):0.;
colour=vec4(vec2(mask),sun,1.);
}`
const houseDirectLighting = houseLights + `
uniform sampler2D visibilityCache;
uniform int activeLightCount,activeLightIndices[32];
float lightVisible(vec4 visibility,int i){uvec2 mask=uvec2(visibility.xy);return (mask[i/16]&(1u<<uint(i%16)))!=0u?1.:0.;}
vec3 directAt(vec3 p,vec3 n,vec2 shadowUV){vec3 sum=vec3(0.);
#ifdef HOUSE_SMOOTH_SHADOWS
// Packed lamp bits cannot be texture-filtered. Decode each neighbouring mask
// first, then interpolate visibility, keeping every tap inside its chart.
vec2 pixel=shadowUV*atlasSize-.5,base=floor(pixel),f=fract(pixel);
vec2 lo=floor(shadowUV*atlasSize/${HOUSE_TILE}.)*${HOUSE_TILE}.+.5,hi=lo+${HOUSE_TILE - 1}.;
vec4 v0=texture2D(visibilityCache,clamp(base+.5,lo,hi)/atlasSize);
vec4 v1=texture2D(visibilityCache,clamp(base+vec2(1.5,.5),lo,hi)/atlasSize);
vec4 v2=texture2D(visibilityCache,clamp(base+vec2(.5,1.5),lo,hi)/atlasSize);
vec4 v3=texture2D(visibilityCache,clamp(base+1.5,lo,hi)/atlasSize);
vec4 weights=vec4((1.-f.x)*(1.-f.y),f.x*(1.-f.y),(1.-f.x)*f.y,f.x*f.y)*vec4(v0.a,v1.a,v2.a,v3.a);
weights/=max(dot(weights,vec4(1.)),.001);
float sunVisibility=dot(weights,vec4(v0.z,v1.z,v2.z,v3.z));
#else
vec4 visibility=texture(visibilityCache,shadowUV);float sunVisibility=visibility.z;
#endif
for(int slot=0;slot<activeLightCount;slot++){int i=activeLightIndices[slot];vec3 delta=lightPositions[i]-p;float dist=length(delta);vec4 settings=lightParameters[i];
#ifdef HOUSE_SMOOTH_SHADOWS
float visible=dot(weights,vec4(lightVisible(v0,i),lightVisible(v1,i),lightVisible(v2,i),lightVisible(v3,i)));
#else
float visible=lightVisible(visibility,i);
#endif
if(visible<=0.)continue;
if(dist>settings.x&&settings.x>0.)continue;vec3 d=delta/max(dist,.001);float facing=max(dot(n,d),0.);
if(facing<=0.||max(max(lightColours[i].r,lightColours[i].g),lightColours[i].b)<=0.)continue;
float attenuation=1./max(pow(dist,settings.y),.01);if(settings.x>0.)attenuation*=pow(max(0.,1.-pow(dist/settings.x,4.)),2.);
if(settings.z>=0.)attenuation*=smoothstep(settings.z,settings.w,dot(-d,lightDirections[i]));
if(attenuation*facing<.0001)continue;
sum+=lightColours[i]*attenuation*facing*visible/PI;
}
float facing=max(dot(n,sunDirection),0.);
if(facing>0.&&dot(sunColour,sunColour)>.0001)sum+=sunColour*facing*sunVisibility/PI;
return sum;}`
export const houseDirectFragment = cache + houseDirectLighting + `
out vec4 colour;
void main(){vec2 uv=gl_FragCoord.xy/atlasSize;vec4 receiver=texture(receivers,uv);
vec3 p=receiver.xyz,dx=dFdx(p),dy=dFdy(p);
if(receiver.a<.5){colour=vec4(0.);return;}
vec3 n=normalize(texture(normals,uv).xyz);
// Integrate the source over the receiver footprint. A point sample can miss
// the narrow bright patch underneath a lamp, losing energy at every bounce
// when a room-sized chart has only 16 texels. Reuse its cached shadow mask.
// Never extend derivatives across padding or a change in surface orientation.
vec2 ex=vec2(1.,0.)/atlasSize,ey=vec2(0.,1.)/atlasSize;
if(texture(receivers,uv-ex).a<.5||texture(receivers,uv+ex).a<.5||dot(n,texture(normals,uv-ex).xyz)<.99||dot(n,texture(normals,uv+ex).xyz)<.99)dx=vec3(0.);
if(texture(receivers,uv-ey).a<.5||texture(receivers,uv+ey).a<.5||dot(n,texture(normals,uv-ey).xyz)<.99||dot(n,texture(normals,uv+ey).xyz)<.99)dy=vec3(0.);
vec3 sum=directAt(p-dx*.25-dy*.25,n,uv)+directAt(p+dx*.25-dy*.25,n,uv)
  +directAt(p-dx*.25+dy*.25,n,uv)+directAt(p+dx*.25+dy*.25,n,uv);
colour=vec4(sum*.25,1.);
}`

export const houseBounceFragment = cache + rays + `
uniform float daylightEnabled,prototypeDaylight;varying float updateBlend,updateSample;uniform int rayCount;uniform vec3 skyColour;
out vec4 colour;
float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
void main(){vec2 uv=gl_FragCoord.xy/atlasSize;vec4 receiver=texture(receivers,uv);if(receiver.a<.5){colour=vec4(0.);return;}
vec3 n=normalize(texture(normals,uv).xyz),p=receiver.xyz+n*.012;
vec3 tangent=normalize(cross(abs(n.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.),n)),bitangent=cross(n,tangent),sum=vec3(0.);
// Progress through a per-texel R2 sequence on each surface update. A fresh
// random rotation keyed to display time made slow-updating walls flicker.
// Keep sequence arithmetic small enough for float precision, but rotate each
// 256-update block. Repeating the identical short block freezes sampling error
// into the cache, where it can feed back through highly reflective rooms.
float block=floor(updateSample/256.);
vec2 scramble=vec2(hash(vec3(gl_FragCoord.xy,block*17.)),hash(vec3(gl_FragCoord.yx,7.+block*23.)));
for(int i=0;i<rayCount;i++){
float sampleIndex=mod(updateSample,256.)*float(rayCount)+float(i)+.5;
vec3 origin=p,pathNormal=n,pathTangent=tangent,pathBitangent=bitangent,throughput=vec3(1.);
// Trace the next reflection at its real hit point before consulting the cache.
// Projecting immediately onto a room-sized chart loses narrow pools of light
// and repeatedly feeds that missing energy back into dark alcoves.
for(int depth=0;depth<8;depth++){
vec2 sequence=depth==0?vec2(.754877666,.569840296):depth==1?vec2(.414213562,.732050808):depth==2?vec2(.236067978,.645751311):depth==3?vec2(.316624790,.605551275):depth==4?vec2(.123105626,.358898944):depth==5?vec2(.795831523,.385164807):depth==6?vec2(.567764363,.082762530):vec2(.403124237,.557438524);
vec2 sampleUV=fract(scramble+sampleIndex*sequence);float a=sampleUV.x,b=sampleUV.y;
vec3 d=pathTangent*sqrt(a)*cos(2.*PI*b)+pathBitangent*sqrt(a)*sin(2.*PI*b)+pathNormal*sqrt(1.-a);
vec2 hitUV;float dist,side;vec3 hitNormal;
// Clear openings have no glass triangle to hit. Escaped rays still see the
// same sky in window mode, including through open exterior doors.
if(!castSurfaceRay(origin,d,hitUV,dist,side,hitNormal)){sum+=throughput*skyColour;break;}
vec4 finish=readFinish(hitUV);
// The comparison uses the original prototype's two-sided window radiance,
// available immediately from capture, without waiting for outside surfaces.
if(finish.a<0.){sum+=throughput*finish.rgb*daylightEnabled;break;}
// Back faces block rays, but never emit the opposite side's stored lighting.
if(side<0.)break;
// Preserve the authored diffuse reflectance. A blanket .88 ceiling silently
// darkened white ceilings, doors and trim on every inter-room reflection.
throughput*=clamp(finish.rgb,vec3(0.),vec3(1.));
sum+=throughput*readLight(directCache,hitUV);
if(depth==7){sum+=throughput*readHistory(hitUV);break;}
origin+=d*dist+hitNormal*.012;pathNormal=hitNormal;
pathTangent=normalize(cross(abs(hitNormal.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.),hitNormal));pathBitangent=cross(hitNormal,pathTangent);
}
}
vec4 previous=texture(historyCache,uv);
colour=vec4(mix(previous.rgb/max(previous.a,.001),sum/float(rayCount),previous.a<.5?1.:updateBlend),1.);
}`

export const houseFilterFragment = cache + `
uniform sampler2D filterSource;uniform vec2 filterDirection;uniform float filterFootprint;
out vec4 colour;
void main(){vec3 sum=vec3(0.);float total=0.;vec2 centreUV=gl_FragCoord.xy/atlasSize;vec4 centre=texture(receivers,centreUV);
vec3 centreN=texture(normals,centreUV).xyz;
// A large ceiling's grid cells can be almost a metre apart. A fixed 35 cm
// kernel barely joins them, leaving independent noisy bands on screen.
// Reconstruct indirect wall/ceiling light over one local cell footprint.
// Keep floor/countertop and direct-shadow reconstruction unchanged.
float worldSigma=.35;
if(filterFootprint>.5&&centre.a>.5&&centreN.y<.5){
for(int sign=-1;sign<=1;sign+=2){vec2 neighbourUV=clampedChart(gl_FragCoord.xy,filterDirection*float(sign));vec4 neighbour=texture(receivers,neighbourUV);
if(neighbour.a>.5&&dot(centreN,texture(normals,neighbourUV).xyz)>.99)
worldSigma=max(worldSigma,min(1.,length(neighbour.xyz-centre.xyz))*${LAB_FILTER_SIGMA});
}
}
for(int i=-${LAB_FILTER_RADIUS};i<=${LAB_FILTER_RADIUS};i++){vec2 uv=clampedChart(gl_FragCoord.xy,filterDirection*float(i));vec4 s=texture(filterSource,uv);
if(s.a<.01)continue;float weight=exp(-float(i*i)/(2.*${LAB_FILTER_SIGMA}*${LAB_FILTER_SIGMA}));
// Preserve edges between differently oriented surfaces in a capture chart.
if(centre.a>.5){
weight*=pow(max(0.,dot(centreN,texture(normals,uv).xyz)),8.);
// Remain local to this chart and limit blending by world-space distance and
// surface orientation, rather than atlas distance alone.
vec3 separation=texture(receivers,uv).xyz-centre.xyz;
weight*=exp(-dot(separation,separation)/(2.*worldSigma*worldSigma));
}
sum+=s.rgb*weight;total+=s.a*weight;}
colour=total>.001?vec4(sum/total,1.):vec4(0.);}`

const houseCardIdGLSL = `int surfaceCardId(vec2 chart) {
  ivec2 tile = ivec2(floor(chart / ${HOUSE_TILE}.));
  return tile.x + ${HOUSE_COLUMNS} * tile.y;
}`

export const houseSurfaceVertex = `attribute vec2 cacheChart;uniform vec2 atlasSize;uniform mat3 mapMatrix;
attribute vec2 vertexLightChart;attribute float vertexLighting;
uniform sampler2D displayDirectCache,filteredCache;
varying vec3 vertexDirect,vertexBounce;varying float useVertexLight;
varying vec2 lightUV;varying vec2 finishUV;
varying vec3 surfacePoint,surfaceNormal;
flat out int cardId;
${houseCardIdGLSL}
void main(){lightUV=cacheChart/atlasSize;finishUV=(mapMatrix*vec3(uv,1.)).xy;surfacePoint=position;surfaceNormal=normal;
cardId=surfaceCardId(cacheChart);
useVertexLight=vertexLighting;vertexDirect=vec3(0.);vertexBounce=vec3(0.);
if(vertexLighting>.5){vec2 lookup=vertexLightChart/atlasSize;vec4 direct=texture2D(displayDirectCache,lookup),bounce=texture2D(filteredCache,lookup);vertexDirect=direct.rgb/max(direct.a,.001);vertexBounce=bounce.rgb/max(bounce.a,.001);}
gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`
export const houseSurfaceFragment = `const float PI=3.14159265359;
#define HOUSE_SMOOTH_SHADOWS
uniform vec2 atlasSize;
` + houseDirectLighting + `
uniform sampler2D finishMap,displayDirectCache,filteredCache;uniform vec3 finishColour,emission;uniform float alphaCut,indirectEnabled,daylightEmitter,daylightEnabled;
varying vec2 lightUV;varying vec2 finishUV;
varying vec3 vertexDirect,vertexBounce;varying float useVertexLight;
varying vec3 surfacePoint,surfaceNormal;
flat in int cardId;
uniform float showSurfaceCacheCards;
void main(){vec4 texel=texture2D(finishMap,finishUV);if(texel.a<alphaCut)discard;
vec4 bounce=texture2D(filteredCache,lightUV);
// Direct light uses the visible geometry's position and shading normal. Only
// occlusion comes from the coarse scene; decorative normals no longer inherit
// a flat proxy's cosine term. Fixed light slots avoid navigation-time variants.
vec3 direct=vec3(0.);
if(activeLightCount>0||dot(sunColour,sunColour)>.0001)direct=directAt(surfacePoint,normalize(surfaceNormal),lightUV);
vec3 incoming=direct+indirectEnabled*(useVertexLight>.5?vertexBounce:bounce.rgb/max(bounce.a,.001));
gl_FragColor=vec4(finishColour*texel.rgb*incoming+emission*(daylightEmitter>.5?daylightEnabled:1.),1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
if (showSurfaceCacheCards > .5) {
  vec3 tint = .25 + .7 * fract(float(cardId + 1) * vec3(.618034, .414214, .732051));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, tint, .6);
}
}`
export const houseCopyFragment = `uniform sampler2D historyCache;uniform vec2 atlasSize;out vec4 colour;void main(){colour=texture(historyCache,gl_FragCoord.xy/atlasSize);}`
export const houseFeedbackVertex = `attribute vec2 cacheChart;uniform mat3 mapMatrix;varying vec2 finishUV;flat out int cardId;
${houseCardIdGLSL}
void main(){cardId=surfaceCardId(cacheChart)+1;
finishUV=(mapMatrix*vec3(uv,1.)).xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`
export const houseFeedbackFragment = `uniform sampler2D finishMap;uniform float alphaCut;varying vec2 finishUV;flat in int cardId;out vec4 colour;
void main(){if(texture(finishMap,finishUV).a<alphaCut)discard;colour=vec4(float(cardId%256)/255.,float(cardId/256)/255.,0.,1.);}`
export const houseTileOrigin = (id: number) => [id % HOUSE_COLUMNS * HOUSE_TILE, Math.floor(id / HOUSE_COLUMNS) * HOUSE_TILE] as const
