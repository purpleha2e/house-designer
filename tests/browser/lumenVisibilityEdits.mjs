import assert from 'node:assert/strict'

export async function auditVisibilityEdits(browser,report,save){
  const evaluate=(fn,...args)=>browser.evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')')
  const scene='perfScene().scene.userData'
  const native=()=>browser.evaluate(`({...${scene}.viewportShaderAudit.totals})`)
  const ready=`${scene}.lumenGI?.state==='ready' && ${scene}.lumenGI.bounceReady && !${scene}.lumenGI.refining && !${scene}.shaderWarmupPending`
  await evaluate(()=>{
    window.visibilityEditorProps=name=>{
      const root=document.getElementById('root'),key=Object.keys(root).find(k=>k.startsWith('__reactContainer$'))
      const queue=[root[key].stateNode.current]
      while(queue.length){
        const f=queue.pop()
        if(!f)continue
        if((f.type?.name??f.type?.type?.name)===name)return f.memoizedProps
        queue.push(f.sibling,f.child)
      }
    }
  })
  const click=async(selector,label)=>{
    const point=await evaluate((selector,label)=>{
      const element=[...document.querySelectorAll(selector)].find(e=>!label||e.textContent.trim()===label)
      if(!element||element.disabled)throw Error('Editor control unavailable: '+(label??selector))
      const r=element.getBoundingClientRect()
      return {x:r.x+r.width/2,y:r.y+r.height/2}
    },selector,label)
    await browser.call('Input.dispatchMouseEvent',{...point,type:'mousePressed',button:'left',buttons:1,clickCount:1})
    await browser.call('Input.dispatchMouseEvent',{...point,type:'mouseReleased',button:'left',buttons:0,clickCount:1})
  }
  const step=async(name,action,changed)=>{
    const before=await native(),began=Date.now()
    await action()
    await browser.wait(changed,120000)
    const publishedMs=Date.now()-began
    await browser.wait(ready,240000)
    const after=await native()
    report.visibilityEdits.push({name,publishedMs,settledMs:Date.now()-began,before,after,
      cache:await browser.evaluate(`(({geometryBuilds,bvhBuilds,relights,cacheProfile})=>({geometryBuilds,bvhBuilds,relights,cacheProfile}))(${scene}.lumenGI)`)})
    await save()
    assert.deepEqual(after,before,'Native shader activity during '+name)
  }
  report.visibilityEdits=[]
  if(await browser.evaluate('!!document.fullscreenElement')){
    await click('button[aria-label="Exit fullscreen"]')
    await browser.wait('!document.fullscreenElement')
  }
  const assignments=await browser.evaluate("JSON.stringify(visibilityEditorProps('ThreeDView').surfaceAssignments)")
  await click('button[aria-label="Materials"]')
  await browser.wait("!!document.querySelector('input[aria-label=\"Search materials\"]')")
  await click('input[aria-label="Search materials"]')
  await browser.call('Input.insertText',{text:'Timeless'})
  await browser.wait("!!document.querySelector('.material-tree-item[data-material-id]')")
  await click('.material-tree-item[data-material-id]')
  await step('Apply wall material',()=>click('button','Apply material'),
    `JSON.stringify(visibilityEditorProps('ThreeDView').surfaceAssignments)!==${JSON.stringify(assignments)}`)
  await step('Undo wall material',()=>click('button[aria-label="Undo"]'),
    `JSON.stringify(visibilityEditorProps('ThreeDView').surfaceAssignments)===${JSON.stringify(assignments)}`)

  const windowId='a6455180-3e89-4d70-a6e4-f8417f786334'
  const original=await evaluate(id=>visibilityEditorProps('ThreeDView').floors.flatMap(f=>f.models).find(m=>m.id===id).position,windowId)
  const builds=await browser.evaluate(`${scene}.lumenGI.geometryBuilds`)
  await step('Move left window 20 cm',()=>evaluate((id,position)=>{
    // The same editor callback commits numeric position changes from the
    // real object inspector and runs the wall-opening synchronizer.
    visibilityEditorProps('ThreeDView').onUpdateModel(id,{position})
  },windowId,{...original,y:original.y+.2}),
  `visibilityEditorProps('ThreeDView').floors.flatMap(f=>f.models).find(m=>m.id===${JSON.stringify(windowId)}).position.y>${original.y+.1} &&
    ${scene}.lumenGI.geometryBuilds>${builds}`)
  assert.deepEqual(await native(),report.fullNative,'Native shader activity after project readiness')
}
