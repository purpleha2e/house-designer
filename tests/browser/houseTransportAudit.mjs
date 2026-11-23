// Offline diagnostic only: independent multi-bounce paths through the captured
// scene, without reading its cached indirect lighting or changing exposure.
// Run in the house lab tab. Uses the captured material atlas, so this checks
// geometry/transport independently, but is not a calibrated daylight reference.
export async function houseTransportAudit(points, { sampleCount = 32768, detailed = false,
  ignoreCards = [], reflectBackFaces = false } = {}) {
  if (!Number.isInteger(sampleCount) || sampleCount < 1) throw Error('Positive sampleCount required')
  const ignored = new Set(ignoreCards)
  const { BufferGeometry, BufferAttribute, DoubleSide, Ray, Triangle, Vector3 } = await import('/node_modules/three/build/three.module.js')
  const { MeshBVH } = await import('/node_modules/three-mesh-bvh/src/index.js')
  const lab = window.houseLightingLab
  if (lab.uniforms.activeLightCount.value || lab.uniforms.sunColour.value.lengthSq())
    throw Error('This audit supports daylight with lamps and direct sun off')
  const data = detailed ? {...lab.data,...lab.data.display} : lab.data, w = data.width, h = data.height
  const sky = lab.uniforms.skyColour.value.toArray(), daylight = lab.uniforms.daylightEnabled.value
  const finish = new Float32Array(w * h * 4)
  await lab.renderer.readRenderTargetPixelsAsync(lab.gbuffer, 0, 0, w, h, finish, undefined, 2)
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(data.position, 3))
  const tree = detailed ? new MeshBVH(geometry) : MeshBVH.deserialize(data.tree, geometry), ray = new Ray(), normal = new Vector3(), tangent = new Vector3(), bitangent = new Vector3()
  const triangle = new Triangle(), bary = new Vector3(), uv = [0, 0], texel = [0, 0, 0, 0]
  let seed = 123456789
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + .5) / 4294967296 }
  const sampleFinish = hit => {
    const ids = [0, 1, 2].map(v => geometry.index.getX(hit.faceIndex * 3 + v))
    triangle.a.fromArray(data.position, ids[0] * 3); triangle.b.fromArray(data.position, ids[1] * 3); triangle.c.fromArray(data.position, ids[2] * 3)
    triangle.getBarycoord(hit.point, bary); uv.fill(0); texel.fill(0)
    ids.forEach((id, v) => { for (let axis = 0; axis < 2; axis++) uv[axis] += data.chart[id * 2 + axis] * bary.getComponent(v) })
    const x = Math.floor(uv[0] - .5), y = Math.floor(uv[1] - .5), fx = uv[0] - .5 - x, fy = uv[1] - .5 - y
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy), at = ((y + dy) * w + x + dx) * 4
      for (let channel = 0; channel < 4; channel++) texel[channel] += finish[at + channel] * weight
    }
    for (let channel = 0; channel < 3; channel++) texel[channel] /= Math.max(Math.abs(texel[3]), .001)
    triangle.getNormal(normal)
    hitCard = Math.floor(uv[0] / 16) + Math.floor(uv[1] / 16) * 32
  }
  const results = []
  let counts, cardCounts, sourceEnergy, hitCard
  const record = (kind, card = -1) => {
    counts[kind] = (counts[kind] ?? 0) + 1
    if (card >= 0) { const key = card + ':' + kind; cardCounts[key] = (cardCounts[key] ?? 0) + 1 }
  }
  for (const point of points) {
    if (!point) { results.push(null); continue }
    counts={};cardCounts={};sourceEnergy={};const sum = [0, 0, 0], square = [0, 0, 0]
    for (let sample = 0; sample < sampleCount; sample++) {
      ray.origin.fromArray(point.point); normal.fromArray(point.normal)
      const throughput = [1, 1, 1], value = [0, 0, 0]
      for (let bounce = 0; bounce < 32; bounce++) {
        ray.origin.addScaledVector(normal, .012)
        tangent.crossVectors(Math.abs(normal.y) < .9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0), normal).normalize()
        bitangent.crossVectors(normal, tangent)
        const a = random(), phi = random() * Math.PI * 2
        ray.direction.copy(tangent).multiplyScalar(Math.sqrt(a) * Math.cos(phi)).addScaledVector(bitangent, Math.sqrt(a) * Math.sin(phi)).addScaledVector(normal, Math.sqrt(1 - a))
        let hit = tree.raycastFirst(ray, DoubleSide);
        if (ignored.size) for (let skip = 0; hit && skip < 64; skip++) {
          sampleFinish(hit)
          if (!ignored.has(hitCard)) break
          ray.origin.copy(hit.point).addScaledVector(ray.direction,.0001);hit=tree.raycastFirst(ray,DoubleSide);
        }
        if (!hit) {record('sky'); for (let c = 0; c < 3; c++) value[c] = throughput[c] * sky[c]; break }
        sampleFinish(hit)
        if (texel[3] < 0) {record('window',hitCard);record('depth'+bounce);const card=data.cards[hitCard];const key=card.centre.map(x=>Math.round(x*10)/10).join(',');const energy=sourceEnergy[key]??=[0,0,0];for(let c=0;c<3;c++)energy[c]+=throughput[c]*texel[c]*daylight/sampleCount; for (let c = 0; c < 3; c++) value[c] = throughput[c] * texel[c] * daylight; break }
        if (normal.dot(ray.direction) >= 0) {record('back',hitCard);if(!reflectBackFaces)break;normal.negate();}
        record('hit',hitCard);if(texel[3]<.01)record('empty',hitCard);
 for (let c = 0; c < 3; c++) throughput[c] *= Math.min(1, Math.max(0, texel[c]))
        if (bounce >= 3) {
          const survive = Math.max(...throughput)
          if (random() >= survive) break
          for (let c = 0; c < 3; c++) throughput[c] /= survive
        }
        ray.origin.copy(hit.point)
      }
      for (let c = 0; c < 3; c++) { sum[c] += value[c]; square[c] += value[c] ** 2 }
      if (sample % 1024 === 0) await new Promise(r => setTimeout(r, 0))
    }
    results.push({ sourceEnergy,counts, cards:Object.entries(cardCounts).sort((a,b)=>b[1]-a[1]).slice(0,50).map(([key,count])=>({key,count,name:data.cards[Number(key.split(":" )[0])].name})),point: point.point, rgb: sum.map(v => v / sampleCount), standardError: square.map((v, c) => Math.sqrt(Math.max(0, v / sampleCount - (sum[c] / sampleCount) ** 2) / sampleCount)) })
  }
  geometry.dispose(); return results
}
