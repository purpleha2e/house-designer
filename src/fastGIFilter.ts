import { fastVolumeGLSL } from './fastGIPasses.ts'

// Filter irradiance in metres, independently of the grid's aspect ratio. Each
// one-dimensional sweep stops at the first occupied cell: opposite sides of a
// thin wall cannot share light. All SH bands use identical weights.
export const fastFilterSigma = .45
export const fastFilterFragment = /* glsl */ `
${fastVolumeGLSL}
uniform sampler2D light;
uniform vec2 outputSize;
uniform vec3 axis;
uniform float sigma;
void main() {
  vec2 packedUV=gl_FragCoord.xy/outputSize;
  vec4 original=texture2D(light,packedUV);
  if(length(axis)<.5) { gl_FragColor=original;return; }
  float band=floor(packedUV.y*4.0);vec3 cell=voxelCell();
  vec2 uv=voxelUV(cell);
  if(texture2D(light,vec2(uv.x,uv.y*.25)).a>.5) { gl_FragColor=original;return; }
  // Accumulate differences so a constant field survives half-float stores
  // exactly, rather than losing brightness to repeated division/rounding.
  vec3 delta=vec3(0.0);float weight=1.0;
  float spacing=length(axis*volumeSize/n);
  for(int side=0;side<2;side++) {
    vec3 direction=axis*(side==0?1.0:-1.0);
    for(int offset=1;offset<=16;offset++) {
      float distance=float(offset)*spacing;
      if(distance>sigma*3.0)break;
      vec3 next=cell+direction*float(offset);if(!inside(next))break;
      vec2 nextUV=voxelUV(next);
      if(texture2D(light,vec2(nextUV.x,nextUV.y*.25)).a>.5)break;
      float w=exp(-.5*distance*distance/(sigma*sigma));
      delta+=(texture2D(light,vec2(nextUV.x,(nextUV.y+band)*.25)).rgb-original.rgb)*w;weight+=w;
    }
  }
  // Alpha contains occupancy/observation flags, never filtered confidence.
  gl_FragColor=vec4(original.rgb+delta/weight,original.a);
}
`
