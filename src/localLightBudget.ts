export const MAX_REALTIME_LOCAL_LIGHTS = 11

/** Uniforms limit direct lights; only shadow maps consume a texture per lamp. */
export function getLocalLightLimits(maxFragmentUniforms: number, maxTextures: number) {
  const lights = maxFragmentUniforms >= 1024 ? MAX_REALTIME_LOCAL_LIGHTS : maxFragmentUniforms >= 512 ? 8 : 4
  // Reserve material maps, room masks/probes, environment and sun shadow.
  return { lights, shadows: Math.min(lights, Math.max(1, maxTextures - 14)) }
}
