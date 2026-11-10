import { Matrix4, Vector2, Vector3, Vector4, type Material, type Texture } from 'three'
import { cacheShaderKeyTransform } from './shaderKeyTransform.ts'
import { INDIRECT_ATLAS_SIZE, INDIRECT_MASK_SIZE, INDIRECT_MAX_FLOORS, INDIRECT_MAX_LOCAL_LIGHTS,writeIndirectContactTexture, type IndirectField } from './indirectLighting.ts'
import { INDIRECT_VOLUME_HEIGHT, INDIRECT_VOLUME_STRIDE } from './indirectVolume.ts'
import { createFastGIUniforms, fastGIShader } from './fastGIShader.ts'
import { lightingDiagnosticsEnabled, lightingDiagnosticGLSL, lightingDiagnosticOutput } from './lightingDiagnostics.ts'
import {daylightSkyGLSL,daylightSkyIrradianceGLSL} from './daylightSky.ts'
import { indirectL2IrradianceGLSL } from './indirectSH.ts'
import { isLightingGlazing } from './lightingVisibility.ts'
import {INDIRECT_CONTACT_PROBE_BUDGET,requestedIndirectContacts} from './indirectContactProbes.ts'
import {localSunPreviewGLSL} from './localSunPreview.ts'
import { exteriorSkyOcclusionGLSL } from './exteriorSkyOcclusion.ts'

export function createIndirectUniforms(field: IndirectField) {
  return {
    ...createFastGIUniforms(field.positions),
    hdGIEnabled: { value: 1 }, hdGICapture: { value: 0 },hdGIDiffuseCapture:{value:0}, hdGIIndoorFill: { value: .025 },
    hdWhiteModel: { value: 0 },
    hdExteriorSkyFeature: { value: 0 }, hdExteriorSkyStrength: { value: 0 }, hdExteriorSkyCell: { value: .35 }, hdExteriorSkyFill: { value: 1 },
    hdExteriorSkyField: { value: field.volume.maps[0] as Texture },
    hdExteriorEaveMin: { value: new Vector2() }, hdExteriorEaveSize: { value: new Vector2(1, 1) },
    hdExteriorEaveDimensions: { value: new Vector2(1, 1) }, hdExteriorEaveLayers: { value: 0 },
    hdExteriorEaveHeight: { value: new Vector2(0, 1) },
    hdExteriorSkyMin: { value: new Vector3() }, hdExteriorSkySize: { value: new Vector3(1, 1, 1) }, hdExteriorSkyDimensions: { value: new Vector3(1, 1, 1) },
    hdGIReceiverSafetyReady: { value: 0 },
    hdGIContactMode:{value:requestedIndirectContacts()?1:0},hdGIContactLayout:{value:0},
    hdGIContactTexture:{value:field.contactTexture as Texture},
    hdGIProbeStrength: { value: 1 }, hdGISHOrder: { value: field.shOrder },
    hdLightingDiagnostic: { value: 0 }, hdDiagnosticSkyReady: { value: 0 },
    hdDiagnosticSkyVolume: { value: field.volume.maps[0] as Texture }, hdDiagnosticSkyFloor: { value: field.floorLayer.texture as Texture },
    hdSkyMode: { value: 1 }, hdSkyRadianceBase: { value: new Vector3() }, hdSkySunIrradiance: { value: new Vector3() },
    hdSkyDisplayRadianceBase: { value: new Vector3() }, hdSkyDisplaySunIrradiance: { value: new Vector3() },
    hdGIDisplayStrength: { value: 1 },
    hdSunBounceStrength: { value: 1 }, hdSunBounceReady: { value: 0 },
    hdSunBounceFeature: { value: 0 }, hdSunBouncePacked: { value: 0 }, hdSunOffVolume: { value: field.volume.maps[0] as Texture }, hdSunOffFloor: { value: field.floorLayer.texture as Texture },
    hdLocalSunFeature:{value:0},hdLocalSunReady:{value:0},hdLocalSunDisplay:{value:1},hdLocalSunCombined:{value:0},hdLocalSunViewProjection:{value:new Matrix4()},hdLocalSunVolumeScale:{value:1},hdLocalSunPackedSize:{value:new Vector4(1,1,0,1)},hdLocalSunSize:{value:new Vector2(1,1)},
    hdGIMask: { value: field.mask as Texture }, hdGIPositions: { value: field.positions as Texture },
    hdGIDistances: { value: field.distances as Texture },
    hdGIDistanceLayout: { value: new Vector3(field.distanceColumns, field.distanceRows, field.distanceSize) },
    hdGITriangles: { value: field.positions as Texture },
    hdGITriangleSize: { value: new Vector2(INDIRECT_ATLAS_SIZE, INDIRECT_ATLAS_SIZE) },
    hdGIPointIndices: { value: new Float32Array(INDIRECT_MAX_LOCAL_LIGHTS).fill(-1) },
    hdGISpotIndices: { value: new Float32Array(INDIRECT_MAX_LOCAL_LIGHTS).fill(-1) },
    hdGIUseVolume: { value: 0 }, hdGIVolume: { value: field.volume.maps[0] as Texture },
    hdGIVolumeSize: { value: new Vector2(field.volume.n, field.volume.height) },
    hdGIFloorLayer: { value: field.floorLayer.texture as Texture },
    hdGIFloorLayerSize: { value: new Vector2(field.floorLayer.n, field.floorLayer.height) },
    hdGIFloorLayerReady: { value: field.floorLayer.ready ? 1 : 0 },
    hdGIRed: { value: field.maps[0] as Texture }, hdGIGreen: { value: field.maps[1] as Texture }, hdGIBlue: { value: field.maps[2] as Texture },
    hdGIBounds: { value: new Vector3(field.bounds.minX, field.bounds.minZ, field.bounds.size) },
    hdGIFloorCount: { value: field.floors.length },
    hdGIFloorRanges: { value: field.ranges.map(range => new Vector2(range.bottom, range.top)) },
    hdGIGrids: { value: field.grids.map(grid => new Vector4(grid.lower, grid.upper, grid.start, 0)) },
    hdGIGrid: { value: new Vector4(field.bounds.minX, field.bounds.minZ, field.spacing, field.n) },
    hdGIMaskSize: { value: new Vector4(1, Math.max(1, field.floors.length), 0, 0) },
  }
}
export type IndirectUniforms = ReturnType<typeof createIndirectUniforms>
/** React preserves the lighting state across hot updates. Upgrade it in place
 * before a newly compiled exterior shader or cached roof field uses it. */
export function ensureExteriorSkyUniforms(uniforms: IndirectUniforms) {
  const upgraded = !uniforms.hdExteriorEaveLayers || !uniforms.hdExteriorSkyFeature
  uniforms.hdExteriorSkyFeature ??= { value: 0 }
  uniforms.hdExteriorSkyStrength ??= { value: 0 }
  uniforms.hdExteriorSkyCell ??= { value: .35 }
  uniforms.hdExteriorSkyFill ??= { value: .75 }
  uniforms.hdExteriorSkyField ??= { value: uniforms.hdGIVolume.value }
  uniforms.hdExteriorSkyMin ??= { value: new Vector3() }
  uniforms.hdExteriorSkySize ??= { value: new Vector3(1, 1, 1) }
  uniforms.hdExteriorSkyDimensions ??= { value: new Vector3(1, 1, 1) }
  uniforms.hdExteriorEaveMin ??= { value: new Vector2() }
  uniforms.hdExteriorEaveSize ??= { value: new Vector2(1, 1) }
  uniforms.hdExteriorEaveDimensions ??= { value: new Vector2(1, 1) }
  uniforms.hdExteriorEaveLayers ??= { value: 0 }
  uniforms.hdExteriorEaveHeight ??= { value: new Vector2(0, 1) }
  return upgraded
}
export const indirectShaderDefines = (uniforms: IndirectUniforms) => ({...(uniforms.hdGISHOrder.value===2?{HD_GI_L2:1}:{}),...(uniforms.hdGIContactMode.value>.5?{HD_GI_CONTACT_RECEIVERS:1}:{})})
const materialUniforms = new WeakMap<Material, IndirectUniforms>()
const exteriorSkyMaterials = new WeakSet<Material>()
export function enableExteriorSkyMaterial(material: Material) {
  if (exteriorSkyMaterials.has(material)) return false
  exteriorSkyMaterials.add(material); material.needsUpdate = true; return true
}
export const getIndirectLightingUniforms = (material: Material) => materialUniforms.get(material)
const localReflectionUniforms = new WeakMap<Material, { value: number }>()
export function setIndirectLocalReflection(material: Material, enabled: boolean) {
  const uniform = localReflectionUniforms.get(material)
  if (uniform) uniform.value = enabled ? 1 : 0
}

