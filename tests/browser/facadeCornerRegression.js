export async function checkFacadeCorner() {
  const {Vector3,Raycaster}=await import('/node_modules/.vite/deps/three.js')
  const s=window.roofWallScene(), canvas=s.gl.domElement
  const wait=()=>new Promise(r=>setTimeout(r,400))
  for(let i=0;i<50&&window.houseDesignerEngineLog.entries.filter(e=>e.type==='wall-roof-clipping-complete').length<2;i++)await wait()
  const original=structuredClone(window.regressionAssignments)
  const camera={position:s.camera.position.clone(),quaternion:s.camera.quaternion.clone()}
  const sample=(x,y,z,side=false,role='wall-engine-render')=>{
    const meshes=[];s.scene.traverse(o=>{if(o.isMesh&&o.userData.houseDesignerRole===role)meshes.push(o)})
    const h=new Raycaster(new Vector3(side?8:x,y,side?z:10),new Vector3(side?-1:0,0,side?0:-1)).intersectObjects(meshes,false)[0]
    if(!h)throw new Error('Missing facade sample')
    return h.object.material[h.face.materialIndex].color.getHexString()
  }
  const click=async(shiftKey)=>{
    s.camera.position.set(6,1.4,12);s.camera.lookAt(6,1.4,8.485368);s.camera.updateMatrixWorld();await wait()
    const rect=canvas.getBoundingClientRect(),event={bubbles:true,button:0,pointerId:1,pointerType:'mouse',shiftKey,
      clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}
    canvas.dispatchEvent(new PointerEvent('pointerdown',{...event,buttons:1}));canvas.dispatchEvent(new PointerEvent('pointerup',{...event,buttons:0}));await wait()
    return structuredClone(window.regressionSurface)
  }
  try{
    const single=await click(false), adjoining=await click(true)
    if(!single?.fragments?.length||adjoining.fragments.length<=single.fragments.length)throw new Error('Shift selection did not expand around the facade corner')
    const paint=selection=>window.updateRegressionAssignments([...original,...selection.fragments.map((f,i)=>({id:`corner-${i}`,materialId:'dulux-blush-matt',target:{type:'wall-surface-fragment',...f}}))])
    const before={B:sample(0,1.4,8.4,true),C:sample(0,1.4,8.2,true),slabC:sample(0,2.55,8.2,true,'ceiling-slab-solid')}
    paint(single);await wait()
    const singleAfter={A:sample(6,1.4,0),slabA:sample(6,2.55,0,false,'ceiling-slab-solid'),slabC:sample(0,2.55,8.2,true,'ceiling-slab-solid')}
    if(singleAfter.A!==singleAfter.slabA||singleAfter.slabC!==before.slabC)throw new Error(`Slab inherited an unrelated face finish: ${JSON.stringify({before,singleAfter})}`)
    paint(adjoining);await wait()
    const after={A:sample(6,1.4,0),B:sample(0,1.4,8.4,true),C:sample(0,1.4,8.2,true),slabC:sample(0,2.55,8.2,true,'ceiling-slab-solid')}
    if(Object.values(after).some(c=>c!==after.A)||after.C===before.C)throw new Error(`Corner faces did not paint together: ${JSON.stringify({before,after})}`)
    return {passed:true,single:single.fragments.length,shift:adjoining.fragments.length,singleAfter,after}
  }finally{window.updateRegressionAssignments(original);s.camera.position.copy(camera.position);s.camera.quaternion.copy(camera.quaternion);s.camera.updateMatrixWorld()}
}
