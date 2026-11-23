import assert from 'node:assert/strict'

export async function auditDesignEdits(browser, {fixture,report,save,ready,native,mode,resources,assertDesign,menu,closeMenu,setChoice,setPose,capture}){
  const run=(fn,...args)=>browser.evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')')
  const view="editorProps('ThreeDView')",plan="editorProps('FloorplanCanvas')"
  const wallTypes="['wall-face','wall-surface-fragment']"
  await run(async()=>{
    window.editorState=window.perfScene
    window.editorCurrent=()=>{
      const root=document.getElementById('root'),key=Object.keys(root).find(k=>k.startsWith('__reactContainer$'))
      return root[key].stateNode.current
    }
    window.editorProps=name=>{
      const queue=[window.editorCurrent()]
      while(queue.length){
        const fiber=queue.pop()
        if(!fiber)continue
        if((fiber.type?.name??fiber.type?.type?.name)===name)return fiber.memoizedProps
        queue.push(fiber.sibling,fiber.child)
      }
    }
    const {isViewportPreparationPending}=await import('/src/viewportScheduling.ts')
    const {isWallClippingPending}=await import('/src/wallEngine/wallRoofClipClient.ts')
    const {isRoofAssemblyPending}=await import('/src/roofAssemblyClient.ts')
    window.designGeometrySettled=()=>!isViewportPreparationPending()&&!isWallClippingPending()&&!isRoofAssemblyPending()
  })
  const mouse=async point=>{
    await browser.call('Input.dispatchMouseEvent',{...point,type:'mousePressed',button:'left',buttons:1,clickCount:1})
    await browser.call('Input.dispatchMouseEvent',{...point,type:'mouseReleased',button:'left',buttons:0,clickCount:1})
  }
  const click=async(selector,label)=>{
    const point=await run((selector,label)=>{
      const element=[...document.querySelectorAll(selector)].find(e=>!label||e.textContent.trim()===label)
      if(!element||element.disabled)throw Error('Unavailable editor control '+(label??selector))
      const r=element.getBoundingClientRect()
      return {x:r.x+r.width/2,y:r.y+r.height/2}
    },selector,label)
    await mouse(point)
  }
  const frames=()=>run(async()=>{
    const s=perfScene()
    for(let j=0;j<12;j++){
      s.invalidate()
      await new Promise(requestAnimationFrame)
    }
  })
  async function check(name,action,changed){
    const before=await native(),start=Date.now()
    await action()
    await browser.wait(changed,90000)
    const committedMs=Date.now()-start
    await frames()
    await browser.wait(`${ready} && designGeometrySettled()`,150000)
    await frames()
    const after=await resources()
    report.checks.push({name,committedMs,readyMs:Date.now()-start,shaderBefore:before,shaderAfter:after.shader,
      lighting:after.lighting,workerCount:after.workers.length})
    await save()
    assertDesign(after)
    assert.deepEqual(after.shader,before,'Viewport shader activity during '+name)
    console.log(fixture,'edit',name,committedMs)
  }
  const selected=()=>browser.evaluate(`${view}.selectedSurface`)
  const pick=async(x,y)=>mouse(await run((x,y)=>{
    const r=perfScene().gl.domElement.getBoundingClientRect()
    return {x:r.x+x*r.width,y:r.y+y*r.height}
  },x,y))
  await setPose()
  const startPick=await browser.evaluate("import('/tests/browser/sceneEditTrace.js').then(m=>m.editorWallPoint())")
  await check('Select wall with viewport picking',()=>mouse(startPick),`${wallTypes}.includes(${view}.selectedSurface?.type)`)
  await check('Clear selection',()=>run(()=>editorProps('ThreeDView').onClearSelection()),`!${view}.selectedSurface`)
  if(fixture==='room'){
    await check('Select the window frame',()=>pick(.194,.315),`${plan}.selectedModelId==='a6455180-3e89-4d70-a6e4-f8417f786334'`)
    await check('Select the patio door',()=>pick(.834,.502),`${plan}.selectedModelId==='2d5883b7-a939-4e23-b72b-fcc3f0d1c9ab'`)
  }
  if(fixture==='room' || fixture==='springfield'){
    const prior=await run(()=>editorProps('FloorplanCanvas').activeFloor)
    const w=prior.walls.find(w=>w.kind==='internal'&&!(w.openings??[]).length)??prior.walls.at(-1)
    const distance=Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y)
    const updated={start:w.start,end:{x:w.end.x+.18*(w.end.x-w.start.x)/distance,y:w.end.y+.18*(w.end.y-w.start.y)/distance}}
    await check('Resize an existing wall',()=>run((id,updates)=>editorProps('FloorplanCanvas').onUpdateWall(id,updates),w.id,updated),
      `(()=>{const w=${plan}.activeFloor.walls.find(w=>w.id===${JSON.stringify(w.id)});return w&&Math.hypot(w.end.x-(${w.end.x}),w.end.y-(${w.end.y}))>.09})()`)
    const wallCount=await browser.evaluate(`${plan}.activeFloor.walls.length`)
    const x=Math.min(...prior.walls.flatMap(w=>[w.start.x,w.end.x]))-4
    const y=Math.min(...prior.walls.flatMap(w=>[w.start.y,w.end.y]))-3
    await check('Add a wall',()=>run((x,y)=>editorProps('FloorplanCanvas').onAddWall({start:{x,y},end:{x:x+2,y}}),x,y),
      `${plan}.activeFloor.walls.length>${wallCount}`)
  }
  if(fixture==='room'){
    const windowId='a6455180-3e89-4d70-a6e4-f8417f786334'
    const model=await run(id=>editorProps('ThreeDView').floors.flatMap(f=>f.models).find(m=>m.id===id),windowId)
    const windowLookup=`${view}.floors.flatMap(f=>f.models).find(m=>m.id===${JSON.stringify(windowId)})`
    await check('Move the left window',()=>run((id,position)=>editorProps('ThreeDView').onUpdateModel(id,{position}),windowId,{...model.position,y:model.position.y+.20}),
      `${windowLookup}.position.y>${model.position.y+.10}`)
    await check('Resize the left window',()=>run(id=>editorProps('ThreeDView').onUpdateModel(id,{widthScale:1.1}),windowId),
      `${windowLookup}.widthScale===1.1`)
  }
  if(fixture==='springfield'||fixture==='furnished'){
    if(await browser.evaluate('!!document.fullscreenElement')){
      await click('button[aria-label="Exit fullscreen"]')
      await browser.wait('!document.fullscreenElement')
    }
    const candidate=await run(()=>{
      const p=editorProps('FloorplanCanvas'),m=p.activeFloor.models.find(m=>/sofa|table|chair|bed|wardrobe|dresser/i.test(m.modelId)&&!m.wallAttachment)
      return m&&{model:m,floor:p.activeFloor.id}
    })
    assert.ok(candidate, 'Expected a movable furniture item on the editing floor')
    {
      const {model,floor}=candidate
      const modelLookup=`${view}.floors.flatMap(f=>f.models).find(m=>m.id===${JSON.stringify(model.id)})`
      await check('Move existing furniture',()=>run((id,p)=>editorProps('ThreeDView').onUpdateModel(id,{position:p}),model.id,{...model.position,x:model.position.x+.22}),
        `${modelLookup}.position.x>${model.position.x+.12}`)
      await run((id,floor)=>editorProps('ThreeDView').onSelectModel(id,floor),model.id,floor)
      await browser.wait(`${plan}.selectedModelId===${JSON.stringify(model.id)}`)
      await run(()=>editorProps('EditToolbar').onCopy())
      await browser.wait("editorProps('EditToolbar').canPaste")
      const count=await browser.evaluate(`${plan}.activeFloor.models.length`)
      await check('Add furniture using Paste',()=>run(()=>editorProps('EditToolbar').onPaste()),`${plan}.activeFloor.models.length===${count+1}`)
    }
    const floors=await browser.evaluate(`${view}.floors.map(f=>f.id)`),current=await browser.evaluate(`${view}.activeFloorId`)
    const next=floors.find(id=>id!==current)
    if(next)await check('Switch floors',()=>setChoice('3D visible floors',next),`${view}.activeFloorId===${JSON.stringify(next)}`)
  }
  if(fixture==='room'){
    if(await browser.evaluate('!!document.fullscreenElement')){
      await click('button[aria-label="Exit fullscreen"]')
      await browser.wait('!document.fullscreenElement')
    }
    await setPose()
    await mouse(await browser.evaluate("import('/tests/browser/sceneEditTrace.js').then(m=>m.editorWallPoint())"))
    await browser.wait(`${wallTypes}.includes(${view}.selectedSurface?.type)`)
    const current=await selected(),before=await browser.evaluate(`JSON.stringify(${view}.surfaceAssignments)`)
    await click('button[aria-label="Materials"]')
    await browser.wait("!!document.querySelector('input[aria-label=\"Search materials\"]')")
    await click('input[aria-label="Search materials"]')
    await browser.call('Input.insertText',{text:'Timeless'})
    await browser.wait("!!document.querySelector('.material-tree-item[data-material-id]')")
    await click('.material-tree-item[data-material-id]')
    await check('Apply an authored wall finish',()=>click('button','Apply material'),`JSON.stringify(${view}.surfaceAssignments)!==${JSON.stringify(before)}`)
    report.wallFinishTarget=current
    await check('Undo wall finish',()=>click('button[aria-label="Undo"]'),`JSON.stringify(${view}.surfaceAssignments)===${JSON.stringify(before)}`)
    await check('Select the timber floor',()=>pick(.55,.91),`${view}.selectedSurface?.type==='room-floor'`)
    if(!await browser.evaluate("!!document.querySelector('input[aria-label=\"Search materials\"]')"))await click('button[aria-label="Materials"]')
    await click('input[aria-label="Search materials"]')
    await browser.evaluate("document.querySelector('input[aria-label=\"Search materials\"]').select()")
    await browser.call('Input.insertText',{text:'Light oak'})
    await browser.wait("!!document.querySelector('.material-tree-item[title=\"Light oak\"]')")
    await click('.material-tree-item[title="Light oak"]')
    await check('Apply an authored floor finish',()=>click('button','Apply material'),`JSON.stringify(${view}.surfaceAssignments)!==${JSON.stringify(before)}`)
    await check('Undo floor finish',()=>click('button[aria-label="Undo"]'),`JSON.stringify(${view}.surfaceAssignments)===${JSON.stringify(before)}`)
  }
  if(process.argv.includes('--switch')){
    const geometry=()=>browser.evaluate(`JSON.stringify([${view}.floors,${view}.surfaceAssignments])`)
    const before=await geometry(),beforePreview=await native()
    await menu()
    await setChoice('Lighting mode','existing')
    await closeMenu()
    await browser.wait(`${mode('existing')} && !!perfScene().scene.userData.getLightingField && (`+
      "perfScene().scene.userData.viewportLightingWork.preview.probeLayouts>0 || perfScene().scene.userData.indirectLighting?.state==='ready')",180000)
    report.realistic=await resources()
    await save()
    assert.equal(await geometry(),before)
    await menu()
    const beforeReturn=await native(),t=Date.now()
    await setChoice('Lighting mode','design')
    await closeMenu()
    await browser.wait(mode('design'),8000)
    await frames()
    await browser.wait(ready,150000)
    await frames()
    await browser.evaluate('new Promise(r=>setTimeout(r,900))')
    report.return={elapsedMs:Date.now()-t,state:await resources(),beforePreview,beforeReturn,shader:await native()}
    await save()
    assertDesign(report.return.state,{afterPreview:true})
    assert.equal(await geometry(),before)
    assert.deepEqual(report.return.shader,beforeReturn,'Returning to Design compiled shaders')
    await capture('returned')
  }
}