export function updateIndirectUniforms(uniforms: IndirectUniforms, field: IndirectField) {
  ensureExteriorSkyUniforms(uniforms)
  // Preserve uniform object identity while upgrading a running editor on HMR.
  if (!uniforms.hdFastFeature) Object.assign(uniforms, createFastGIUniforms(field.positions))
  uniforms.hdGIProbeStrength ??= { value: 1 }
  uniforms.hdWhiteModel ??= { value: 0 }
  uniforms.hdGIContactMode??={value:requestedIndirectContacts()?1:0};uniforms.hdGIContactLayout??={value:0}
  uniforms.hdGIContactTexture??={value:field.contactTexture as Texture}
  uniforms.hdGIContactTexture.value=field.contactTexture
  uniforms.hdGIReceiverSafetyReady??={value:0}
  const contacts=field.probes.filter(p=>p.kind==='contact')
  uniforms.hdGIContactLayout.value=field.contactReceiverTag
  if(uniforms.hdGIContactMode.value>.5&&!field.contactFrozen)writeIndirectContactTexture(field)
  uniforms.hdGIReceiverSafetyReady.value=field.contactLighting&&contacts.length>0?(contacts.every(p=>field.positionData[p.index*4+3]>.5)?1:.25):0
  uniforms.hdGISHOrder ??= { value: field.shOrder }
  uniforms.hdGISHOrder.value = field.shOrder
  uniforms.hdGIDisplayStrength ??= { value: 1 }
  uniforms.hdSunBounceFeature ??= { value: 0 }; uniforms.hdSunBouncePacked ??= { value: 0 }; uniforms.hdSunBounceStrength ??= { value: 1 }; uniforms.hdSunBounceReady ??= { value: 0 }
  uniforms.hdSunOffVolume ??= { value: field.volume.maps[0] }; uniforms.hdSunOffFloor ??= { value: field.floorLayer.texture }
  uniforms.hdGIDiffuseCapture??={value:0}
  uniforms.hdLightingDiagnostic??={value:0};uniforms.hdDiagnosticSkyReady??={value:0}
  uniforms.hdDiagnosticSkyVolume??={value:field.volume.maps[0]};uniforms.hdDiagnosticSkyFloor??={value:field.floorLayer.texture}
  uniforms.hdSkyMode??={value:1};uniforms.hdSkyRadianceBase??={value:new Vector3()};uniforms.hdSkySunIrradiance??={value:new Vector3()}
  uniforms.hdSkyDisplayRadianceBase??={value:new Vector3()};uniforms.hdSkyDisplaySunIrradiance??={value:new Vector3()}
  for (const uniform of [uniforms.hdGIPointIndices, uniforms.hdGISpotIndices]) {
    if (uniform.value.length < INDIRECT_MAX_LOCAL_LIGHTS) {
      const indices = new Float32Array(INDIRECT_MAX_LOCAL_LIGHTS).fill(-1)
      indices.set(uniform.value); uniform.value = indices
    }
  }
  uniforms.hdGIFloorLayer ??= { value: field.floorLayer.texture }
  uniforms.hdGIFloorLayerSize ??= { value: new Vector2() }
  uniforms.hdGIFloorLayerReady ??= { value: 0 }
  uniforms.hdGITriangles ??= { value: field.positions }
  uniforms.hdGITriangleSize ??= { value: new Vector2(INDIRECT_ATLAS_SIZE, INDIRECT_ATLAS_SIZE) }
  if (!(uniforms.hdGIDistanceLayout.value instanceof Vector3)) uniforms.hdGIDistanceLayout.value = new Vector3()
  uniforms.hdGIMask.value = field.mask; uniforms.hdGIPositions.value = field.positions; uniforms.hdGIDistances.value = field.distances
  uniforms.hdGIDistanceLayout.value.set(field.distanceColumns, field.distanceRows, field.distanceSize)
  if (uniforms.hdGIVolume.value !== field.volume.maps[0]) uniforms.hdGIUseVolume.value = 0
  uniforms.hdGIVolume.value = field.volume.maps[0]
  uniforms.hdGIVolumeSize.value.set(field.volume.n, field.volume.height)
  uniforms.hdGIFloorLayer.value = field.floorLayer.texture
  uniforms.hdGIFloorLayerSize.value.set(field.floorLayer.n, field.floorLayer.height)
  uniforms.hdGIFloorLayerReady.value = field.floorLayer.ready ? 1 : 0
  uniforms.hdGIRed.value = field.maps[0]; uniforms.hdGIGreen.value = field.maps[1]; uniforms.hdGIBlue.value = field.maps[2]
  uniforms.hdGIBounds.value.set(field.bounds.minX, field.bounds.minZ, field.bounds.size)
  uniforms.hdGIFloorCount.value = field.floors.length
  field.ranges.forEach((range, i) => uniforms.hdGIFloorRanges.value[i].set(range.bottom, range.top))
  field.grids.forEach((grid, i) => uniforms.hdGIGrids.value[i].set(grid.lower, grid.upper, grid.start, 0))
  uniforms.hdGIGrid.value.set(field.bounds.minX, field.bounds.minZ, field.spacing, field.n)
  uniforms.hdGIMaskSize.value.y = Math.max(1, field.floors.length)
}

export const indirectContactShaderDeclarations=/* glsl */`
#ifdef HD_GI_CONTACT_RECEIVERS
uniform sampler2D hdGIContactTexture;
vec3 hdGIContactIrradiance(float link,vec3 n,out vec3 meanLight){
 float x=(link-.5)/${INDIRECT_CONTACT_PROBE_BUDGET}.0;
 vec4 basis=vec4(.886227,1.023328*n.y,1.023328*n.z,1.023328*n.x);
 vec4 r=texture2D(hdGIContactTexture,vec2(x,1./6.)),g=texture2D(hdGIContactTexture,vec2(x,.5)),b=texture2D(hdGIContactTexture,vec2(x,5./6.));
 meanLight=.886227*vec3(r.x,g.x,b.x);
 return max(vec3(dot(r,basis),dot(g,basis),dot(b,basis)),vec3(0.));
}
#endif
`

