import { Mesh, MeshBasicMaterial, Scene, type Material, type WebGLRenderer, type WebGLRenderTarget } from 'three'
import type { Camera } from 'three'

/** Audit-only A/B. A separate depth scene keeps the editor's material programs
 * and draw ordering fixed. The opaque render inherits its populated depth. */
export function createLumenDepthStudy(scene:Scene,camera:Camera,pass:{
  render:(renderer:WebGLRenderer,input:WebGLRenderTarget,...rest:any[])=>void
  clearPass:{enabled:boolean;render:(renderer:WebGLRenderer,input:WebGLRenderTarget)=>void}
  renderToScreen:boolean
}){
  const depthScene=new Scene(),materials=new Map<Material,MeshBasicMaterial>()
  scene.updateMatrixWorld(true)
  scene.traverseVisible(object=>{
    const role=String(object.userData.houseDesignerRole??'')
    if(!(object instanceof Mesh) || !/^(wall-engine-render|ceiling-slab-|room-(floor|ceiling)-finish)/.test(role))return
    if('isInstancedMesh' in object || 'isBatchedMesh' in object)return
    const all=Array.isArray(object.material)?object.material:[object.material]
    if(all.some(m=>m.transparent || m.alphaTest>0 || !m.visible || !m.depthWrite || !m.depthTest || !m.colorWrite))return
    const depth=all.map(material=>{
      let existing=materials.get(material)
      if(!existing){
        existing=new MeshBasicMaterial({colorWrite:false,side:material.side,clippingPlanes:material.clippingPlanes,
          clipIntersection:material.clipIntersection,polygonOffset:material.polygonOffset,polygonOffsetFactor:material.polygonOffsetFactor,polygonOffsetUnits:material.polygonOffsetUnits})
        materials.set(material,existing)
      }
      return existing
    })
    const mesh=new Mesh(object.geometry,Array.isArray(object.material)?depth:depth[0])
    mesh.layers.mask=object.layers.mask
    mesh.matrixAutoUpdate=false;mesh.matrix.copy(object.matrixWorld)
    depthScene.add(mesh)
  })
  const original=pass.render
  return {meshes:depthScene.children.length,set(enabled:boolean){
    pass.render=enabled?function(renderer,input,...rest){
      const {clearPass}=pass,clear=clearPass.enabled,autoShadow=renderer.shadowMap.autoUpdate
      try{
        if(clear)clearPass.render(renderer,input)
        renderer.setRenderTarget(pass.renderToScreen?null:input)
        renderer.shadowMap.autoUpdate=false
        renderer.render(depthScene,camera)
        renderer.shadowMap.autoUpdate=autoShadow
        clearPass.enabled=false
        original.call(pass,renderer,input,...rest)
      }finally{clearPass.enabled=clear;renderer.shadowMap.autoUpdate=autoShadow}
    }:original
  },dispose(){pass.render=original;for(const material of materials.values())material.dispose()}}
}
