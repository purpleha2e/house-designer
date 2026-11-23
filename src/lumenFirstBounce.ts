import { lumenPatchInterpolation } from './lumenPatchInterpolation'

export const lumenSceneHit = `int sceneHit(vec3 start, vec3 ray, float limit) {
  vec3 g=(start-gridOrigin)/spacing;
  float entry=0.;
  vec3 dim=vec3(textureSize(cells,0));
  if(any(lessThan(g,vec3(0.))) || any(greaterThanEqual(g,dim))){
    vec3 inv=1./mix(vec3(.000001),ray,greaterThan(abs(ray),vec3(.000001)));
    vec3 a=-g*spacing*inv,b=(dim-g)*spacing*inv,lo=min(a,b),hi=max(a,b);
    entry=max(0.,max(lo.x,max(lo.y,lo.z)))+.0001;
    if(entry>=min(limit,min(hi.x,min(hi.y,hi.z))))return -1;
    g=(start+entry*ray-gridOrigin)/spacing;
  }
  ivec3 cell=ivec3(floor(g)), stepDir=ivec3(sign(ray));
  vec3 increment=spacing/max(abs(ray),vec3(.00001));
  vec3 boundary=mix(vec3(1e20),vec3(entry)+(vec3(cell)+step(vec3(0.),ray)-g)*increment*sign(ray),greaterThan(abs(ray),vec3(.00001)));
  for(int k=0;k<traceLimit;k++){
    if(any(lessThan(cell,ivec3(0)))||any(greaterThanEqual(cell,textureSize(cells,0))))break;
    int i=cellAt(cell); float exitT=min(boundary.x,min(boundary.y,boundary.z));
    if(useDistanceField && i<0){
      // A cell-centred sample can overestimate distance at the ray by half a
      // diagonal. A bounded patch stays within a full diagonal of its triangles.
      float advance=abs(texelFetch(distanceField,cell,0).r)-spacing*2.598077-.006;
      if(advance>max(spacing*1.5,exitT-entry+.0001)){
        entry+=advance;
        if(entry>=limit)break;
        g=(start+entry*ray-gridOrigin)/spacing;
        cell=ivec3(floor(g));
        boundary=mix(vec3(1e20),vec3(entry)+(vec3(cell)+step(vec3(0.),ray)-g)*increment*sign(ray),greaterThan(abs(ray),vec3(.00001)));
        continue;
      }
    }
    int closest=-1;float nearest=min(limit,exitT+(layered==1?.002:.02));
    for(int layer=0;layer<patchLimit && i>=0;layer++){
      ivec2 a=address(i);vec3 n=texelFetch(surfaceNormal,a,0).xyz;
      float denom=dot(ray,n);
      if(abs(denom)>.001){
        vec3 point=texelFetch(surfacePoint,a,0).xyz;
        float t=dot(point-start,n)/denom;
        if(t>max(.002,entry-.002) && t<=nearest && (layered==0 || containsPoint(a,start+ray*t-point,.002))){
          nearest=t;closest=i;
        }
      }
      i=nextPatch(a);
    }
    if(closest>=0)return closest;
    if(exitT>limit)break;
    if(boundary.x<=boundary.y && boundary.x<=boundary.z){cell.x+=stepDir.x;boundary.x+=increment.x;}
    else if(boundary.y<=boundary.z){cell.y+=stepDir.y;boundary.y+=increment.y;}
    else {cell.z+=stepDir.z;boundary.z+=increment.z;}
    entry=exitT;
  }
  return -1;
}
`

/** Return diffuse outgoing radiance in scene-linear units. Screen hits and
 * scene hits sample the same reflected sunlight, so an accepted ray only
 * contributes once. A ray that escapes contributes zero indirect sunlight. */