/** Receiver selection is shared by the lit shader and the unlit surface pass. */
export const indirectReceiverShaderDeclarations = /* glsl */ `
varying vec3 hdGIWorldPosition;
varying vec3 hdGIReceiverWorldOffset;
varying vec4 hdGICornerPlane0;
varying vec4 hdGICornerPlane1;
varying vec4 hdGIWallMountPlane0;
varying vec4 hdGIWallMountPlane1;
varying vec2 hdGIReceiverBiasLimit;
uniform float hdGIReceiverSafetyReady,hdGICapture;
#ifdef HD_GI_CONTACT_RECEIVERS
flat varying vec2 hdGIContactLinkValue;
uniform float hdGIContactLayout;
#endif
float hdGIContactReceiver(){
 #ifdef HD_GI_CONTACT_RECEIVERS
 if(gl_FrontFacing&&hdGIContactLinkValue.x>.5&&abs(hdGIContactLinkValue.y-hdGIContactLayout)<.1)return hdGIContactLinkValue.x;
 #endif
 return 0.;
}
${indirectContactShaderDeclarations}
uniform sampler2D hdGIMask;
uniform vec2 hdGIVolumeSize;
uniform vec3 hdGIBounds;
uniform int hdGIFloorCount;
uniform vec2 hdGIFloorRanges[${INDIRECT_MAX_FLOORS}];
uniform vec4 hdGIMaskSize;

float hdGIFloor(vec3 p, vec3 surfaceNormal) {
  vec2 uv = (p.xz - hdGIBounds.xy) / hdGIBounds.z;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) return -1.0;
  for (int floorIndex = 0; floorIndex < ${INDIRECT_MAX_FLOORS}; floorIndex++) {
    if (floorIndex >= hdGIFloorCount) break;
    vec2 range = hdGIFloorRanges[floorIndex];
    if (p.y >= range.x && p.y < range.y) {
      // Occupancy distinguishes inside from outside, never one room from another.
      vec3 mask = textureLod(hdGIMask, vec2(uv.x, (uv.y + float(floorIndex)) / hdGIMaskSize.y), 0.0).rgb;
      float ceiling = mix(range.x, range.y, dot(mask.gb, vec2(65280.0, 255.0)) / 65535.0);
      // Occupancy stays discrete. Ceiling heights describe samples at texel
      // centres, however: a nearest lookup turns a pitched roof into steps
      // and classifies the tips of its interior wall as outdoor sky receivers.
      // Only reconstruct headroom near that boundary, never blend occupancy
      // across a wall or borrow a height from an empty neighbouring texel.
      if (mask.r > .5 && surfaceNormal.y <= .01 && p.y > ceiling) {
        float nearestCeiling = ceiling;
        vec2 grid = uv * ${INDIRECT_MASK_SIZE}.0 - .5;
        vec2 base = floor(grid), blend = fract(grid);
        float height = 0.0, weight = 0.0;
        for (int corner = 0; corner < 4; corner++) {
          vec2 c = vec2(float(corner % 2), float(corner / 2));
          vec2 cell = clamp(base + c, vec2(0.0), vec2(${INDIRECT_MASK_SIZE - 1}.0));
          vec2 sampleUV = (cell + .5) / ${INDIRECT_MASK_SIZE}.0;
          vec3 sampleMask = textureLod(hdGIMask, vec2(sampleUV.x,
            (sampleUV.y + float(floorIndex)) / hdGIMaskSize.y), 0.0).rgb;
          vec2 weights = mix(vec2(1.0) - blend, blend, c);
          float w = weights.x * weights.y * step(.5, sampleMask.r);
          height += w * dot(sampleMask.gb, vec2(65280.0, 255.0)) / 65535.0;
          weight += w;
        }
        if (weight > .00001) ceiling = mix(range.x, range.y, height / weight);
        // Packed-height rounding and the roof closure's millimetre clearance.
        ceiling += .002;
        if (p.y > ceiling) {
          // Bilinear reconstruction rounds down a ridge between samples.
          // Bound that sub-texel peak by the neighbouring height gradients;
          // flat ceilings gain no footprint-sized vertical allowance.
          vec2 variation = vec2(0.0);
          vec2 centre = floor(uv * ${INDIRECT_MASK_SIZE}.0);
          for (int neighbour = 0; neighbour < 4; neighbour++) {
            vec2 delta = neighbour < 2 ? vec2(neighbour == 0 ? -1.0 : 1.0, 0.0)
              : vec2(0.0, neighbour == 2 ? -1.0 : 1.0);
            vec2 cell = clamp(centre + delta, vec2(0.0), vec2(${INDIRECT_MASK_SIZE - 1}.0));
            vec2 sampleUV = (cell + .5) / ${INDIRECT_MASK_SIZE}.0;
            vec3 sampleMask = textureLod(hdGIMask, vec2(sampleUV.x,
              (sampleUV.y + float(floorIndex)) / hdGIMaskSize.y), 0.0).rgb;
            if (sampleMask.r <= .5) continue;
            float sampleHeight = mix(range.x, range.y, dot(sampleMask.gb, vec2(65280.0, 255.0)) / 65535.0);
            variation = max(variation, abs(delta) * abs(sampleHeight - nearestCeiling));
          }
          ceiling = max(ceiling, nearestCeiling + .5 * (variation.x + variation.y) + .001);
        }
      }
      return mask.r > .5 && p.y <= ceiling ? float(floorIndex) : -1.0;
    }
  }
  return -1.0;
}

vec3 hdGIConstrainCorner(vec3 p, vec4 plane, vec3 stepSize) {
  if (dot(plane.xyz, plane.xyz) < .5) return p;
  float clearance = .02 + dot(abs(plane.xyz), stepSize);
  return p + plane.xyz * max(0.0, plane.w + clearance - dot(plane.xyz, p));
}

vec3 hdGIWallMountOffset(vec3 p, vec3 surfaceNormal) {
  vec3 offset = vec3(0.0);
  for (int side = 0; side < 2; side++) {
    vec4 plane = side == 0 ? hdGIWallMountPlane0 : hdGIWallMountPlane1;
    float support = length(plane.xyz);
    if (support < .5) continue;
    plane /= support;
    float facing = dot(surfaceNormal, plane.xyz);
    // Front/back faces own their side. Tangential frame edges use the side
    // from which they are viewed, including offscreen probe captures.
    if (facing < -.35 || (facing <= .35 && dot(cameraPosition - p, plane.xyz) <= 0.0)) continue;
    offset = plane.xyz * max(0.0, plane.w - dot(plane.xyz, p));
    break;
  }
  return offset;
}

float hdGIReceiver(vec3 worldPosition, vec3 offset, vec3 surfaceNormal, float floorLayerReady,
    out vec3 samplePosition, out float floorReceiver) {
  offset += hdGIWallMountOffset(worldPosition, surfaceNormal);
  float classificationBias=.08;
  #ifdef HD_GI_SURFACE_DATA
    if(hdGIReceiverSafetyReady>0.&&hdGIContactReceiver()>.5)classificationBias=min(classificationBias,hdGIReceiverBiasLimit.x);
  #else
    if((hdGIReceiverSafetyReady>.5||(hdGICapture>.5&&hdGIReceiverSafetyReady>0.))&&hdGIContactReceiver()>.5)classificationBias=min(classificationBias,hdGIReceiverBiasLimit.x);
  #endif
  float id = hdGIFloor(worldPosition + offset + surfaceNormal * classificationBias, surfaceNormal);
  // Reveals receive light on the same wall side used for classification.
  // Sampling inside the wall lets interpolation borrow the bright room behind
  // a jamb even though its owning room was classified correctly.
  samplePosition = worldPosition + offset; floorReceiver = 0.0;
  #ifdef HD_GI_CONTACT_RECEIVERS
  if(id<0.){
    // An interior face does not become exterior sky merely because its
    // classification offset crossed a wall at a furniture contact.
    float ownSide=hdGIFloor(samplePosition+surfaceNormal*.002,surfaceNormal);
    if(ownSide>=0.){samplePosition+=surfaceNormal*.002;return ownSide;}
  }
  #endif
  if (id < 0.0) return id;
  vec2 range = hdGIFloorRanges[int(id)];
  vec3 stepSize = vec3(hdGIBounds.z / (hdGIVolumeSize.x - 1.0),
    (range.y - range.x) / ${INDIRECT_VOLUME_HEIGHT - 1}.0, hdGIBounds.z / (hdGIVolumeSize.x - 1.0));
  float floorHeight = range.x + .06;
  floorReceiver = floorLayerReady > .5 && surfaceNormal.y > .9 &&
    worldPosition.y >= floorHeight - .02 && worldPosition.y <= floorHeight + .08 ? 1.0 : 0.0;
  // Trilinear taps can lie a full grid interval from the sample coordinate.
  // Half a cell only clears a surface aligned to the centre of that cell;
  // at other alignments it blends valid light from the far side of a wall.
  float bias = floorReceiver > .5 ? .004 : .02 + dot(abs(surfaceNormal), stepSize);
  #ifdef HD_GI_SURFACE_DATA
    if(hdGIReceiverSafetyReady>0.&&hdGIContactReceiver()>.5)bias=min(bias,hdGIReceiverBiasLimit.x);
  #else
    if((hdGIReceiverSafetyReady>.5||(hdGICapture>.5&&hdGIReceiverSafetyReady>0.))&&hdGIContactReceiver()>.5)bias=min(bias,hdGIReceiverBiasLimit.x);
  #endif
  samplePosition += surfaceNormal * bias;
  // A normal bias protects only this face. At an inside corner the texture
  // footprint must also clear the adjoining solid face, on the same room side.
  if (floorReceiver < .5) {
    samplePosition = hdGIConstrainCorner(samplePosition, hdGICornerPlane0, stepSize);
    samplePosition = hdGIConstrainCorner(samplePosition, hdGICornerPlane1, stepSize);
  }
  return id;
}
`

