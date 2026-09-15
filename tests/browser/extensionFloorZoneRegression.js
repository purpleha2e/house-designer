// Run on roofWallRegression.html?materials (red_house_3).
export async function checkExtensionFloorZone() {
  const { Vector3, Raycaster } = await import('/node_modules/.vite/deps/three.js')
  const state = window.roofWallScene(), canvas = state.gl.domElement
  const originalFloors = structuredClone(window.regressionFloors)
  const originalAssignments = structuredClone(window.regressionAssignments)
  const originalCamera = { position: state.camera.position.clone(), quaternion: state.camera.quaternion.clone() }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const logIndex = window.houseDesignerEngineLog.entries.at(-1)?.index ?? 0
  const sample = (x, y) => {
    const meshes=[]
    state.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')meshes.push(o)})
    const hit=new Raycaster(new Vector3(x,y,7.2),new Vector3(0,0,-1)).intersectObjects(meshes,false)[0]
    if(!hit || Math.abs(hit.point.z-6.938867)>1e-4)throw new Error('Missing extension facade')
    const material=hit.object.material[hit.face.materialIndex]
    return {color:material.color.getHexString(),map:material.map?.uuid??null}
  }
  const click = async (x,y) => {
    state.camera.position.set(x,y,12);state.camera.lookAt(x,y,6.938867);state.camera.updateMatrixWorld();state.invalidate()
    await wait(250)
    const rect=canvas.getBoundingClientRect(),event={bubbles:true,button:0,pointerId:1,pointerType:'mouse',
      clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}
    canvas.dispatchEvent(new PointerEvent('pointerdown',{...event,buttons:1}))
    canvas.dispatchEvent(new PointerEvent('pointerup',{...event,buttons:0}))
    await wait(250)
    return structuredClone(window.regressionSurface)
  }
  try {
    window.updateRegressionFloors(originalFloors.map(f=>({...f,roofs:f.roofs?.filter(r=>!r.id.startsWith('ded6c505'))})))
    for(let i=0;i<80;i++) {
      await wait(200)
      const completed=window.houseDesignerEngineLog.entries.filter(e=>e.index>logIndex&&e.type==='wall-roof-clipping-complete')
      if(new Set(completed.map(e=>e.detail.split(':')[0])).size===originalFloors.length)break
      if(i===79)throw new Error('Roof removal did not finish')
    }
    const band=sample(-3.2,2.55), upper=sample(-3.2,3.1), inside=sample(-3.2,2.2)
    if(JSON.stringify(band)!==JSON.stringify(upper)||JSON.stringify(band)===JSON.stringify(inside)) {
      throw new Error(`The exposed floor zone inherited the internal partition: ${JSON.stringify({band,upper,inside})}`)
    }
    const selection=await click(-7.5,1.6)
    if(!selection?.wallId.startsWith('cf0596b4'))throw new Error('Clicking wall A selected the wrong wall')
    window.updateRegressionAssignments([...originalAssignments,...selection.fragments.map((f,i)=>({
      id:`extension-a-${i}`,materialId:'dulux-blush-matt',target:{type:'wall-surface-fragment',...f},
    }))])
    await wait(350)
    if(JSON.stringify(sample(-3.2,2.55))!==JSON.stringify(band))throw new Error('Painting A changed the upper facade continuation')
    const boundarySelection=await click(-3.2,2.55)
    if(!boundarySelection?.wallId.startsWith('5dc6e05e'))throw new Error('The continuation must select the upper exterior wall')
    return {passed:true,band,upper,internalPartition:inside,selectedA:selection.wallId,selectedBoundary:boundarySelection.wallId}
  } finally {
    window.updateRegressionAssignments(originalAssignments)
    window.updateRegressionFloors(originalFloors)
    state.camera.position.copy(originalCamera.position);state.camera.quaternion.copy(originalCamera.quaternion);state.camera.updateMatrixWorld();state.invalidate()
  }
}