export const firstBounceFragment = (lookup:string) => `in vec2 screenUV;layout(location=0) out vec4 result;layout(location=1) out vec4 geometry;
${lookup}
uniform mat4 viewProjection, worldToView;
uniform int diagnostic,inspectField,sequence,auditTraceStage,screenSteps,bounceRays,samplePattern;
const float pi=3.14159265;
uniform sampler2D skyVisibility,groundVisibility,surfaceBounceFront,surfaceBounceBack;
uniform int surfaceBounceReady;
uniform int openingCount;uniform vec4 openingCenter[16],openingAxis[16];
uniform vec3 skyBase, groundRadiance, sunGain;
uniform float overcast;
${lumenPatchInterpolation}
vec3 receiverWeights(ivec2 a,vec3 p,vec3 normal,float side){
  ivec4 cells;vec4 w;patchStencil(a,p,normal,true,cells,w);
  return daylightFromStencil(cells,w,side>=0.);
}
bool crossesOpening(vec3 start,vec3 ray,vec3 point){
  for(int j=0;j<openingCount;j++){
    vec3 delta=openingCenter[j].xyz-start,axis=openingAxis[j].xyz,normal=cross(axis,vec3(0,1,0));
    if(dot(delta,delta)>64.)continue;
    float den=dot(ray,normal);if(abs(den)<.001)continue;
    float t=dot(delta,normal)/den;
    vec3 q=ray*t-delta;
    if(t>0. && t<distance(start,point)+spacing && abs(dot(q,axis))<=openingAxis[j].w*.5 && abs(q.y)<=openingCenter[j].w*.5)return true;
  }
  return false;
}
vec3 outgoing(int i,vec3 ray,vec3 start,out vec3 laterBounce) {
  laterBounce=vec3(0.);
  if(i<0) return vec3(0.);
  ivec2 a=address(i); vec4 sun=texelFetch(reflectedSun,a,0);
  vec4 surface=texelFetch(surfaceNormal,a,0);
  float side=dot(surface.xyz,-ray);
  vec3 solar=side*sun.a>0. ? sun.rgb*sunGain : vec3(0.);
  if(diagnostic==8 || (surface.w==3. && crossesOpening(start,ray,texelFetch(surfacePoint,a,0).xyz)))return solar;
  vec3 albedo=texelFetch(surfaceAlbedo,a,0).rgb;
  // A hit can scatter daylight it received from exterior ground, regardless
  // of whether that hit is visible to the camera. Use the same cached energy
  // as direct receiver evaluation, with the hit's own orientation and albedo.
  ivec4 cells;vec4 w;hitStencil(a,surface.xyz,start,ray,cells,w);
  vec3 daylight=daylightFromStencil(cells,w,side>=0.);
  laterBounce=albedo*skyBase*groundDiffuse*daylight.z;
  if(surfaceBounceReady>0)laterBounce+=feedbackFromStencil(surfaceBounceFront,surfaceBounceBack,cells,w,side>=0.);
  return solar+albedo*(skyBase*daylight.x+groundRadiance*daylight.y);
}
int screenHit(vec3 start,vec3 ray) {
  float previous=-1.;
  for(int k=1;k<=screenSteps;k++){
    float t=.09*float(k)+.025*float(k*k);
    vec3 probe=start+ray*t;
    vec4 clip=viewProjection*vec4(probe,1.);
    if(clip.w<=0.) break;
    vec2 uv=clip.xy/clip.w*.5+.5;
    if(any(lessThanEqual(uv,vec2(0.)))||any(greaterThanEqual(uv,vec2(1.)))) break;
    float d=texture(sceneDepth,uv).r;
    if(d>=1.) {previous=-1.;continue;}
    vec3 surface=worldAt(uv,d);
    float gap=(worldToView*vec4(surface-probe,0.)).z;
    if(previous<=0. && gap>=0. && gap<.16 && distance(start,surface)>.12){
      int i=cellAt(ivec3(floor((surface-gridOrigin)/spacing)));
      for(int layer=0;layer<patchLimit && i>=0;layer++){
        ivec2 a=address(i);vec3 n=texelFetch(surfaceNormal,a,0).xyz,point=texelFetch(surfacePoint,a,0).xyz;
        float denom=dot(ray,n);
        if(abs(denom)>.08){
          if(layered==0)return i;
          float t=dot(point-start,n)/denom;
          if(t>.02 && abs(dot(n,surface-point))<.008 && distance(start+t*ray,surface)<.16 &&
              containsPoint(a,start+t*ray-point,.003))return i;
        }
        i=nextPatch(a);
      }
    }
    if(gap>.16) break;
    previous=gap;
  }
  return -1;
}
${lumenSceneHit}
void main(){
  float d=texture(sceneDepth,screenUV).r;
  vec3 p=worldAt(screenUV,d),dpdx=dFdx(p),dpdy=dFdy(p),n=normalize(cross(dpdx,dpdy));
  float depth=-(worldToView*vec4(p,1.)).z;
  result=vec4(0.,0.,0.,depth);
  geometry=vec4(0.,0.,0.,-1.);
  int receiver=d>=1.?-1:receiverAt(p,n);
  if(d<1. && receiver<0){n=boundaryNormal(screenUV,p);receiver=receiverAt(p,n);}
  if(receiver<0){
    vec3 grid=(p-gridOrigin)/spacing;
    bool beyond=any(lessThan(grid,vec3(0.))) || any(greaterThanEqual(grid,vec3(textureSize(cells,0))));
    if(d<1. && beyond && abs(p.y-groundY)<.005 && abs(n.y)>.99 && onGround(p) &&
      (diagnostic==0 || diagnostic==7 || diagnostic==9 || diagnostic==21 || diagnostic==22))
      result.rgb=groundDiffuse*skyBase*mix(17./15.,7./6.,overcast);
    if(inspectField>0)result=vec4(0.,0.,0.,-1.);return;
  }
  ivec2 a=address(receiver);n=texelFetch(surfaceNormal,a,0).xyz;
  float side=dot(n,cameraWorld[3].xyz-p);
  if(side<0.)n=-n;
  geometry=vec4(n,receiverIdentity(a));
  vec3 daylight=receiverWeights(a,p,texelFetch(surfaceNormal,a,0).xyz,side);
  vec3 directSky=texelFetch(surfaceAlbedo,a,0).rgb*(skyBase*daylight.x+groundRadiance*daylight.y);
  vec3 exteriorBounce=texelFetch(surfaceAlbedo,a,0).rgb*skyBase*groundDiffuse*daylight.z;
  if(diagnostic==9){result.rgb=directSky;return;}
  if(auditTraceStage==1){result.rgb=directSky;return;}
  vec3 tangent=normalize(cross(abs(n.y)<.85?vec3(0,1,0):vec3(1,0,0),n));
  vec3 bitangent=cross(n,tangent), start=p+n*(layered==1?.004:.025), sum=vec3(0.), laterSum=vec3(0.);
  float screen=0.,fallback=0.,best=-1.,bestRoute=0.;int strongest=-1;vec3 strongestRGB=vec3(0.),strongestRay=vec3(0.);
  vec3 sourceEnergy=vec3(0.);
  int rays=bounceRays;
  ivec2 pixel=ivec2(gl_FragCoord.xy), local=pixel%3;
  int stratum=local.x+3*local.y;
  vec2 rotation=vec2(0.);
  if(samplePattern!=0){
    // A shared rotation preserves the nine strata in each neighbourhood.
    // Reconstruct the centre of that group on the receiver before hashing it.
    vec3 centre=p-dpdx*float(local.x-1)-dpdy*float(local.y-1);
    vec3 seed=samplePattern==1?p*100.:centre*20.;
    uvec3 cell=uvec3(ivec3(floor(seed)));
    uint phase=cell.x*1664525u^cell.y*2246822519u^cell.z*3266489917u;
    phase=(phase^(phase>>16))*1597334677u;phase^=phase>>16;
    rotation=vec2(phase&65535u,phase>>16)/65536.;
  }
  for(int k=0;k<rays;k++){
    float sampleIndex=float(k*9+stratum);
    float v=fract((sampleIndex+.5)/float(rays*9)+float(sequence)*.754877666+rotation.x);
    float phi=2.*pi*fract(.381966*sampleIndex+.19+float(sequence)*.569840296+rotation.y);
    vec3 ray=tangent*(sqrt(v)*cos(phi))+bitangent*(sqrt(v)*sin(phi))+n*sqrt(1.-v);
    int hit=screenHit(start,ray);float route=hit>=0 ? 1. : 2.;
    bool includeHit=diagnostic!=4 && diagnostic!=8;
    if(hit>=0){screen+=1.;}
    else if(auditTraceStage!=2) {
      hit=sceneHit(start,ray,7.);
      if(hit>=0){
        fallback+=1.;
        includeHit=diagnostic!=3;
        if(diagnostic==8){
          ivec2 a=address(hit);
          vec4 clip=viewProjection*vec4(texelFetch(surfacePoint,a,0).xyz,1.);
          includeHit=texelFetch(surfaceNormal,a,0).w==2. &&
            (clip.w<=0. || any(greaterThan(abs(clip.xy),vec2(clip.w))));
        }
      }
    }
    if(hit<0)continue;
    vec3 laterBounce;
    vec3 energy=outgoing(hit,ray,start,laterBounce);
    if(includeHit){sum+=energy;laterSum+=laterBounce;}
    if(inspectField>0 || diagnostic==15){
      energy+=laterBounce;
      float y=dot(energy*texelFetch(surfaceAlbedo,a,0).rgb,vec3(.2126,.7152,.0722));
      if(y>best){best=y;strongest=hit;strongestRGB=energy;bestRoute=route;strongestRay=ray;}
      sourceEnergy[int(route)-1]+=y;
    }
  }
  vec3 receiverAlbedo=texelFetch(surfaceAlbedo,a,0).rgb;
  vec3 firstBounce=receiverAlbedo*sum/float(rays), laterBounce=receiverAlbedo*laterSum/float(rays);
  result.rgb=firstBounce+laterBounce;
  if(diagnostic!=3 && diagnostic!=8)result.rgb+=exteriorBounce;
  if(diagnostic==0 || diagnostic==7 || diagnostic==21 || diagnostic==22)result.rgb+=directSky;
  if(floorIrradiance(a) && inspectField==0 && (diagnostic==0 || diagnostic==7 || diagnostic==14 || diagnostic==21 || diagnostic==22)){
    result.rgb=(sum+laterSum)/float(rays)+skyBase*groundDiffuse*daylight.z;
    if(diagnostic!=14)result.rgb+=skyBase*daylight.x+groundRadiance*daylight.y;
  }
  vec4 receiverSun=texelFetch(reflectedSun,a,0);
  vec3 directSolar=receiverSun.a*side>0.?receiverSun.rgb*sunGain:vec3(0.);
  if(diagnostic==17)result.rgb=directSolar;
  if(diagnostic==18)result.rgb=exteriorBounce;
  if(diagnostic==19)result.rgb=firstBounce;
  if(diagnostic==20)result.rgb=laterBounce;
  if(diagnostic==15){sourceEnergy.y+=dot(exteriorBounce,vec3(.2126,.7152,.0722))*float(rays);sourceEnergy.z=dot(directSky,vec3(.2126,.7152,.0722))*float(rays);result.rgb=sourceEnergy/max(.001,max(sourceEnergy.x,max(sourceEnergy.y,sourceEnergy.z)));}
  if(inspectField>0){
    ivec2 h=address(max(0,strongest));vec3 hn=texelFetch(surfaceNormal,h,0).xyz;
    vec4 light=texelFetch(reflectedSun,h,0),sky=texelFetch(skyVisibility,h,0);
    float hs=dot(hn,-strongestRay);vec2 visible=hs>=0.?sky.xy:sky.zw;
    if(inspectField==1)result=vec4(p,texelFetch(surfacePoint,a,0).w);
    if(inspectField==2)result=vec4(n,sign(side));
    if(inspectField==3 || inspectField==11){
      result=strongest>=0?texelFetch(surfacePoint,h,0):vec4(0.,0.,0.,-1.);
      if(inspectField==3 && strongest>=0)result.xyz=start+strongestRay*(dot(result.xyz-start,hn)/dot(strongestRay,hn));
    }
    if(inspectField==4)result=strongest>=0?vec4(hn,hs*light.a>0.?abs(light.a):0.):vec4(0.);
    if(inspectField==5)result=vec4(strongestRGB,strongest>=0?1./float(rays):0.);
    if(inspectField==6)result=vec4(texelFetch(surfaceAlbedo,a,0).rgb*strongestRGB/float(rays),bestRoute);
    if(inspectField==7)result=vec4(directSky,1.);
    if(inspectField==8)result.a=1.;
    if(inspectField==9)result=strongest>=0?vec4(hs*light.a>0.?abs(light.a):0.,visible,1.):vec4(0.);
    if(inspectField==10)result=vec4(receiverAlbedo,1.);
    if(inspectField==12)result=vec4(exteriorBounce,1.);
    if(inspectField==13)result=vec4(directSolar,1.);
    if(inspectField==14)result=vec4(firstBounce,1.);
    if(inspectField==15)result=vec4(laterBounce,1.);
    if(inspectField==16)result=vec4(screen/float(rays),fallback/float(rays),1.-(screen+fallback)/float(rays),1.);
  }
  if(diagnostic==6)result.rgb=vec3(screen/float(rays),fallback/float(rays),0.);
}`

