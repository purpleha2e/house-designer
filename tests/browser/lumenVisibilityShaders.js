import {shaderIntersectFunction,shaderStructs} from 'three-mesh-bvh'
import {lumenLookup} from '../../src/lumenViewportPass.ts'
import {lumenSceneHit} from '../../src/lumenFirstBounce.ts'
import {lumenPatchInterpolation} from '../../src/lumenPatchInterpolation.ts'

const state=`
bool auditUseExactPoint=false;
vec3 auditExactPoint;
int auditTriangle=-1;
float auditDistance=-1.;
int auditUnmapped=0;
uniform bool auditMeasureRoutes;
`

const exact=`
#define TRI_INTERSECT_EPSILON 1e-7
${shaderStructs}
${shaderIntersectFunction}
uniform BVH auditBVH;
int exactPatch(vec3 point,vec3 normal,vec2 identity){
  ivec3 c=ivec3(floor((point-gridOrigin)/spacing));
  const ivec3 shifts[7]=ivec3[7](ivec3(0),ivec3(1,0,0),ivec3(-1,0,0),ivec3(0,1,0),ivec3(0,-1,0),ivec3(0,0,1),ivec3(0,0,-1));
  int best=-1;float bestScore=1e10;
  for(int k=0;k<7;k++){
    int i=cellAt(c+shifts[k]);
    for(int layer=0;layer<patchLimit && i>=0;layer++){
      ivec2 at=address(i);vec4 p=texelFetch(surfacePoint,at,0);
      vec3 n=texelFetch(surfaceNormal,at,0).xyz,delta=point-p.xyz;
      float source=round(texelFetch(supportLo,at,0).a*255.)+256.*round(texelFetch(supportHi,at,0).a*255.);
      float plane=abs(dot(delta,n)),alignment=abs(dot(normal,n));
      if(source==identity.x && p.w==identity.y && alignment>=.95 && plane<=.016 && containsPoint(at,delta,.008)){
        if(k==0 && plane<.0015 && alignment>.995)return i;
        float score=dot(delta,delta)*.1/(spacing*spacing)+9.*plane/spacing+3.*(1.-alignment);
        if(score<bestScore){best=i;bestScore=score;}
      }
      i=nextPatch(at);
    }
  }
  return best;
}
int exactSceneHit(vec3 start,vec3 ray,float limit){
  auditUseExactPoint=false;auditTriangle=-1;auditDistance=-1.;
  uvec4 face;vec3 n,bary;float side,t;
  // The original DDA rejects t<=.002 relative to this same offset origin.
  const float minT=.0020001;
  if(!bvhIntersectFirstHit(auditBVH,start+minT*ray,ray,face,n,bary,side,t) || t<0. || t+minT>limit)return -1;
  auditTriangle=int(face.x)/3;
  auditDistance=t+minT;
  auditExactPoint=start+auditDistance*ray;
  vec2 identity=vec2(texelFetch1D(auditBVH.position,face.x).w,texelFetch1D(auditBVH.position,face.y).w);
  int i=exactPatch(auditExactPoint,n,identity);
  auditUseExactPoint=i>=0;
  if(i<0)auditUnmapped++;
  return i<0?-2:i;
}
`

export function exactVisibilityFragment(fragment,view){
  const interpolation='if(t>0.)patchStencil(a,start+ray*t,normal,false,cells,w);'
  if(!fragment.includes(lumenLookup)||!fragment.includes(lumenSceneHit)||!fragment.includes(interpolation))
    throw Error('The audit splice no longer matches the active renderer')
  const common=fragment.replace(lumenLookup,lumenLookup+state)
    .replace(lumenSceneHit,lumenSceneHit+exact)
    .replace(interpolation,'if(auditUseExactPoint)patchStencil(a,auditExactPoint,normal,false,cells,w); else '+interpolation)
  if(!view)return common.replace('int hit=sceneHit(start,ray,7.);','int hit=exactSceneHit(start,ray,7.);')
  return common.replace('int hit=screenHit(start,ray);','auditUseExactPoint=false;int hit=screenHit(start,ray);')
    .replace('hit=sceneHit(start,ray,7.);','hit=exactSceneHit(start,ray,7.);')
    .replace('if(diagnostic==6)result.rgb=',`if(auditMeasureRoutes){result.rgb=vec3(screen,fallback,float(auditUnmapped));return;}
  if(diagnostic==6)result.rgb=`)
}

