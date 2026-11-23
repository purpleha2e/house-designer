/** WebGL readback is bottom-up; OIDN's CPU image contract is top-down RGBA. */
export function flipImageRows(input: Float32Array, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || input.length !== width * height * 4) {
    throw Error('Invalid denoising image dimensions')
  }
  const output = new Float32Array(input.length), stride = width * 4
  for (let y = 0; y < height; y++) output.set(input.subarray(y * stride, (y + 1) * stride), (height - y - 1) * stride)
  return output
}
/** Suppress only extreme, isolated HDR spikes before the neural filter spreads
 * them. Neighbours must agree on surface colour/normal. This is a biased final
 * image filter, never applied to the retained raw transport/reference data. */
export function filterIsolatedFireflies(colour: Float32Array, albedo: Float32Array, normal: Float32Array, width: number, height: number) {
  if (colour.length !== width * height * 4 || albedo.length !== colour.length || normal.length !== colour.length) throw Error('Invalid denoising buffers')
  const output = colour.slice()
  const luminance = (i: number) => .2126 * colour[i] + .7152 * colour[i + 1] + .0722 * colour[i + 2]
  let changedPixels = 0
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = (y * width + x) * 4, value = luminance(i)
    if (value <= 16) continue
    const neighbours: number[] = []
    let maximum = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const j = ((y + dy) * width + x + dx) * 4
      let normalDifference = 0, colourDifference = 0
      for (let c = 0; c < 3; c++) {
        normalDifference += (normal[i + c] - normal[j + c]) ** 2
        colourDifference = Math.max(colourDifference, Math.abs(albedo[i + c] - albedo[j + c]))
      }
      if (normalDifference > .01 || colourDifference > .15) continue
      neighbours.push(j); maximum = Math.max(maximum, luminance(j))
    }
    if (neighbours.length < 5 || value <= maximum * 16) continue
    neighbours.sort((a, b) => luminance(a) - luminance(b))
    const median = neighbours[Math.floor(neighbours.length / 2)]
    for (let c = 0; c < 3; c++) output[i + c] = colour[median + c]
    changedPixels++
  }
  return { values: output, changedPixels }
}

