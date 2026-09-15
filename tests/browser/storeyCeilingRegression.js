// Run on roofWallRegression.html after initial geometry preparation.
export async function checkStoreyCeilings() {
  const wait = () => new Promise(resolve => setTimeout(resolve, 350))
  const original = structuredClone(window.regressionFloors)
  const top = [...original].sort((a,b)=>b.elevation-a.elevation)[0]
  const scene = window.roofWallScene().scene
  const ceilings = () => {
    const heights=[]
    scene.traverse(o=>{if(o.userData.houseDesignerRole==='room-ceiling-finish')heights.push(o.position.y)})
    return heights
  }
  const topCeilings = () => ceilings().filter(y=>Math.abs(y-(top.elevation+top.roomHeight-0.02))<1e-5).length
  const initial=topCeilings(), lower=ceilings().length-initial
  if(!initial)throw new Error('Horizontal top-storey ceilings are missing')
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
    const restarts=window.houseDesignerEngineLog.entries.filter(e=>e.index>logStart&&e.type==='level-preparation-start').length
    if(restarts)throw new Error('A ceiling preference unnecessarily rebuilt wall geometry')
    return {passed:true,topCeilings:initial,intermediateCeilings:lower,levelRestarts:restarts}
  } finally { window.updateRegressionFloors(original) }
}
