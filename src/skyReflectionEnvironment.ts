import { DataTexture, EquirectangularReflectionMapping, FloatType, LinearFilter, LinearSRGBColorSpace, RGBAFormat } from 'three'

/** Offline source for the building's fallback reflections. The directional sun
 * already supplies its own specular light; this contains only a neutral sky
 * and darker ground, with no studio lamps or second, fixed sun. */
export function createSkyReflectionEnvironment(width = 256, height = 128) {
  const pixels = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    // Equirectangular texture V=1 faces up. Radiance is in linear light and
    // stays comparable to the scene's ambient budget after environment gain.
    const up = Math.sin(((y + .5) / height - .5) * Math.PI)
    const radiance = .04 + .31 * (.5 + .5 * up)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      pixels[i] = pixels[i + 1] = pixels[i + 2] = radiance
      pixels[i + 3] = 1
    }
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat, FloatType)
  texture.mapping = EquirectangularReflectionMapping
  texture.colorSpace = LinearSRGBColorSpace
  texture.minFilter = texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}
