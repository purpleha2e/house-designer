import { lumenSceneHit } from './lumenFirstBounce'
import { lumenPatchInterpolation } from './lumenPatchInterpolation'

/** Gather bounced radiance in surface space. Direct sky reflected from the
 * terrain is integrated separately by the aperture pass. Every iteration
 * reads the preceding complete atlas, so the two faces of a patch can never
 * see partly updated lighting or sample the framebuffer they are writing. */
export function surfaceBounceFragment(lookup:string){return `
layout(location=0) out vec4 front;
layout(location=1) out vec4 back;
${lookup}
${lumenSceneHit}
uniform sampler2D skyVisibility,groundVisibility,previousFront,previousBack;
uniform vec3 skyBase,groundRadiance,sunGain;
uniform int surfaceBounceOrder,surfaceBounceSamples,surfaceBouncePattern;
${lumenPatchInterpolation}
void main(){
  front=vec4(0.);back=vec4(0.);
  ivec2 at=ivec2(gl_FragCoord.xy);
  vec4 surface=texelFetch(surfaceNormal,at,0);
  if(dot(surface.xyz,surface.xyz)<.5 || surface.w==3.)return;
  vec3 p=texelFetch(surfacePoint,at,0).xyz;
  vec3 rho=texelFetch(surfaceAlbedo,at,0).rgb;
  int sampleCount=surfaceBounceSamples;
  float phase=.31;
  if(surfaceBouncePattern==1){
    vec3 cell=floor(p/spacing+.0001),a=abs(surface.xyz);
    vec2 plane=a.y>.9?cell.xz:a.x>.9?cell.yz:cell.xy;
    phase+=dot(mod(plane,2.),vec2(.5,.25));
  }else if(surfaceBouncePattern==2){
    vec2 source=vec2(texelFetch(supportLo,at,0).a,texelFetch(supportHi,at,0).a)*255.;
    phase+=fract(dot(source,vec2(.61803399,.75487767)));
  }else if(surfaceBouncePattern==3){
    uvec3 cell=uvec3(ivec3(floor(p/spacing+.0001)));
    uint hash=cell.x*1664525u^cell.y*2246822519u^cell.z*3266489917u;
    hash=(hash^(hash>>16))*1597334677u;
    phase+=float((hash^(hash>>16))&65535u)/65536.;
  }
  for(int i=0;i<2*sampleCount;i++){
    bool positive=i<sampleCount;
    vec3 n=positive?surface.xyz:-surface.xyz;
    vec3 tangent=normalize(cross(abs(n.y)<.85?vec3(0,1,0):vec3(1,0,0),n));
    float j=float(i%sampleCount)+.5;
    float r=j/float(sampleCount), phi=6.2831853*fract(j*.61803399+phase);
    vec3 ray=tangent*(sqrt(r)*cos(phi))+cross(n,tangent)*(sqrt(r)*sin(phi))+n*sqrt(1.-r);
    vec3 start=p+n*.006;
    int hit=sceneHit(start,ray,7.);
    if(hit<0)continue;
    ivec2 h=address(hit);
    vec4 source=texelFetch(surfaceNormal,h,0),sun=texelFetch(reflectedSun,h,0);
    float facing=dot(source.xyz,-ray);
    vec3 outgoing=facing*sun.a>0.?sun.rgb*sunGain:vec3(0.);
    if(source.w!=3.){
      vec3 albedo=texelFetch(surfaceAlbedo,h,0).rgb;
      ivec4 cells;vec4 w;hitStencil(h,source.xyz,start,ray,cells,w);
      vec3 daylight=daylightFromStencil(cells,w,facing>=0.);
      // The aperture pass has already integrated this source. Include it in
      // both sweeps so exterior-ground daylight propagates from the first.
      outgoing+=albedo*(skyBase*(daylight.x+groundDiffuse*daylight.z)+groundRadiance*daylight.y);
      if(surfaceBounceOrder>0){
        outgoing+=feedbackFromStencil(previousFront,previousBack,cells,w,facing>=0.);
      }
    }
    if(positive)front.rgb+=rho*outgoing/float(sampleCount);
    else back.rgb+=rho*outgoing/float(sampleCount);
  }
}`}
