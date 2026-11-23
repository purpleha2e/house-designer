import { COLUMNS, MAX_CARDS, TILE } from './scene'
import { LAB_SKY_RADIANCE, LAB_BOUNCE_RAYS, LAB_FILTER_RADIUS, LAB_FILTER_SIGMA } from './calibration'

export const fullscreenVertex = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`

// Card geometry and material properties remain on the GPU. Rays intersect the
// actual rectangles used by the visible scene; a back face blocks transport.
export const common = /* glsl */ `
uniform sampler2D cardData;
uniform sampler2D directCache;
uniform sampler2D historyCache;
uniform vec2 atlasSize;
uniform int cardCount;
uniform vec3 rugColour;
uniform vec3 cabinet;
uniform vec2 lamps;
uniform float sky;
const float PI=3.14159265359;
const float TILE=${TILE}.0;
const float COLS=${COLUMNS}.0;
struct Card {vec3 p;vec3 u;vec3 v;vec3 n;vec3 colour;float kind;};
Card cardAt(int id){
  vec4 a=texelFetch(cardData,ivec2(0,id),0),b=texelFetch(cardData,ivec2(1,id),0);
  vec4 c=texelFetch(cardData,ivec2(2,id),0),d=texelFetch(cardData,ivec2(3,id),0);
  return Card(a.xyz,b.xyz,c.xyz,normalize(cross(b.xyz,c.xyz)),d.xyz,d.w);
}
vec2 atlasUV(int id,vec2 uv){
  vec2 tile=vec2(mod(float(id),COLS),floor(float(id)/COLS))*TILE;
  return (tile+clamp(uv*TILE,vec2(.5),vec2(TILE-.5)))/atlasSize;
}
vec3 albedo(Card c,vec3 p){
  if(c.kind==1.0){
    if(p.x> -3.5&&p.x< -.5&&p.z> -1.5&&p.z<1.3)return rugColour;
    float board=step(.025,fract(p.x*3.0));
    return c.colour*mix(.65,1.0,board);
  }
  return c.colour;
}
bool boxHit(vec3 p,vec3 d,float limit,vec3 lo,vec3 hi){
  vec3 inv=sign(d+vec3(1e-8))/max(abs(d),vec3(1e-8));
  vec3 a=(lo-p)*inv,b=(hi-p)*inv;
  float near=max(max(min(a.x,b.x),min(a.y,b.y)),min(a.z,b.z));
  float far=min(min(max(a.x,b.x),max(a.y,b.y)),max(a.z,b.z));
  return far>max(near,.002)&&near<limit-.004;
}
float visibility(vec3 p,vec3 d,float distance){
  if(boxHit(p,d,distance,vec3(-.06,0.,-3.),vec3(.06,3.,-.8)))return 0.;
  if(boxHit(p,d,distance,vec3(-.06,0.,.8),vec3(.06,3.,3.)))return 0.;
  if(boxHit(p,d,distance,vec3(-.06,2.2,-.8),vec3(.06,3.,.8)))return 0.;
  if(boxHit(p,d,distance,cabinet-vec3(.425,.675,.425),cabinet+vec3(.425,.675,.425)))return 0.;
  return 1.;
}
vec3 directLight(Card c,vec3 p){
  if(c.kind==3.0)return c.colour*sky*${LAB_SKY_RADIANCE.toFixed(1)};
  vec3 irradiance=vec3(0.);
  for(int i=0;i<2;i++){
    vec3 delta=vec3(i==0?-2.:2.,2.65,0.)-p;
    float r2=max(dot(delta,delta),.04),dist=sqrt(r2);
    vec3 d=delta/dist;
    float power=i==0?lamps.x:lamps.y;
    irradiance+=vec3(1.,.91,.77)*power/(4.*PI*r2)*max(dot(c.n,d),0.)*visibility(p+c.n*.004,d,dist);
  }
  return albedo(c,p)*irradiance/PI;
}
int trace(vec3 p,vec3 d,out vec2 uv){
  float nearest=100.;int hit=-1;
  for(int i=0;i<${MAX_CARDS};i++){
    if(i>=cardCount)break;
    Card c=cardAt(i);
    float denominator=dot(c.n,d);
    if(abs(denominator)<.00001)continue;
    float t=dot(c.n,c.p-p)/denominator;
    if(t<.003||t>=nearest)continue;
    vec3 q=p+d*t-c.p;
    vec2 xy=vec2(dot(q,c.u)/dot(c.u,c.u),dot(q,c.v)/dot(c.v,c.v));
    if(any(greaterThan(abs(xy),vec2(1.00001))))continue;
    nearest=t;hit=i;uv=xy*.5+.5;
  }
  return hit;
}
`

export const directFragment = common + /* glsl */ `
void main(){
  ivec2 tile=ivec2(gl_FragCoord.xy/TILE);
  int id=tile.y*${COLUMNS}+tile.x;
  if(id>=cardCount){gl_FragColor=vec4(0.);return;}
  vec2 uv=mod(gl_FragCoord.xy,TILE)/TILE;
  Card c=cardAt(id);
  vec3 p=c.p+c.u*(uv.x*2.-1.)+c.v*(uv.y*2.-1.);
  gl_FragColor=vec4(directLight(c,p),1.);
}`

export const bounceFragment = common + /* glsl */ `
uniform float frame;
uniform float blend;
float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
void main(){
  ivec2 tile=ivec2(gl_FragCoord.xy/TILE);int id=tile.y*${COLUMNS}+tile.x;
  if(id>=cardCount){gl_FragColor=vec4(0.);return;}
  Card c=cardAt(id);
  if(c.kind==3.0){gl_FragColor=vec4(0.);return;}
  vec2 uv=mod(gl_FragCoord.xy,TILE)/TILE;
  vec3 p=c.p+c.u*(uv.x*2.-1.)+c.v*(uv.y*2.-1.)+c.n*.006;
  vec3 sum=vec3(0.);
  // Cosine-weighted hemisphere sampling integrates E / pi. The reflected
  // radiance at a hit is direct + albedo * previous incoming light.
  float rotation=hash(vec3(gl_FragCoord.xy,frame));
  for(int sampleIndex=0;sampleIndex<${LAB_BOUNCE_RAYS};sampleIndex++){
    float a=(float(sampleIndex)+hash(vec3(gl_FragCoord.yx,frame+7.)))/${LAB_BOUNCE_RAYS}.;
    float b=fract(float(sampleIndex)*.61803398875+rotation);
    vec3 d=normalize(c.u)*sqrt(a)*cos(2.*PI*b)+normalize(c.v)*sqrt(a)*sin(2.*PI*b)+c.n*sqrt(1.-a);
    vec2 hitUV;int hit=trace(p,d,hitUV);
    if(hit<0)continue;
    Card h=cardAt(hit);
    if(dot(h.n,-d)<=0.)continue;
    vec2 lookup=atlasUV(hit,hitUV);
    vec3 hp=h.p+h.u*(hitUV.x*2.-1.)+h.v*(hitUV.y*2.-1.);
    sum+=texture2D(directCache,lookup).rgb+albedo(h,hp)*texture2D(historyCache,lookup).rgb;
  }
  vec3 old=texture2D(historyCache,atlasUV(id,uv)).rgb;
  gl_FragColor=vec4(mix(old,sum/${LAB_BOUNCE_RAYS}.,blend),1.);
}`

export const surfaceVertex = `varying vec3 worldPosition;varying vec2 surfaceUV;
void main(){surfaceUV=uv;vec4 world=modelMatrix*vec4(position,1.);worldPosition=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`

// Separable Gaussian reconstruction of incoming light, once per atlas rather
// than per screen pixel. Keep it out of transport history: repeated feedback
// filtering would spread energy and erase indirect contact shadows over time.
export const filterFragment = common + /* glsl */ `
uniform sampler2D filterSource;
uniform vec2 filterDirection;
void main(){
  ivec2 tile=ivec2(gl_FragCoord.xy/TILE);int id=tile.y*${COLUMNS}+tile.x;
  if(id>=cardCount){gl_FragColor=vec4(0.);return;}
  vec2 uv=mod(gl_FragCoord.xy,TILE)/TILE;
  vec3 sum=vec3(0.);
  float total=0.;
  for(int offset=-${LAB_FILTER_RADIUS};offset<=${LAB_FILTER_RADIUS};offset++){
    float weight=exp(-float(offset*offset)/(2.*${LAB_FILTER_SIGMA}*${LAB_FILTER_SIGMA}));
    // atlasUV clamps to texel centres in this card, including the tile border.
    // Filtering must never borrow light from the neighbouring surface tile.
    sum+=texture2D(filterSource,atlasUV(id,uv+filterDirection*float(offset)/TILE)).rgb*weight;
    total+=weight;
  }
  gl_FragColor=vec4(sum/total,1.);
}`

export const surfaceFragment = common + /* glsl */ `
uniform int surfaceId;
uniform float indirectEnabled;
uniform sampler2D filteredCache;
varying vec3 worldPosition;varying vec2 surfaceUV;
void main(){
  Card c=cardAt(surfaceId);
  vec3 radiance=directLight(c,worldPosition);
  if(c.kind!=3.){
    // Only incoming bounce is smoothed; albedo and direct shadows stay sharp.
    vec3 incoming=texture2D(filteredCache,atlasUV(surfaceId,surfaceUV)).rgb;
    radiance+=indirectEnabled*albedo(c,worldPosition)*incoming;
  }
  gl_FragColor=vec4(radiance,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`
