import { Color, Vector3, type Material } from 'three'

/** The editor ground is a display backdrop. Keep its cast shadows legible
 * under the bright sky fill without changing illumination on the building. */
export function withGroundShadowContrast(retention={value:.55}, skyTint={value:new Vector3(1,1,1)}, displayTint='#ffffff'): Pick<Material, 'onBeforeCompile' | 'customProgramCacheKey'> {
  const groundDisplayTint = { value: new Color(displayTint) }
  return {
    customProgramCacheKey: () => 'house-designer-ground-shadow-v4',
    onBeforeCompile(shader) {
      shader.uniforms.hdGroundShadowRetention=retention
      shader.uniforms.hdGroundSkyTint=skyTint
      shader.uniforms.hdGroundDisplayTint=groundDisplayTint
      shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>
uniform float hdGroundShadowRetention;
uniform vec3 hdGroundSkyTint;
uniform vec3 hdGroundDisplayTint;
float hdGroundSunVisibility() {
  float visibility = 1.0;
  #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
  #pragma unroll_loop_start
  for (int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i++) {
    if (receiveShadow && dot(directionalLights[i].color, vec3(1.0)) > .0001) {
      DirectionalLightShadow light = directionalLightShadows[i];
      visibility *= getShadow(directionalShadowMap[i], light.shadowMapSize,
        light.shadowIntensity, light.shadowBias, light.shadowRadius, vDirectionalShadowCoord[i]);
    }
  }
  #pragma unroll_loop_end
  #endif
  return visibility;
}`)
      // Tint only this exterior backdrop's ambient fill, never the room lights.
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>',
        'irradiance *= hdGroundSkyTint;\n#include <lights_fragment_end>')
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `
reflectedLight.indirectDiffuse *= mix(hdGroundShadowRetention, 1.0, hdGroundSunVisibility());
#include <aomap_fragment>`)
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
#ifndef HD_GROUND_CAPTURE
  outgoingLight *= hdGroundDisplayTint;
#endif
#include <opaque_fragment>`)
    },
  }
}
