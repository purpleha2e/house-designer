import { indirectL2IrradianceGLSL } from './indirectSH.ts'
import { INDIRECT_MAX_FLOORS } from './indirectLighting.ts'
import { INDIRECT_VOLUME_HEIGHT, INDIRECT_VOLUME_STRIDE } from './indirectVolume.ts'
/** Developer opt-in is fixed for the material family, while all view switches
 * are uniforms. Captures always bypass diagnostics. */
export const lightingDiagnosticsEnabled=typeof location!=='undefined'&&new URLSearchParams(location.search).has('lightingDiagnostics')
export const lightingDiagnosticModes=['Final composite','Direct lighting only','Sky lighting only','Indirect reflected only','World normals','Albedo','Matte white','Probe irradiance','Probe visibility'] as const
export type LightingDiagnosticMode=typeof lightingDiagnosticModes[number]
export const lightingDiagnosticGLSL=/* glsl */`
#ifdef HD_LIGHTING_DIAGNOSTICS
uniform float hdLightingDiagnostic,hdDiagnosticSkyReady;
vec3 hdDiagnosticSkySample(float floorIndex,vec3 p,vec3 normal,float floorReceiver,out float support){
  support=0.0;
  if(hdDiagnosticSkyReady<.5||floorIndex<0.0)return vec3(0.0);
  vec2 range=hdGIFloorRanges[int(floorIndex)],plan=clamp((p.xz-hdGIBounds.xy)/hdGIBounds.z,vec2(0.),vec2(1.));
  vec2 xy=(plan*(hdGIVolumeSize.x-1.)+.5)/hdGIVolumeSize.x;
  float h=clamp((p.y-range.x)/(range.y-range.x),0.,1.);
  vec3 uv=vec3(xy.x,(floorIndex*${INDIRECT_VOLUME_STRIDE}.+1.5+h*${INDIRECT_VOLUME_HEIGHT-1}.)/hdGIVolumeSize.y/HD_GI_COEFFICIENT_COUNT+.5/HD_GI_COEFFICIENT_COUNT,xy.y);
  vec3 n=normal;vec4 c0;vec3 c1,c2,c3;
  #ifdef HD_GI_L2
  vec3 c4,c5,c6,c7,c8;
  #endif
  if(floorReceiver>.5){vec2 q=(plan*(hdGIFloorLayerSize.x-1.)+.5)/hdGIFloorLayerSize.x;uv=vec3(q.x,(floorIndex+.5)/(hdGIFloorLayerSize.y*HD_GI_COEFFICIENT_COUNT)+.5/HD_GI_COEFFICIENT_COUNT,q.y);c0=textureLod(hdGIFloorLayer,uv,0.);c1=textureLod(hdGIFloorLayer,uv+vec3(0.,1./HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;c2=textureLod(hdGIFloorLayer,uv+vec3(0.,2./HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;c3=textureLod(hdGIFloorLayer,uv+vec3(0.,3./HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
#ifdef HD_GI_L2
${[4,5,6,7,8].map(i=>`c${i}=textureLod(hdGIFloorLayer,uv+vec3(0.,${i}.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;`).join("\n")}
#endif
}
  else{c0=textureLod(hdGIVolume,uv,0.);c1=textureLod(hdGIVolume,uv+vec3(0.,1./HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;c2=textureLod(hdGIVolume,uv+vec3(0.,2./HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;c3=textureLod(hdGIVolume,uv+vec3(0.,3./HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
#ifdef HD_GI_L2
${[4,5,6,7,8].map(i=>`c${i}=textureLod(hdGIVolume,uv+vec3(0.,${i}.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;`).join("\n")}
#endif
}
  vec3 light=c0.rgb*.886227+1.023328*(c1*normal.y+c2*normal.z+c3*normal.x);
#ifdef HD_GI_L2
  light=light ${indirectL2IrradianceGLSL};
#endif
  support=c0.a;
  return max(light/max(c0.a,.00001),vec3(0.));
}
vec3 hdDiagnosticSky(float floorIndex,vec3 p,vec3 normal,float floorReceiver){
  float support;
  vec3 light=hdDiagnosticSkySample(floorIndex,p,normal,floorReceiver,support);
  if(hdDiagnosticSkyReady<.5||floorIndex<0.0||floorReceiver>.5||hdGIFloorCount<2)return light;
  // Match hdGIVolumeIrradiance's open-storey reconstruction. Comparing an
  // unblended sky slab against blended total GI invents a reflected residual.
  vec2 plan=(p.xz-hdGIBounds.xy)/hdGIBounds.z;
  for(int lower=0;lower<${INDIRECT_MAX_FLOORS-1};lower++){
    if(lower+1>=hdGIFloorCount)break;
    if(abs(floorIndex-float(lower))>.1&&abs(floorIndex-float(lower+1))>.1)continue;
    float boundary=hdGIFloorRanges[lower+1].x+.06;
    float width=min(.3,(hdGIFloorRanges[lower].y-hdGIFloorRanges[lower].x)/${INDIRECT_VOLUME_HEIGHT-1}.0);
    if(abs(p.y-boundary)>=width)continue;
    vec3 below=textureLod(hdGIMask,vec2(plan.x,(plan.y+float(lower))/hdGIMaskSize.y),0.).rgb;
    vec3 above=textureLod(hdGIMask,vec2(plan.x,(plan.y+float(lower+1))/hdGIMaskSize.y),0.).rgb;
    float ceiling=mix(hdGIFloorRanges[lower].x,hdGIFloorRanges[lower].y,dot(below.gb,vec2(65280.,255.))/65535.);
    if(below.r<.5||above.r<.5||ceiling<boundary-.025)continue;
    float otherIndex=floorIndex<float(lower)+.5?float(lower+1):float(lower);
    float otherSupport;
    vec3 other=hdDiagnosticSkySample(otherIndex,p,normal,0.,otherSupport);
    if(otherSupport<.00001)continue;
    if(support<.00001)return other;
    float weight=smoothstep(boundary-width,boundary+width,p.y);
    if(floorIndex>float(lower)+.5)weight=1.-weight;
    return mix(light,other,weight);
  }
  return light;
}
#endif
`
export const lightingDiagnosticOutput=/* glsl */`
#if defined(HD_LIGHTING_DIAGNOSTICS) && !defined(HD_GI_DIRECT_CAPTURE)
if(hdGICapture<.5&&hdLightingDiagnostic>.5&&hdLightingDiagnostic<5.5){
  vec3 n=normalize(transformNormalByInverseViewMatrix(geometryNormal,viewMatrix));
  vec3 geometric=normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal,viewMatrix));
  vec3 p;float floorReceiver;float id=hdGIReceiver(hdGIWorldPosition,hdGIReceiverWorldOffset,geometric,hdGIFloorLayerReady,p,floorReceiver);
  vec3 sky=hdDiagnosticSky(id,p,n,floorReceiver)*material.diffuseContribution/PI;
  if(hdLightingDiagnostic>.5&&hdLightingDiagnostic<1.5)outgoingLight=reflectedLight.directDiffuse+reflectedLight.directSpecular+totalEmissiveRadiance;
  else if(hdLightingDiagnostic>1.5&&hdLightingDiagnostic<2.5)outgoingLight=sky;
  else if(hdLightingDiagnostic>2.5&&hdLightingDiagnostic<3.5){vec3 mean;vec3 total=id>=0.0?hdGIVolumeIrradiance(id,p,n,floorReceiver,mean):vec3(0.0);outgoingLight=max(total*material.diffuseContribution/PI-sky,vec3(0.0));}
  else if(hdLightingDiagnostic>3.5&&hdLightingDiagnostic<4.5)outgoingLight=n*.5+.5;
  else if(hdLightingDiagnostic>4.5&&hdLightingDiagnostic<5.5)outgoingLight=diffuseColor.rgb;
}
#endif
`
