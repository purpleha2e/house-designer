// Run in the main editor with red_house_3 loaded, including its model catalog.
// Check the exterior plane itself: a ray reaching the interior behind a hole
// must fail even if that interior happens to carry a matching material.
export async function checkLoadedEditorJunctions() {
  const { _roots } = await import('@react-three/fiber')
  const { Raycaster, Vector3 } = await import('three')
  const state = [..._roots.values()][0]?.store.getState()
  if (!state) throw new Error('The editor scene is not ready')
  const meshes = []
  state.scene.traverse(object => {
    if (object.userData.houseDesignerRole === 'wall-engine-render') meshes.push(object)
  })
  const samples = []
  for (const z of [2.4, 2.5, 2.6, 6.6658, 6.7658, 6.8658]) {
    for (const y of [4, 4.3, 4.6, 4.9]) {
      const hit = new Raycaster(new Vector3(2, y, z), new Vector3(-1, 0, 0))
        .intersectObjects(meshes, false)[0]
      if (!hit || Math.abs(hit.point.x - 1.35) > 0.001) {
        throw new Error(`Exterior junction has a hole at y=${y}, z=${z}; hit x=${hit?.point.x}`)
      }
      const material = hit.object.material[hit.face.materialIndex]
      if (!material.map) throw new Error(`Exterior junction has no brick finish at y=${y}, z=${z}`)
      samples.push({ y, z, x: hit.point.x, texture: material.map.uuid })
    }
  }
  if (new Set(samples.map(sample => sample.texture)).size !== 1) throw new Error('Junction finishes differ')
  return { passed: true, exteriorSamples: samples.length }
}