export const indirectVisibilityShaderDeclarations = /* glsl */ `
uniform sampler2D hdGIPositions;
uniform sampler2D hdGIDistances;
uniform vec3 hdGIDistanceLayout;
uniform sampler2D hdGITriangles;
uniform vec2 hdGITriangleSize;

vec2 hdGIOctUV(vec3 direction) {
  vec3 n = direction / max(abs(direction.x) + abs(direction.y) + abs(direction.z), .0001);
  vec2 uv = n.xy;
  if (n.z < 0.0) uv = (1.0 - abs(uv.yx)) * mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), uv));
  return uv * .5 + .5;
}

vec3 hdGIOctDirection(vec2 uv) {
  vec2 xy = uv * 2.0 - 1.0;
  vec3 n = vec3(xy, 1.0 - abs(xy.x) - abs(xy.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), n.xy));
  return normalize(n);
}

// Ray/triangle visibility belongs to offscreen lighting capture. A uniform
// early-out still makes drivers compile/inline it for every displayed light.
#ifdef HD_GI_CAPTURE_VISIBILITY
vec4 hdGITriangleVertex(float index) {
  return texture2D(hdGITriangles, (vec2(mod(index, hdGITriangleSize.x), floor(index / hdGITriangleSize.x)) + .5) / hdGITriangleSize);
}

float hdGITriangleBlocks(float offset, vec3 origin, vec3 direction, float distanceToReceiver) {
  vec3 a = hdGITriangleVertex(offset).xyz;
  vec3 e1 = hdGITriangleVertex(offset + 1.0).xyz - a;
  vec3 e2 = hdGITriangleVertex(offset + 2.0).xyz - a;
  vec3 h = cross(direction, e2);
  float determinant = dot(e1, h);
  if (abs(determinant) < .00000001) return 0.0;
  vec3 s = origin - a;
  float u = dot(s, h) / determinant;
  vec3 q = cross(s, e1);
  float v = dot(direction, q) / determinant;
  float t = dot(e2, q) / determinant;
  if (t <= .00001 || t >= 1.0 - .002 / distanceToReceiver) return 0.0;
  if (u >= -.00001 && v >= -.00001 && u + v <= 1.00001) return 1.0;
  // Close millimetre seams without extending a thin triangle's infinite plane.
  vec3 point = origin + direction * t - a;
  vec3 e3 = e2 - e1, pointB = point - e1;
  float edgeA = length(point - e1 * clamp(dot(point, e1) / max(dot(e1, e1), .00000001), 0.0, 1.0));
  float edgeB = length(point - e2 * clamp(dot(point, e2) / max(dot(e2, e2), .00000001), 0.0, 1.0));
  float edgeC = length(pointB - e3 * clamp(dot(pointB, e3) / max(dot(e3, e3), .00000001), 0.0, 1.0));
  return min(edgeA, min(edgeB, edgeC)) <= .003 ? 1.0 : 0.0;
}

float hdGIPrimitiveBlocks(float id, vec3 origin, vec3 direction, float distanceToReceiver) {
  float offset = (id - 1.0) * 7.0;
  vec4 plane = hdGITriangleVertex(offset);
  if (dot(plane.xyz, plane.xyz) > .5) {
    float denominator = dot(plane.xyz, direction);
    if (abs(denominator) < .00000001) return 0.0;
    float t = (plane.w - dot(plane.xyz, origin)) / denominator;
    if (t <= .00001 || t >= 1.0 - .002 / distanceToReceiver) return 0.0;
  }
  if (hdGITriangleBlocks(offset + 1.0, origin, direction, distanceToReceiver) > .5) return 1.0;
  return hdGITriangleBlocks(offset + 4.0, origin, direction, distanceToReceiver);
}

float hdGIVisibilityFrom(sampler2D positions, sampler2D distances, vec3 distanceLayout,
    float index, vec3 p, out vec3 probePosition) {
  vec2 tile = vec2(mod(index, ${INDIRECT_ATLAS_SIZE}.0), floor(index / ${INDIRECT_ATLAS_SIZE}.0));
  vec4 probe = texture2D(positions, (tile + .5) / ${INDIRECT_ATLAS_SIZE}.0);
  probePosition = probe.xyz;
  if (probe.w < .5) return -1.0;
  float lightIndex = index - ${INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS}.0;
  if (lightIndex < 0.0 || lightIndex >= distanceLayout.x * distanceLayout.y) return -1.0;
  vec2 lightTile = vec2(mod(lightIndex, distanceLayout.x), floor(lightIndex / distanceLayout.x));
  vec3 direction = p - probe.xyz;
  float distanceToProbe = length(direction);
  if (distanceToProbe < .001) return 1.0;
  float size = distanceLayout.z;
  vec2 pixel = clamp(hdGIOctUV(direction) * size - .5, vec2(0.0), vec2(size - 1.0));
  vec2 base = floor(pixel);
  vec4 candidates = vec4(0.0);
  for (int corner = 0; corner < 4; corner++) {
    vec2 c = vec2(float(corner - (corner / 2) * 2), float(corner / 2));
    vec2 sampleUV = (min(base + c, vec2(size - 1.0)) + .5) / size;
    candidates[corner] = texture2D(distances, (lightTile + sampleUV) / distanceLayout.xy).r;
  }
  for (int corner = 0; corner < 4; corner++) {
    float id = candidates[corner];
    if (id < .5 || (corner > 0 && id == candidates.x) || (corner > 1 && id == candidates.y) ||
      (corner > 2 && id == candidates.z)) continue;
    if (hdGIPrimitiveBlocks(id, probe.xyz, direction, distanceToProbe) > .5) return 0.0;
  }
  return 1.0;
}

float hdGIVisibility(float index, vec3 p, out vec3 probePosition) {
  return hdGIVisibilityFrom(hdGIPositions, hdGIDistances, hdGIDistanceLayout, index, p, probePosition);
}

#endif

`

