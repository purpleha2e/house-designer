import type { ShaderMaterial, Texture } from 'three'

/** Cosine-weighted surface transport. The result is irradiance / pi, independent
 * of the viewing camera, and retains the reference integrator after launch.
 * Keep this version-checked adapter small: three-gpu-pathtracer is pinned. */
export function configurePreparedCamera(material: ShaderMaterial, positions: Texture, normals: Texture) {
  const marker = 'Ray ray = getCameraRay();'
  if (!material.fragmentShader.includes(marker)) throw Error('The reference renderer changed its camera interface; surface preparation is unavailable.')
  // Two receiver samplers must fit WebGL2's guaranteed 16-unit limit. PCG
  // needs no random-number textures, unlike the reference's stratified mode.
  material.defines.RANDOM_TYPE = 0
  material.uniforms.preparedPositions = { value: positions }
  material.uniforms.preparedNormals = { value: normals }
  material.fragmentShader = 'uniform sampler2D preparedPositions,preparedNormals;\n' + material.fragmentShader.replace(marker, `
    vec2 receiverUV=gl_FragCoord.xy/resolution;
    vec4 receiver=texture2D(preparedPositions,receiverUV);
    if(receiver.a<.5){gl_FragColor=vec4(0.);return;}
    vec3 n=normalize(texture2D(preparedNormals,receiverUV).xyz);
    vec2 u=rand2(0);float phi=6.28318530718*u.x,radius=sqrt(u.y);
    vec3 t=normalize(cross(abs(n.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.),n));
    Ray ray;ray.origin=receiver.xyz+n*.012;
    ray.direction=normalize(t*(cos(phi)*radius)+cross(n,t)*(sin(phi)*radius)+n*sqrt(1.-u.y));
  `)
  material.needsUpdate = true
}