function viewHelpers(viewFragment,attachments){
  const outputs='layout(location=0) out vec4 result;layout(location=1) out vec4 geometry;'
  if(!viewFragment.includes(outputs))throw Error('Missing original trace outputs')
  const base=viewFragment.replace(outputs,attachments)
  return base.substring(0,base.lastIndexOf('void main(){'))
    .replace(lumenLookup,lumenLookup+state)
    .replace(lumenPatchInterpolation,lumenPatchInterpolation.replace(
      'if(t>0.)patchStencil(a,start+ray*t,normal,false,cells,w);',
      'if(auditUseExactPoint)patchStencil(a,auditExactPoint,normal,false,cells,w); else if(t>0.)patchStencil(a,start+ray*t,normal,false,cells,w);'))
}

export function pairedVisibilityFragment(viewFragment){
  const outputs='layout(location=0) out vec4 pairA;layout(location=1) out vec4 pairB;'
  const head=viewHelpers(viewFragment,outputs)
    .replace(lumenSceneHit,lumenSceneHit+exact+lumenSceneHit.replace('int sceneHit','int longSceneHit').replace('k<traceLimit','k<traceLimit*3'))
  return head+`
uniform sampler2D auditRaysOrigin,auditRaysDirection;
void main(){
  ivec2 at=ivec2(gl_FragCoord.xy);
  vec4 o=texelFetch(auditRaysOrigin,at,0);
  vec3 start=o.xyz,ray=texelFetch(auditRaysDirection,at,0).xyz;float limit=o.w;
  int patchIndex=sceneHit(start,ray,limit);
  float distance=-1.;
  if(patchIndex>=0){
    ivec2 a=address(patchIndex);vec3 n=texelFetch(surfaceNormal,a,0).xyz;
    distance=dot(texelFetch(surfacePoint,a,0).xyz-start,n)/dot(ray,n);
  }
  int mapped=exactSceneHit(start,ray,limit);
  float route=0.;
  if(patchIndex<0){
    if(auditTriangle>=0)route=longSceneHit(start,ray,limit)>=0?3.:0.;
    else if(crossesOpening(start,ray,start+ray*limit))route=1.;
    else if(ray.y>0.)route=2.;
  }
  pairA=vec4(distance,float(patchIndex),0.,route);
  pairB=vec4(auditDistance,float(auditTriangle),0.,float(mapped));
}
`
}

export function pairedRadianceFragment(viewFragment){
  const head=viewHelpers(viewFragment,`
layout(location=0) out vec4 initialA;
layout(location=1) out vec4 initialB;
layout(location=2) out vec4 firstA;
layout(location=3) out vec4 firstB;
layout(location=4) out vec4 laterA;
layout(location=5) out vec4 laterB;
`)
  return head+`
uniform sampler2D auditRaysOrigin,auditRaysDirection,auditHits,auditFirstFront,auditFirstBack;
vec3 terms(int i,vec3 start,vec3 ray,bool viewport,out vec3 daylight,out vec3 first,out vec3 later){
  daylight=vec3(0.);first=vec3(0.);later=vec3(0.);
  if(i<0)return vec3(0.);
  ivec2 a=address(i);
  vec4 surface=texelFetch(surfaceNormal,a,0),sun=texelFetch(reflectedSun,a,0);
  bool front=dot(surface.xyz,-ray)>=0.;
  vec3 solar=dot(surface.xyz,-ray)*sun.a>0.?sun.rgb*sunGain:vec3(0.);
  if(surface.w==3. && (!viewport || crossesOpening(start,ray,texelFetch(surfacePoint,a,0).xyz)))return solar;
  vec3 rho=texelFetch(surfaceAlbedo,a,0).rgb;
  ivec4 ids;vec4 weights;hitStencil(a,surface.xyz,start,ray,ids,weights);
  daylight=daylightFromStencil(ids,weights,front);
  first=feedbackFromStencil(auditFirstFront,auditFirstBack,ids,weights,front);
  later=feedbackFromStencil(surfaceBounceFront,surfaceBounceBack,ids,weights,front)-first;
  return solar+rho*(skyBase*(daylight.x+groundDiffuse*daylight.z)+groundRadiance*daylight.y);
}
void main(){
  ivec2 at=ivec2(gl_FragCoord.xy);
  vec4 o=texelFetch(auditRaysOrigin,at,0),d=texelFetch(auditRaysDirection,at,0);
  vec3 start=o.xyz,ray=d.xyz;
  vec3 hits=texelFetch(auditHits,at,0).xyz;
  vec3 factor,first,later;
  vec3 source=terms(int(hits.x),start,ray,d.w>0.,factor,first,later);
  initialA=vec4(source,factor.x);
  firstA=vec4(first,factor.y);
  laterA=vec4(later,factor.z);
  auditUseExactPoint=hits.y>=0.;
  auditExactPoint=start+ray*hits.z;
  source=terms(int(hits.y),start,ray,d.w>0.,factor,first,later);
  initialB=vec4(source,factor.x);
  firstB=vec4(first,factor.y);
  laterB=vec4(later,factor.z);
}
`
}
