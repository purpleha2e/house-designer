/** Reconstruct a continuous value from the same coplanar, bounded patches
 * used by visibility. The receiver's own patch supplies any missing support. */
export const lumenPatchInterpolation=`
vec2 sourceID(ivec2 a){return vec2(texelFetch(supportLo,a,0).a,texelFetch(supportHi,a,0).a);}
void patchStencil(ivec2 a,vec3 p,vec3 normal,bool largeReceiver,out ivec4 indices,out vec4 weights){
  indices=ivec4(a.y*256+a.x);weights=vec4(1.,0.,0.,0.);
  if(layered==0)return;
  vec3 coarse=(p-gridOrigin)/spacing,ns=abs(normal);
  int axis=ns.y>ns.x?(ns.y>ns.z?1:2):(ns.x>ns.z?0:2);
  if(ns[axis]<.995)return;
  int u=(axis+1)%3,v=(axis+2)%3;
  if(largeReceiver){
    vec3 extent=texelFetch(supportHi,a,0).rgb-texelFetch(supportLo,a,0).rgb;
    if(min(extent[u],extent[v])<.4)return;
  }
  vec4 center=texelFetch(surfacePoint,a,0);
  ivec3 cell=ivec3(floor((center.xyz-gridOrigin)/spacing));
  vec2 f=clamp(vec2(coarse[u]-float(cell[u])-.5,coarse[v]-float(cell[v])-.5),vec2(-.5),vec2(.5));
  vec2 source=sourceID(a);
  weights.x=(1.-abs(f.x))*(1.-abs(f.y));
  for(int k=1;k<4;k++){
    int x=k&1,y=k>>1;
    float w=(x==0?1.-abs(f.x):abs(f.x))*(y==0?1.-abs(f.y):abs(f.y));
    if(w<.000001)continue;
    ivec3 at=cell;at[u]+=x*int(sign(f.x));at[v]+=y*int(sign(f.y));
    int i=cellAt(at);
    vec3 edge=gridOrigin+clamp(coarse,vec3(at),vec3(at+1))*spacing;
    for(int layer=0;layer<patchLimit && i>=0;layer++){
      ivec2 b=address(i);vec4 pos=texelFetch(surfacePoint,b,0);
      if(pos.w==center.w && all(equal(sourceID(b),source)) && dot(texelFetch(surfaceNormal,b,0).xyz,normal)>.995 &&
          abs(dot(pos.xyz-center.xyz,normal))<.003 && containsPoint(b,edge-pos.xyz,.004)){
        indices[k]=i;weights[k]=w;break;
      }
      i=nextPatch(b);
    }
  }
  weights/=dot(weights,vec4(1.));
}
vec3 patchFeedback(sampler2D front,sampler2D back,ivec2 a,bool frontFace){
  return frontFace?texelFetch(front,a,0).rgb:texelFetch(back,a,0).rgb;
}
void hitStencil(ivec2 a,vec3 normal,vec3 start,vec3 ray,out ivec4 cells,out vec4 w){
  cells=ivec4(a.y*256+a.x);w=vec4(1.,0.,0.,0.);
  float denom=dot(normal,ray);
  if(!filterFeedback || layered==0 || abs(denom)<.08)return;
  float t=dot(texelFetch(surfacePoint,a,0).xyz-start,normal)/denom;
  if(t>0.)patchStencil(a,start+ray*t,normal,false,cells,w);
}
vec3 feedbackFromStencil(sampler2D front,sampler2D back,ivec4 cells,vec4 w,bool frontFace){
  vec3 value=vec3(0.);
  for(int k=0;k<4;k++)if(w[k]>0.)value+=w[k]*patchFeedback(front,back,address(cells[k]),frontFace);
  return value;
}
vec3 daylightFromStencil(ivec4 cells,vec4 w,bool frontFace){
  vec3 value=vec3(0.);
  for(int k=0;k<4;k++)if(w[k]>0.){
    ivec2 a=address(cells[k]);
    vec4 sky=texelFetch(skyVisibility,a,0);
    vec2 ground=texelFetch(groundVisibility,a,0).xy;
    value+=w[k]*(frontFace?vec3(sky.xy,ground.x):vec3(sky.zw,ground.y));
  }
  return value;
}`
