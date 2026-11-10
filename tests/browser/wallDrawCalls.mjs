import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

const browser = await lightingBrowser()
const port = process.argv[2] ?? '5180'
const mode = process.argv[3] ?? 'basic'
const output = 'tmp/wall-draw-calls'
mkdirSync(output, { recursive: true })
const reports = []
try {
  for (const [name, query] of [
    ['whole-house', 'colin'],
    ['ground-floor', 'colin&edit-floor&ground'],
    ['upper-floor', 'colin&edit-floor&upper-selection'],
  ]) {
    if (process.argv[4] && process.argv[4] !== name) continue
    await browser.call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?${query}${mode === 'basic' ? '&basic-scene&opaque-materials' : ''}` })
    await browser.wait(mode === 'basic' ? 'window.basicSceneReport?.gpuCompleteMs !== undefined'
      : 'window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase === "full"')
    const inventory = await browser.evaluate(`(() => {
      const {scene} = roofWallScene(), walls = [], roles = {}
      scene.traverseVisible(o => {
        if (!o.isMesh) return
        const role = o.userData.houseDesignerRole ?? 'untagged'
        roles[role] = (roles[role] ?? 0) + 1
        if (role !== 'wall-engine-render') return
        walls.push({floorId:o.userData.floorId,elevation:o.position.y,indexed:!!o.geometry.index,
          wallIds:o.userData.wallPreparedWalls?.map(w=>w.id),
          groups:o.geometry.groups.map(g=>({ ...g, key:o.userData.wallMaterialKeys?.[g.materialIndex],
            color:o.material[g.materialIndex]?.color?.getHexString(),
            transparent:o.material[g.materialIndex]?.transparent,side:o.material[g.materialIndex]?.side,
            visible:o.material[g.materialIndex]?.visible }))})
      })
      return {walls,roles}
    })()`)
    const calls = await browser.evaluate(`(async () => {
      const {scene,camera,gl,invalidate} = roofWallScene()
      const direct = gl.renderBufferDirect, render = gl.render
      const rows = new Map(), sourceRoles = new Map()
      scene.traverse(o=>{if(o.isMesh) sourceRoles.set(o.geometry, o.userData)})
      const done = new Promise(resolve => {
        gl.renderBufferDirect = function(c,s,g,m,o,group) {
          const data = o.userData.houseDesignerRole ? o.userData : sourceRoles.get(g) ?? {}
          const pass = m.isMeshDepthMaterial || m.isMeshDistanceMaterial ? 'shadow' : 'main'
          const key = JSON.stringify([data.houseDesignerRole ?? 'untagged',data.floorId ?? null,pass])
          const before = gl.info.render.calls
          const result = direct.apply(this,arguments), delta = gl.info.render.calls-before
          if(delta) rows.set(key,(rows.get(key)??0)+delta)
          return result
        }
        gl.render = function(s,c) {
          const result = render.apply(this,arguments)
          if(c===camera) {
            gl.render=render;gl.renderBufferDirect=direct
            resolve({retained:!!s.userData.retainedViewport,rows:[...rows].map(([key,calls])=>({key:JSON.parse(key),calls}))})
          }
          return result
        }
      })
      camera.position.x+=0.00001;camera.updateMatrixWorld();invalidate()
      try { return await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('No display frame')),15000))]) }
      finally {gl.render=render;gl.renderBufferDirect=direct}
    })()`)
    const report = {name, mode, inventory, calls}
    reports.push(report)
    writeFileSync(`${output}/${mode}.json`, JSON.stringify({ reports, errors: browser.errors }, null, 2))
    console.log(JSON.stringify({name, mode,
      walls:inventory.walls.map(wall=>({floorId:wall.floorId,groups:wall.groups.length,indexed:wall.indexed})),
      calls:calls.rows.filter(row=>row.key[0]==='wall-engine-render'||row.key[0]==='roof-infill')}))
  }
} finally {
  writeFileSync(`${output}/${mode}.json`, JSON.stringify({ reports, errors: browser.errors }, null, 2))
  browser.close()
}
