import { lumenSceneHit } from './lumenFirstBounce'

export type LumenOpening = { center:number[]; width:number; height:number; u:number[]; exteriorOffset?:number;transmission?:number }
export const maxLumenOpenings = 16

type ApertureQuadrature = {
  clipReveals?:boolean
  elevated?:{ columns:number; rows:number; skySamples:number } | null
  terrainSkySamples?:number
  fixedTerrainElevation?:boolean
}

/** Project finite exterior apertures into both hemispheres of each cached
 * surface. The four factors are independent of exposure, sun and sky colour.
 * Changing the sun therefore never repeats the aperture visibility rays. */
export const skyVisibilityFragment = (lookup:string, {
  clipReveals=true,elevated={columns:4,rows:4,skySamples:1},terrainSkySamples=2,fixedTerrainElevation=false,
}:ApertureQuadrature={}) => `layout(location=0) out vec4 weights;layout(location=1) out vec4 groundWeights;
${lookup}
${lumenSceneHit}
uniform int openingCount,nearDirections,skyStrata;
uniform vec4 openingCenter[${maxLumenOpenings}], openingAxis[${maxLumenOpenings}];
uniform float openingTransmission[${maxLumenOpenings}], openingDepth[${maxLumenOpenings}];
uniform float overcast;
float cornerAngle(vec2 offset,float h){
  return atan(offset.x*offset.y,h*sqrt(dot(offset,offset)+h*h));
}
vec2 incoming(vec3 ray){
  return ray.y>=0. ? vec2(mix(.6+.8*ray.y,.5+ray.y,overcast),0.) : vec2(0.,1.);
}
// An escaping ray samples the environment. A ray that ends on the authored
// ground carries reflected skylight, whose visibility depends on the building.
vec3 visibleLight(vec3 start,vec3 ray,float apertureDistance,float stratum,float aperturePhase,bool denseAperture){
  float t=ray.y<-.0001?(groundY-start.y)/ray.y:-1.;
  vec3 hit=start+ray*max(t,0.);
  bool terrain=t>=apertureDistance-.01 && t>0. && onGround(hit);
  // Above a window, use the terrain-sky budget across more aperture tiles.
  // Other receivers keep opposed azimuths and two separate elevation strata.
  int skySamples=denseAperture?${elevated?.skySamples??terrainSkySamples}:${terrainSkySamples};
  int segments=terrain?1+skySamples:1;
  float reflectedSky=0.;
  for(int leg=0;leg<segments;leg++){
    if(leg==1){
      start=hit+vec3(0,.006,0);
    }
    if(leg>0){
      float v=(${fixedTerrainElevation?'0.5':'fract((stratum+.5)*.754877666+aperturePhase)'}+float(leg-1))/float(max(1,skySamples));
      float phi=6.2831853*fract(stratum*.569840296+aperturePhase+float(leg-1)*${terrainSkySamples>2?'0.61803399':'0.5'});
      ray=vec3(sqrt(v)*cos(phi),sqrt(1.-v),sqrt(v)*sin(phi));
    }
    bool blocked=sceneHit(start,ray,leg==0 && terrain?t-.006:12.)>=0;
    if(leg==0 && blocked)return vec3(0.);
    if(leg>0 && !blocked)reflectedSky+=incoming(ray).x;
  }
  if(terrain){
    float groundSky=skySamples>0?reflectedSky/float(skySamples):mix(17./15.,7./6.,overcast);
    return vec3(0.,0.,groundSky);
  }
  return vec3(incoming(ray),0.);
}
void main(){
  ivec2 at=ivec2(gl_FragCoord.xy);
  vec3 p=texelFetch(surfacePoint,at,0).xyz;
  vec4 surface=texelFetch(surfaceNormal,at,0);
  vec3 n=surface.xyz,up=vec3(0,1,0);
  weights=vec4(0.);groundWeights=vec4(0.);
  if(dot(n,n)<.5)return;
  bool ground=surface.w==3.;
  int openings=ground?1:openingCount;
  for(int i=0;i<openings;i++){
    vec3 axis=openingAxis[i].xyz,normal=cross(axis,up),delta=openingCenter[i].xyz-p;
    float aperturePhase=fract(dot(openingCenter[i].xyz,vec3(.723,.489,.671)));
    vec2 extent=.5*vec2(openingAxis[i].w,openingCenter[i].w);
    float signedPlane=dot(delta,normal),plane=abs(signedPlane);
    if(!ground && (plane<.001 || dot(delta,delta)>64.))continue;
    // Above the aperture, the finite tiles have no near-field singularity.
    // Switching estimators along the .9 m contour printed it onto ceilings.
    bool ceiling=abs(n.y)>.995 && -delta.y>extent.y;
    bool angular=ground || (!ceiling && plane<.9 && abs(dot(delta,axis))<extent.x+.6 && abs(delta.y)<extent.y+.6);
    bool denseAperture=${elevated?'!angular && -delta.y>extent.y':'false'};
    int columns=denseAperture?${elevated?.columns??0}:skyStrata,rows=denseAperture?${elevated?.rows??0}:skyStrata;
    vec2 apertureLo=-extent,apertureHi=extent,tileSize=vec2(0.);
    if(!angular){
      // Project the inner wall cut onto the exterior aperture. Their
      // intersection keeps the quadrature inside the rectangular reveal.
      // Scene rays still test the frame and every other occluder.
      float depth=openingDepth[i];
      if(${clipReveals?'depth*signedPlane>0. && plane>abs(depth)+.004':'false'}){
        float nearRatio=(signedPlane-depth)/signedPlane;
        vec2 shift=(1.-nearRatio)*vec2(dot(delta,axis),delta.y);
        apertureLo=max(apertureLo,(shift-extent)/nearRatio);
        apertureHi=min(apertureHi,(shift+extent)/nearRatio);
      }
      if(any(lessThanEqual(apertureHi,apertureLo)))continue;
      tileSize=(apertureHi-apertureLo)/vec2(columns,rows);
    }
    int perSide=angular?nearDirections:columns*rows;
    int samples=angular && !ground?2*perSide:perSide;
    for(int k=0;k<samples;k++){
      int j=k%perSide;
      float side=ground?sign(n.y):(k<perSide?1.:-1.);
      vec3 facing=ground?up:n*side,ray;
      float t=0.,weight,seed;
      if(angular){
        // Sample directions in the local hemisphere. Close to a frame, a
        // large part of that hemisphere can be covered by a single opening.
        vec3 x=normalize(cross(abs(facing.y)<.85?up:vec3(1,0,0),facing));
        float r=(float(j)+.5)/float(perSide),phi=6.2831853*fract(float(j)*.381966+.19);
        ray=x*(sqrt(r)*cos(phi))+cross(facing,x)*(sqrt(r)*sin(phi))+facing*sqrt(1.-r);
        if(!ground){
          float denom=dot(ray,normal);if(abs(denom)<.0001)continue;
          t=dot(delta,normal)/denom;
          vec3 offset=ray*t-delta;
          if(t<=0. || abs(dot(offset,axis))>extent.x || abs(offset.y)>extent.y)continue;
        }
        weight=1./float(perSide);seed=float(j);
      }else{
        vec2 tile=apertureLo+(vec2(j%columns,j/columns)+.5)*tileSize;
        vec3 sampleDelta=delta+axis*tile.x+up*tile.y;
        t=length(sampleDelta);ray=sampleDelta/t;
        vec3 cell=(p+sampleDelta-gridOrigin)/spacing;
        if(any(lessThan(cell,vec3(0.))) || any(greaterThanEqual(cell,vec3(textureSize(cells,0)))))continue;
        vec2 center=vec2(dot(sampleDelta,axis),sampleDelta.y),halfTile=tileSize*.5;
        vec2 lo=center-halfTile,hi=center+halfTile;
        float solidAngle=cornerAngle(hi,plane)+cornerAngle(lo,plane)
          -cornerAngle(vec2(lo.x,hi.y),plane)-cornerAngle(vec2(hi.x,lo.y),plane);
        float cosine=dot(n,ray);
        side=cosine>=0.?1.:-1.;facing=n*side;
        weight=abs(cosine)*solidAngle/3.14159265;
        if(weight<.00008)continue;
        seed=float(j);
      }
      vec3 energy=weight*visibleLight(p+facing*.003,ray,t,seed,aperturePhase,denseAperture);
      if(!ground)energy*=openingTransmission[i];
      if(side>0.){weights.xy+=energy.xy;groundWeights.x+=energy.z;}
      else{weights.zw+=energy.xy;groundWeights.y+=energy.z;}
    }
  }
}`
