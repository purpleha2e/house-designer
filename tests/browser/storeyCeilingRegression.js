// Run on roofWallRegression.html after initial geometry preparation.
export async function checkStoreyCeilings() {
  const wait = () => new Promise(resolve => setTimeout(resolve, 350))
  const original = structuredClone(window.regressionFloors)
  const top = [...original].sort((a,b)=>b.elevation-a.elevation)[0]
  const state = window.roofWallScene(), scene = state.scene
  const ceilings = () => {
    const heights=[]
    scene.traverse(o=>{if(o.userData.houseDesignerRole==='room-ceiling-finish')heights.push(o.position.y)})
    return heights
  }
  const topCeilings = () => ceilings().filter(y=>Math.abs(y-(top.elevation+top.roomHeight-0.02))<1e-5).length
  const initial=topCeilings(), lower=ceilings().length-initial
  if(!initial)throw new Error('Horizontal top-storey ceilings are missing')
  const camera = { position: state.camera.position.clone(), quaternion: state.camera.quaternion.clone() }
  state.camera.position.set(-20, top.elevation + top.roomHeight - 0.5, 25)
  state.camera.updateMatrixWorld(); state.invalidate(); await wait()
  let edgeOnOutside = 0, visibleFloorsBelow = 0, outsideSlabCaps = 0
  scene.traverse(o=>{
    if(['room-ceiling-finish','room-floor-finish','room-floor-base'].includes(o.userData.houseDesignerRole)&&o.visible){
      const distance=Math.abs(o.position.y-state.camera.position.y)
      if(distance<=0.05)edgeOnOutside++
      if(['room-floor-finish','room-floor-base'].includes(o.userData.houseDesignerRole)&&o.position.y<state.camera.position.y-0.05)visibleFloorsBelow++
    }
    if(o.userData.houseDesignerRole==='ceiling-slab-solid'&&o.material?.[0]?.visible)outsideSlabCaps++
  })
  if(edgeOnOutside)throw new Error(`Interior panels remained visible edge-on from outside: ${edgeOnOutside}`)
  if(!visibleFloorsBelow)throw new Error('Floors below an outside camera disappeared through the openings')
  if(!outsideSlabCaps)throw new Error('Intermediate slab top caps disappeared through the openings')
  state.camera.position.copy(camera.position); state.camera.quaternion.copy(camera.quaternion)
  state.camera.updateMatrixWorld(); state.invalidate(); await wait()
  const logStart=window.houseDesignerEngineLog.entries.at(-1)?.index??0
  try {
    window.updateRegressionFloors(floors=>floors.map(f=>f.id===top.id?{...f,ceilingMode:'open'}:f))
    await wait()
    if(topCeilings()!==0||ceilings().length!==lower)throw new Error('Opening the roof ceiling changed an intermediate ceiling')
    const assemblies=window.houseDesignerWallRenderDebug.ceilingSlabs()
    if(assemblies.some(a=>a.floorId===top.id))throw new Error('A slab was generated above the top storey')
    window.updateRegressionFloors(original)
    await wait()
    if(topCeilings()!==initial)throw new Error('Horizontal ceilings were not restored')
    // Remount the ceiling while the camera remains on its hidden side. The
    // visibility controller must initialise new panels even on an idle camera.
    state.camera.position.set(-20, top.elevation + top.roomHeight + 1, 25)
    state.camera.updateMatrixWorld(); state.invalidate(); await wait()
    window.updateRegressionFloors(floors=>floors.map(f=>f.id===top.id?{...f,ceilingMode:'open'}:f))
    await wait()
    window.updateRegressionFloors(original)
    await wait()
    let visibleRestoredCeilings=0
    scene.traverse(o=>{
      if(o.userData.houseDesignerRole==='room-ceiling-finish'&&o.visible)visibleRestoredCeilings++
    })
    if(visibleRestoredCeilings)throw new Error(`Restored ceilings ignored the stationary camera: ${visibleRestoredCeilings}`)
    const restarts=window.houseDesignerEngineLog.entries.filter(e=>e.index>logStart&&e.type==='level-preparation-start').length
    if(restarts)throw new Error('A ceiling preference unnecessarily rebuilt wall geometry')
    return {passed:true,topCeilings:initial,intermediateCeilings:lower,visibleFloorsBelow,outsideSlabCaps,levelRestarts:restarts}
  } finally {
    state.camera.position.copy(camera.position); state.camera.quaternion.copy(camera.quaternion)
    state.camera.updateMatrixWorld(); state.invalidate()
    window.updateRegressionFloors(original)
  }
}
