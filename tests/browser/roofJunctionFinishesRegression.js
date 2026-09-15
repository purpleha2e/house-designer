// Run on roofWallRegression.html?materials with the saved red_house_3 scene.
export async function checkRoofJunctionFinishes() {
  const {Vector3,Raycaster}=await import('/node_modules/.vite/deps/three.js')
  const s=window.roofWallScene(), canvas=s.gl.domElement
  const wait=()=>new Promise(r=>setTimeout(r,300))
  for(let i=0;i<80&&window.houseDesignerEngineLog.entries.filter(e=>e.type==='wall-roof-clipping-complete').length<2;i++)await wait()
  const original=structuredClone(window.regressionAssignments)
  const camera={position:s.camera.position.clone(),quaternion:s.camera.quaternion.clone()}
  const click=async(z,y=4.5)=>{
    s.camera.position.set(2,y,z);s.camera.lookAt(1.35,y,z);s.camera.updateMatrixWorld();s.invalidate();await wait()
    const r=canvas.getBoundingClientRect(), e={bubbles:true,button:0,pointerId:1,pointerType:'mouse',clientX:r.left+r.width/2,clientY:r.top+r.height/2}
    canvas.dispatchEvent(new PointerEvent('pointerdown',{...e,buttons:1}));canvas.dispatchEvent(new PointerEvent('pointerup',{...e,buttons:0}));await wait()
    return structuredClone(window.regressionSurface)
  }
  const materialAt=(origin,direction)=>{
    const meshes=[];s.scene.traverse(o=>{if(o.isMesh&&o.userData.houseDesignerRole==='wall-engine-render')meshes.push(o)})
    const hit=new Raycaster(new Vector3(...origin),new Vector3(...direction)).intersectObjects(meshes,false)[0]
    if(!hit)throw new Error('Missing wall/reveal sample')
    return hit.object.material[hit.face.materialIndex]
  }
  const color=(origin,direction)=>materialAt(origin,direction).color.getHexString()
  const wallColor=(z,y=4.5)=>color([2,y,z],[-1,0,0])
  const wallAppearance=(z,y=4.5)=>{const material=materialAt([2,y,z],[-1,0,0]);return `${material.color.getHexString()}:${material.map?.uuid??'none'}`}
  const revealColors=(x)=>({left:color([x,3.5,4.7],[0,0,-1]),right:color([x,3.5,5.5],[0,0,1]),top:color([x,4.7,5.09],[0,1,0])})
  const paint=selection=>window.updateRegressionAssignments([...original,...selection.fragments.map((f,i)=>({
    id:`junction-finish-${i}`,materialId:'dulux-blush-matt',target:{type:'wall-surface-fragment',...f},
  }))])
  try {
    const a=await click(7.5), b=await click(6.7658), c=await click(6.4)
    const ids=f=>f?.fragments?.map(r=>r.fragmentId).sort()
    if(!ids(a)?.length||JSON.stringify(ids(a))!==JSON.stringify(ids(b))||JSON.stringify(ids(a))!==JSON.stringify(ids(c)))throw new Error('A/B/C must select together')
    if(!b.pickedFragment?.fragmentId.includes('roof-boundary-cap'))throw new Error('The junction strip B was not picked')
    const initial={A:wallAppearance(7.5),B:wallAppearance(6.7658),C:wallAppearance(6.4)}
    if(initial.A!==initial.B||initial.A!==initial.C)throw new Error(`The exterior junction inherited an interior finish: ${JSON.stringify(initial)}`)
    const before={hidden:wallColor(6.2,3.45),otherEnd:wallColor(2)}
    paint(a);await wait()
    const after={A:wallColor(7.5),B:wallColor(6.7658),C:wallColor(6.4),hidden:wallColor(6.2,3.45),otherEnd:wallColor(2)}
    if(after.A!==after.B||after.A!==after.C||after.hidden!==before.hidden||after.otherEnd!==before.otherEnd)throw new Error(`Facade paint crossed a roof boundary: ${JSON.stringify({before,after})}`)
    window.updateRegressionAssignments(original);await wait()
    const wall=await click(4.1,3.45), oppositeBefore=revealColors(1.1)
    if(!wall.fragments.some(f=>f.fragmentId.includes(':opening:')))throw new Error('Reveals are absent from wall selection')
    paint(wall);await wait()
    const reveals=revealColors(1.3), oppositeAfter=revealColors(1.1), paintColor=wallColor(4.1,3.45)
    if(Object.values(reveals).some(c=>c!==paintColor)||JSON.stringify(oppositeBefore)!==JSON.stringify(oppositeAfter))throw new Error(`Reveals must follow their wall side: ${JSON.stringify({reveals,paintColor,oppositeBefore,oppositeAfter})}`)
    return {passed:true,facadeFragments:a.fragments.length,doorwayFragments:wall.fragments.length,initial,after,reveals,oppositeAfter}
  } finally {
    window.updateRegressionAssignments(original);s.camera.position.copy(camera.position);s.camera.quaternion.copy(camera.quaternion);s.camera.updateMatrixWorld();s.invalidate()
  }
}