const indirectVolumeShaderBody = /* glsl */ `
#ifdef HD_GI_L2
#define HD_GI_COEFFICIENT_COUNT 9.0
#else
#define HD_GI_COEFFICIENT_COUNT 4.0
#endif
#ifndef HD_GI_DIRECT_CAPTURE
vec3 hdGIVolumeSample(float floorIndex, vec3 p, vec3 n, float floorReceiver, out vec3 meanLight, out float support) {
  meanLight = vec3(0.0);
  support = 0.0;
  if (hdGIUseVolume < .5) return vec3(0.0);
  vec2 range = hdGIFloorRanges[int(floorIndex)];
  vec2 plan = clamp((p.xz - hdGIBounds.xy) / hdGIBounds.z, vec2(0.0), vec2(1.0));
  vec2 volumePlan = (plan * (hdGIVolumeSize.x - 1.0) + .5) / hdGIVolumeSize.x;
  float height = clamp((p.y - range.x) / (range.y - range.x), 0.0, 1.0);
  vec3 uv = vec3(volumePlan.x, (floorIndex * ${INDIRECT_VOLUME_STRIDE}.0 + 1.5 + height * ${INDIRECT_VOLUME_HEIGHT - 1}.0) / hdGIVolumeSize.y, volumePlan.y);
  uv.y /= HD_GI_COEFFICIENT_COUNT;
  vec4 c0; vec3 c1, c2, c3;
  #ifdef HD_GI_L2
    vec3 c4,c5,c6,c7,c8;
  #endif
  if (floorReceiver > .5) {
    vec2 floorPlan = (plan * (hdGIFloorLayerSize.x - 1.0) + .5) / hdGIFloorLayerSize.x;
    vec3 floorUV = vec3(floorPlan.x, (floorIndex + .5) / (hdGIFloorLayerSize.y * HD_GI_COEFFICIENT_COUNT), floorPlan.y);
    c0 = textureLod(hdGIFloorLayer, floorUV, 0.0);
    c1 = textureLod(hdGIFloorLayer, floorUV + vec3(0.0, 1.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c2 = textureLod(hdGIFloorLayer, floorUV + vec3(0.0, 2.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c3 = textureLod(hdGIFloorLayer, floorUV + vec3(0.0, 3.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    #ifdef HD_GI_L2
      ${[4,5,6,7,8].map(i=>`c${i}=textureLod(hdGIFloorLayer,floorUV+vec3(0.,${i}.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;`).join('\n')}
    #endif
  } else {
    c0 = textureLod(hdGIVolume, uv, 0.0);
    c1 = textureLod(hdGIVolume, uv + vec3(0.0, 1.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c2 = textureLod(hdGIVolume, uv + vec3(0.0, 2.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c3 = textureLod(hdGIVolume, uv + vec3(0.0, 3.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    #ifdef HD_GI_L2
      ${[4,5,6,7,8].map(i=>`c${i}=textureLod(hdGIVolume,uv+vec3(0.,${i}.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;`).join('\n')}
    #endif
  }
  // Missing support inside a solid is not black illumination. Renormalize the
  // hardware filter, while retaining genuinely dark but valid samples.
  float coverage = max(c0.a, .00001);
  support = c0.a;
  meanLight = c0.rgb * (.886227 / coverage);
  vec4 basis = vec4(.886227, 1.023328 * n.y, 1.023328 * n.z, 1.023328 * n.x);
  vec3 light=c0.rgb * basis.x + c1 * basis.y + c2 * basis.z + c3 * basis.w;
  #ifdef HD_GI_L2
    light=light ${indirectL2IrradianceGLSL};
  #endif
  return max(light / coverage, vec3(0.0));
}

vec3 hdGIVolumeIrradiance(float floorIndex, vec3 p, vec3 n, float floorReceiver, out vec3 meanLight) {
  float support;
  vec3 light = hdGIVolumeSample(floorIndex, p, n, floorReceiver, meanLight, support);
  if (floorReceiver > .5 || hdGIFloorCount < 2) return light;
  // Independent storey volumes meet in open air above a stairwell. Blend that
  // join, using the cached ceiling occupancy to exclude solid slabs and walls.
  vec2 plan = (p.xz - hdGIBounds.xy) / hdGIBounds.z;
  for (int lower = 0; lower < ${INDIRECT_MAX_FLOORS - 1}; lower++) {
    if (lower + 1 >= hdGIFloorCount) break;
    if (abs(floorIndex - float(lower)) > .1 && abs(floorIndex - float(lower + 1)) > .1) continue;
    float boundary = hdGIFloorRanges[lower + 1].x + .06;
    float width = min(.3, (hdGIFloorRanges[lower].y - hdGIFloorRanges[lower].x) / ${INDIRECT_VOLUME_HEIGHT - 1}.0);
    if (abs(p.y - boundary) >= width) continue;
    vec3 below = textureLod(hdGIMask, vec2(plan.x, (plan.y + float(lower)) / hdGIMaskSize.y), 0.0).rgb;
    vec3 above = textureLod(hdGIMask, vec2(plan.x, (plan.y + float(lower + 1)) / hdGIMaskSize.y), 0.0).rgb;
    float ceiling = mix(hdGIFloorRanges[lower].x, hdGIFloorRanges[lower].y, dot(below.gb, vec2(65280.0, 255.0)) / 65535.0);
    if (below.r < .5 || above.r < .5 || ceiling < boundary - .025) continue;
    float otherIndex = floorIndex < float(lower) + .5 ? float(lower + 1) : float(lower);
    vec3 otherMean; float otherSupport;
    vec3 other = hdGIVolumeSample(otherIndex, p, n, 0.0, otherMean, otherSupport);
    if (otherSupport < .00001) continue;
    if (support < .00001) { meanLight = otherMean; return other; }
    float weight = smoothstep(boundary - width, boundary + width, p.y);
    if (floorIndex > float(lower) + .5) weight = 1.0 - weight;
    meanLight = mix(meanLight, otherMean, weight);
    return mix(light, other, weight);
  }
  return light;
}
#endif
`

const indirectVolumeShaderUnpacked = /* glsl */ `
#ifdef HD_SUN_BOUNCE
uniform float hdSunBouncePacked;
vec4 hdGIPackedVolume(vec3 uv,float level){uv.y*=1.0-.5*hdSunBouncePacked;return textureLod(hdGIVolume,uv,level);}
vec4 hdGIPackedFloor(vec3 uv,float level){uv.y*=1.0-.5*hdSunBouncePacked;return textureLod(hdGIFloorLayer,uv,level);}
${indirectVolumeShaderBody.replaceAll('textureLod(hdGIVolume,','hdGIPackedVolume(').replaceAll('textureLod(hdGIFloorLayer,','hdGIPackedFloor(')}
#else
${indirectVolumeShaderBody}
#endif
`
export const indirectVolumeShaderFunction=/* glsl */`
#ifdef HD_LOCAL_SUN_PREVIEW
uniform float hdLocalSunVolumeScale;
vec4 hdLocalSunVolumeRead(vec3 uv,float level){uv.z*=hdLocalSunVolumeScale;return textureLod(hdGIVolume,uv,level);}
${indirectVolumeShaderUnpacked.replaceAll('textureLod(hdGIVolume,','hdLocalSunVolumeRead(')}
#else
${indirectVolumeShaderUnpacked}
#endif
`

/** Fullscreen replay needs volume sampling without geometry varyings. */
export const indirectVolumeShaderDeclarations = /* glsl */ `
${indirectContactShaderDeclarations}
uniform float hdGIUseVolume;
uniform sampler2D hdGIMask;
uniform vec4 hdGIMaskSize;
uniform int hdGIFloorCount;
uniform sampler3D hdGIVolume;
uniform sampler3D hdGIFloorLayer;
uniform vec2 hdGIFloorLayerSize;
uniform float hdGIFloorLayerReady;
uniform vec2 hdGIVolumeSize;
uniform vec3 hdGIBounds;
uniform vec2 hdGIFloorRanges[${INDIRECT_MAX_FLOORS}];
${indirectVolumeShaderFunction}
`

export const indirectLightingShaderDeclarations = /* glsl */ `
${indirectReceiverShaderDeclarations}
${indirectVisibilityShaderDeclarations}
uniform float hdGIEnabled;
uniform float hdGIDiffuseCapture;
uniform vec3 hdSkyRadianceBase;
uniform vec3 hdSkyDisplayRadianceBase,hdSkyDisplaySunIrradiance;
uniform float hdExteriorSkyFill;
${daylightSkyGLSL}
${daylightSkyIrradianceGLSL}
${exteriorSkyOcclusionGLSL}
bool hdGIExteriorFootprint(vec3 p){
  if(hdGIFloorCount<1)return false;
  vec2 plan=(p.xz-hdGIBounds.xy)/hdGIBounds.z;
  if(any(lessThan(plan,vec2(0.0)))||any(greaterThan(plan,vec2(1.0))))return true;
  for(int i=0;i<${INDIRECT_MAX_FLOORS};i++){
    if(i>=hdGIFloorCount)break;
    if(texture2D(hdGIMask,vec2(plan.x,(plan.y+float(i))/hdGIMaskSize.y)).r>.5)return false;
  }
  return true;
}
uniform float hdGIIndoorFill;
uniform float hdGIProbeStrength;
uniform float hdGIDisplayStrength;
uniform float hdGILocalReflection;
// Pack four indices per vector. A bake includes every installed lamp, while
// the display uses a smaller pool; float[128] would waste 128 uniform vectors.
uniform vec4 hdGIPointIndices[${Math.ceil(INDIRECT_MAX_LOCAL_LIGHTS / 4)}];
uniform vec4 hdGISpotIndices[${Math.ceil(INDIRECT_MAX_LOCAL_LIGHTS / 4)}];
float hdGIPointIndex(int index) {
  return index < ${INDIRECT_MAX_LOCAL_LIGHTS} ? hdGIPointIndices[index / 4][index % 4] : -1.0;
}
float hdGISpotIndex(int index) {
  return index < ${INDIRECT_MAX_LOCAL_LIGHTS} ? hdGISpotIndices[index / 4][index % 4] : -1.0;
}
uniform float hdGIUseVolume;
uniform sampler3D hdGIVolume;
uniform sampler3D hdGIFloorLayer;
uniform vec2 hdGIFloorLayerSize;
uniform float hdGIFloorLayerReady;
uniform sampler2D hdGIRed;
uniform sampler2D hdGIGreen;
uniform sampler2D hdGIBlue;
uniform vec4 hdGIGrids[${INDIRECT_MAX_FLOORS}];
uniform vec4 hdGIGrid;

float hdGIDirectVisibility(vec3 p, vec3 viewNormal, float index) {
  #ifdef HD_GI_CAPTURE_VISIBILITY
  // Cached lamp occlusion only supplies direct radiance to the GI bake.
  // Displayed direct shadows remain controlled by Light shadows.
  if (hdGICapture < .5 || hdGIEnabled < .5 || index < 0.0) return -1.0;
  vec3 n = normalize(transformNormalByInverseViewMatrix(viewNormal, viewMatrix));
  vec3 probePosition;
  return hdGIVisibility(index, p + n * .004, probePosition);
  #else
  return -1.0;
  #endif
}

${indirectVolumeShaderFunction}

`

/** Identical receiver interpolation and storey blending for the sun-disabled field. */
export const indirectSunBounceShader = /* glsl */ `
#ifdef HD_SUN_BOUNCE
uniform float hdSunBounceStrength, hdSunBounceReady;
vec4 hdGISunOffVolumeRead(vec3 uv,float level){uv.y=uv.y*.5+.5;
#ifdef HD_LOCAL_SUN_PREVIEW
return hdLocalSunVolumeRead(uv,level);
#else
return textureLod(hdGIVolume,uv,level);
#endif
}
vec4 hdGISunOffFloorRead(vec3 uv,float level){uv.y=uv.y*.5+.5;return textureLod(hdGIFloorLayer,uv,level);}
${indirectVolumeShaderBody.replaceAll('hdGIVolumeSample', 'hdGISunOffVolumeSample').replaceAll('hdGIVolumeIrradiance', 'hdGISunOffIrradiance').replaceAll('textureLod(hdGIVolume,','hdGISunOffVolumeRead(').replaceAll('textureLod(hdGIFloorLayer,','hdGISunOffFloorRead(')}
#endif
`

/** All PBR surfaces share position-dependent diffuse lighting, including instances. */
export function applyIndirectLightingShader(material: Material, uniforms: IndirectUniforms, fastFeature?: boolean) {
  ensureExteriorSkyUniforms(uniforms)
  // Prepared startup displays share live illumination uniforms, but keep the
  // shader feature they compiled until the live scene's replacement is ready.
  const fastEnabled = () => fastFeature ?? !!uniforms.hdFastFeature.value
  const receiverRefinement=requestedIndirectContacts()
  materialUniforms.set(material, uniforms)
  const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey
  // Non-wall geometry shares these programs and has no receiver attribute.
  // Explicit defaults also keep those draws independent of previous VAOs.
  const attributes = material as Material & { defaultAttributeValues?: Record<string, number[]> }
  attributes.defaultAttributeValues = { ...attributes.defaultAttributeValues, hdGIReceiverOffset: [0, 0, 0], hdGIReceiverMaxBias:[1e6,1e6],
    hdGIContactLink:[0,0],
    hdGIReceiverLinearNormal:[0],
    hdGICorner0: [0, 0, 0], hdGICorner1: [0, 0, 0], hdGIWallMount0: [0, 0, 0, 0], hdGIWallMount1: [0, 0, 0, 0] }
  const localReflection = { value: 0 }
  const whiteSurface = { value: isLightingGlazing(material) ? 0 : 1 }
  localReflectionUniforms.set(material, localReflection)
  const hook: Material['onBeforeCompile'] = (shader, renderer) => {
    compile.call(material, shader, renderer)
    shader.uniforms.hdWhiteSurface = whiteSurface
    Object.assign(shader.uniforms, uniforms)
    shader.uniforms.hdGILocalReflection = localReflection
    if (shader.fragmentShader.includes('float hdGIFloor(')) return
    if(uniforms.hdGIContactMode.value>.5){shader.fragmentShader='#define HD_GI_CONTACT_RECEIVERS\n'+shader.fragmentShader;shader.vertexShader='#define HD_GI_CONTACT_RECEIVERS\n'+shader.vertexShader}
    shader.fragmentShader = (uniforms.hdExteriorSkyFeature.value>.5&&exteriorSkyMaterials.has(material)?'#define HD_EXTERIOR_SKY_OCCLUSION\n':'') + (uniforms.hdLocalSunFeature.value>.5?'#define HD_LOCAL_SUN_PREVIEW\n':'') + (uniforms.hdSunBounceFeature.value>.5?'#define HD_SUN_BOUNCE\n':'') + (uniforms.hdGISHOrder.value===2?'#define HD_GI_L2\n':'') + (lightingDiagnosticsEnabled?'#define HD_LIGHTING_DIAGNOSTICS\n':'') + (fastEnabled() ? '#define HD_FAST_GI\n' : '') + '#define HD_INDIRECT_VISIBILITY\n' + shader.fragmentShader
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 hdGIWorldPosition;
        ${receiverRefinement?'attribute float hdGIReceiverLinearNormal;':''}
        #ifndef HD_RECEIVER_ATTRIBUTE
        #define HD_RECEIVER_ATTRIBUTE
        attribute vec3 hdGIReceiverOffset;
        #endif
        varying vec3 hdGIReceiverWorldOffset;
        attribute vec2 hdGIReceiverMaxBias;
        varying vec2 hdGIReceiverBiasLimit;
        #ifdef HD_GI_CONTACT_RECEIVERS
        attribute vec2 hdGIContactLink;
        flat varying vec2 hdGIContactLinkValue;
        #endif
        attribute vec3 hdGICorner0;
        attribute vec3 hdGICorner1;
        varying vec4 hdGICornerPlane0;
        varying vec4 hdGICornerPlane1;
        attribute vec4 hdGIWallMount0;
        attribute vec4 hdGIWallMount1;
        varying vec4 hdGIWallMountPlane0;
        varying vec4 hdGIWallMountPlane1;
        vec4 hdGIWorldMountPlane(vec4 plane, mat4 transform) {
          if (dot(plane.xyz, plane.xyz) < .5) return vec4(0.0);
          vec3 n = normalize(transpose(inverse(mat3(transform))) * plane.xyz);
          vec3 p = (transform * vec4(plane.xyz * plane.w, 1.0)).xyz;
          return vec4(n, dot(n, p));
        }
        vec4 hdGIWorldCorner(vec3 plane, mat4 transform) {
          if (dot(plane.xy, plane.xy) < .5) return vec4(0.0);
          vec3 n = normalize(transpose(inverse(mat3(transform))) * vec3(plane.x, 0.0, plane.y));
          vec3 point = (transform * vec4(plane.x * plane.z, 0.0, plane.y * plane.z, 1.0)).xyz;
          return vec4(n, dot(n, point));
        }`)
      .replace('#include <normal_vertex>',`#include <normal_vertex>
        ${receiverRefinement?'#ifndef FLAT_SHADED\nif(hdGIReceiverLinearNormal>.5)vNormal=transformedNormal;\n#endif':''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 hdGIWorld = vec4(transformed, 1.0);
        vec4 hdGIReceiver = vec4(hdGIReceiverOffset, 0.0);
        mat4 hdGITransform = modelMatrix;
        #ifdef USE_BATCHING
          hdGIWorld = batchingMatrix * hdGIWorld;
          hdGIReceiver = batchingMatrix * hdGIReceiver;
          hdGITransform = hdGITransform * batchingMatrix;
        #endif
        #ifdef USE_INSTANCING
          hdGIWorld = instanceMatrix * hdGIWorld;
          hdGIReceiver = instanceMatrix * hdGIReceiver;
          hdGITransform = hdGITransform * instanceMatrix;
        #endif
        hdGIWorldPosition = (modelMatrix * hdGIWorld).xyz;
        hdGIReceiverWorldOffset = (modelMatrix * hdGIReceiver).xyz;
        hdGIReceiverBiasLimit=hdGIReceiverMaxBias;
        #ifdef HD_GI_CONTACT_RECEIVERS
        hdGIContactLinkValue=hdGIContactLink;
        #endif
        hdGICornerPlane0 = hdGIWorldCorner(hdGICorner0, hdGITransform);
        hdGICornerPlane1 = hdGIWorldCorner(hdGICorner1, hdGITransform);
        hdGIWallMountPlane0 = hdGIWorldMountPlane(hdGIWallMount0, hdGITransform);
        hdGIWallMountPlane1 = hdGIWorldMountPlane(hdGIWallMount1, hdGITransform);`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform float hdWhiteModel, hdWhiteSurface;\n${indirectLightingShaderDeclarations}\n${indirectSunBounceShader}\n${localSunPreviewGLSL}\n${fastGIShader}\n${lightingDiagnosticsEnabled?lightingDiagnosticGLSL:''}`)
      // Display-only clay view: retain geometry, alpha coverage and lighting.
      // Captures still use authored materials, and glazing stays transparent.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if(hdGICapture<.5 && hdWhiteModel>.5 && hdWhiteSurface>.5) normal=nonPerturbedNormal;`)
      .replace('#include <lights_physical_fragment>', `
        if(hdGICapture<.5 && hdWhiteModel>.5 && hdWhiteSurface>.5){
          diffuseColor.rgb=vec3(.8);roughnessFactor=1.0;metalnessFactor=0.0;totalEmissiveRadiance=vec3(0.0);
        }
        #include <lights_physical_fragment>
        if(hdGICapture<.5 && hdWhiteModel>.5 && hdWhiteSurface>.5){
          material.specularColorBlended=vec3(0.0);
          #ifdef USE_CLEARCOAT
            material.clearcoat=0.0;
          #endif
          #ifdef USE_SHEEN
            material.sheenColor=vec3(0.0);
          #endif
        }`)
      .replace('#include <lights_fragment_end>', `
        #ifdef HD_LIGHTING_DIAGNOSTICS
          if(hdGICapture<.5&&hdLightingDiagnostic>5.5&&hdLightingDiagnostic<6.5){material.diffuseColor=vec3(.8);material.diffuseContribution=vec3(.8);material.roughness=1.0;material.specularColorBlended=vec3(0.0);}
        #endif
        #if defined(RE_IndirectDiffuse) && defined(RE_IndirectSpecular)
        if (hdGIEnabled > .5) {
          vec3 hdGINormal = normalize(transformNormalByInverseViewMatrix(geometryNormal, viewMatrix));
          vec3 hdGISurfaceNormal = normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal, viewMatrix));
          vec3 hdGIPosition; float hdGIFloorReceiver;
          float hdGIId = hdGIReceiver(hdGIWorldPosition, hdGIReceiverWorldOffset, hdGISurfaceNormal, hdGIFloorLayerReady,
            hdGIPosition, hdGIFloorReceiver);
          // Environment lighting supplies reflections; scene probes supply indoor diffuse.
          iblIrradiance = vec3(0.0);
          bool hdGIHasReceiver = hdGIId >= 0.0;
          #ifdef HD_LOCAL_SUN_PREVIEW
          vec4 hdLocalSunValue=vec4(0.);
          if(hdGICapture<.5&&hdLocalSunReady>.5&&hdLocalSunDisplay>.5)hdLocalSunValue=hdLocalSunIrradiance(hdGISurfaceNormal,hdGIWorldPosition);
          hdGIHasReceiver=hdGIHasReceiver||hdLocalSunValue.a>.5;
          #endif
          #if defined(HD_FAST_GI) && !defined(HD_GI_DIRECT_CAPTURE)
            hdGIHasReceiver = hdGIHasReceiver || (hdGICapture < .5 && hdFastReady > .5 &&
              hdFastInside((hdGIWorldPosition - hdFastMin) / hdFastSize * hdFastN));
          #endif
          if (hdGIHasReceiver) {
            vec3 hdGIMean;
            #ifdef HD_GI_DIRECT_CAPTURE
              vec3 hdGILight = vec3(0.0); hdGIMean = vec3(0.0);
            #else
              vec3 hdGILight = vec3(0.0); hdGIMean = vec3(0.0);
              #ifdef HD_GI_CONTACT_RECEIVERS
              if(hdGIReceiverSafetyReady>.5&&hdGIContactReceiver()>.5)hdGILight=hdGIContactIrradiance(hdGIContactReceiver(),hdGINormal,hdGIMean);else
              #endif
              if (hdGIId >= 0.0) hdGILight = hdGIVolumeIrradiance(hdGIId, hdGIPosition, hdGINormal, hdGIFloorReceiver, hdGIMean);
              #ifdef HD_SUN_BOUNCE
              if (hdGICapture < .5 && hdSunBounceReady > .5 && hdSunBounceStrength != 1.0 && hdGIId >= 0.0) {
                vec3 unusedMean;
                vec3 sunOff = hdGISunOffIrradiance(hdGIId, hdGIPosition, hdGINormal, hdGIFloorReceiver, unusedMean);
                // Signed difference until final shading. Preserve the production
                // mean for specular visibility; this control changes diffuse only.
                hdGILight = max(sunOff + hdSunBounceStrength * (hdGILight - sunOff), vec3(0.0));
              }
              #endif
              if (hdGICapture < .5) hdGILight *= hdGIProbeStrength * hdGIDisplayStrength;
            #endif
            #if defined(HD_FAST_GI) && !defined(HD_GI_DIRECT_CAPTURE)
              if (hdGICapture < .5 && hdFastReady > .5 && hdFastWeight > .0001) {
                hdGILight = hdFastIrradiance(hdGIWorldPosition + hdGIReceiverWorldOffset, hdGINormal, hdGISurfaceNormal, hdGILight);
                hdGIMean = hdGILight;
              }
            #endif
            #ifdef HD_LOCAL_SUN_PREVIEW
            if(hdGICapture<.5&&hdLocalSunReady>.5){
              if(hdLocalSunValue.a>.5){
                if(hdLocalSunCombined<.5)hdGILight=hdLocalSunValue.rgb;
                #ifdef HD_SUN_BOUNCE
                else if(hdSunBounceReady>.5&&hdSunBouncePacked>.5&&hdGIId>=0.){
                  vec3 nonSolarMean;
                  vec3 nonSolar=hdGISunOffIrradiance(hdGIId,hdGIPosition,hdGINormal,hdGIFloorReceiver,nonSolarMean);
                  hdGILight=nonSolar*hdGIProbeStrength*hdGIDisplayStrength+hdLocalSunValue.rgb;
                }
                #endif
              }
            }
            #endif
            irradiance = hdGICapture > .5 && hdGICapture < 1.5 ? vec3(0.0)
              : hdGILight + vec3(hdGICapture > .5 ? 0.0 : hdGIIndoorFill);
            // The studio reflection fallback must not illuminate enclosed interiors.
            float hdGIReflectionVisibility = hdGILocalReflection > .5 ? 1.0
              : clamp(dot(hdGIMean + vec3(hdGICapture > .5 ? 0.0 : hdGIIndoorFill), vec3(.2126, .7152, .0722)) / PI, 0.0, 1.0);
            if (hdGICapture < .5) hdGIReflectionVisibility *= hdGIDisplayStrength;
            radiance *= hdGIReflectionVisibility;
            clearcoatRadiance *= hdGIReflectionVisibility;
          }
          else if(hdGIExteriorFootprint(hdGIWorldPosition) ||
            (hdGIFloorCount > 0 && hdGISurfaceNormal.y >= -.01)){
            // hdGIReceiver already classified the normal-offset point as
            // outside usable indoor air. A second plan-only mask test on the
            // original point disagrees at facade edges and excludes roofs
            // above rooms. Captures need the same exterior sky response as
            // display, or the immutable surface cache omits roof-reflected sky.
            // Indoor receivers and roof undersides retain their existing paths.
            vec3 sky=hdGICapture>.5?hdSkyDiffuseIrradiance(hdGINormal,hdSkyRadianceBase):
              hdSkyDiffuseIrradiance(hdGINormal,hdSkyDisplayRadianceBase,hdSkyDisplaySunIrradiance) * hdExteriorSkyFill;
            irradiance=hdGICapture>.5?sky:irradiance+sky;
            #ifdef HD_EXTERIOR_SKY_OCCLUSION
            // Display-only experiment: do not bake this attenuation back into
            // probe transport or darken direct sunlight / interior GI.
            if (hdGICapture < .5 && hdExteriorSkyStrength > 0.0) {
              vec3 skyPositive, skyNegative;
              hdExteriorSkySample(hdGIWorldPosition, hdGISurfaceNormal, skyPositive, skyNegative);
              irradiance *= hdExteriorSkyVisibility(skyPositive, skyNegative, hdGISurfaceNormal);
              // Reuse the field for broad environment-reflection visibility.
              // Rough reflections tend towards the normal-facing hemisphere;
              // satin surfaces also follow the reflected viewing direction.
              // Local captured environments already contain their occluders.
              if (hdGILocalReflection < .5) {
                vec3 reflected = reflect(-normalize(cameraPosition - hdGIWorldPosition), hdGINormal);
                vec3 reflectionDirection = normalize(mix(reflected, hdGINormal, material.roughness * material.roughness));
                float reflectionVisibility = hdExteriorSkyVisibility(skyPositive, skyNegative, reflectionDirection);
                radiance *= reflectionVisibility;
                clearcoatRadiance *= reflectionVisibility;
              }
            }
            #endif
          }
          // Diffuse capture should not bake a view-dependent specular highlight.
          if (hdGIDiffuseCapture > .5) { radiance = vec3(0.0); clearcoatRadiance = vec3(0.0); }
        }
        #endif
        #include <lights_fragment_end>`)
      .replace('#include <opaque_fragment>',`if(hdGIDiffuseCapture>.5)outgoingLight=totalDiffuse+totalEmissiveRadiance;\n${lightingDiagnosticsEnabled?lightingDiagnosticOutput:''}\n#include <opaque_fragment>`)
    if(lightingDiagnosticsEnabled){
      shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>',`if(!(hdGICapture<.5&&hdLightingDiagnostic>3.5&&hdLightingDiagnostic<5.5)){\n#include <tonemapping_fragment>\n}`)
        .replace('#include <colorspace_fragment>',`if(!(hdGICapture<.5&&hdLightingDiagnostic>3.5&&hdLightingDiagnostic<4.5)){\n#include <colorspace_fragment>\n}`)
    }
  }
  const marker = /:house-designer-indirect-grid-l1-v\d+-(capture|display)(-fast)?(-diagnostics)?(-contacts)?(-sunbounce)?(-local-sun)?(-exterior-sky(?:-eaves\d+)?)?/g
  const transformKey = cacheShaderKeyTransform((original, suffix) =>
    original.match(marker) ? original.replace(marker, suffix) : original + suffix)
  const key = () => {
    const original = cacheKey.call(material)
    // Clones inherit this hook even when another controller follows it.
    // Preserve its position in the key so both materials reuse one program.
    const suffix = ':house-designer-indirect-grid-l' + uniforms.hdGISHOrder.value + '-v44-display' + (fastEnabled() ? '-fast' : '') + (lightingDiagnosticsEnabled?'-diagnostics':'')+(uniforms.hdGIContactMode.value>.5?'-contacts':'')+(uniforms.hdSunBounceFeature.value>.5?'-sunbounce':'')+(uniforms.hdLocalSunFeature.value>.5?'-local-sun':'')+(uniforms.hdExteriorSkyFeature.value>.5&&exteriorSkyMaterials.has(material)?'-exterior-sky-eaves2':'')
    return transformKey(original, suffix)
  }
  material.onBeforeCompile = hook; material.customProgramCacheKey = key; material.needsUpdate = true
  return () => {
    if (materialUniforms.get(material) === uniforms) materialUniforms.delete(material)
    localReflectionUniforms.delete(material)
    if (material.onBeforeCompile === hook) material.onBeforeCompile = compile
    if (material.customProgramCacheKey === key) material.customProgramCacheKey = cacheKey
    material.needsUpdate = true
  }
}
