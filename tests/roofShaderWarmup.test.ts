import assert from 'node:assert/strict'
import test from 'node:test'
import { DoubleSide, Mesh, MeshStandardMaterial, Scene } from 'three'
import { createRoofShaderWarmup } from '../src/roofShaderWarmup.ts'
import { createShaderWarmupSnapshot, getShaderWarmupSceneRevision, shaderWarmupRevisionIsCovered } from '../src/shaderWarmup.ts'
import { createIndirectField } from '../src/indirectLighting.ts'
import { applyIndirectLightingShader, createIndirectUniforms, enableExteriorSkyMaterial } from '../src/indirectLightingShader.ts'
import { applyRoomLightShader, createRoomLightMaskTexture, createRoomLightShaderUniforms } from '../src/roomLightShader.ts'
import { createRoomLightMask } from '../src/roomLightMask.ts'
import { applySpecularOnlyImageBasedLighting } from '../src/materials/imageBasedLighting.ts'

test('startup roof prototypes prepare solid, fade and shadow variants using live lighting bindings', () => {
  const scene = new Scene(), field = createIndirectField([]), indirect = createIndirectUniforms(field)
  const texture = createRoomLightMaskTexture(createRoomLightMask([], {minX:0,minZ:0,size:4},4))
  const room = createRoomLightShaderUniforms(texture), source = new MeshStandardMaterial()
  indirect.hdExteriorSkyFeature.value = 1
  applyRoomLightShader(source, room); applySpecularOnlyImageBasedLighting(source); applyIndirectLightingShader(source, indirect)
  const existing = new Mesh(undefined, source); scene.add(existing)
  const prototypes = createRoofShaderWarmup(scene)
  const snapshot = createShaderWarmupSnapshot(new Scene(), {fadeWalls:false,fadeRoofs:true,shadows:true,helpers:[prototypes.root]})
  try {
    assert.equal(scene.children.length,1,'warmup helpers never enter the display or lighting geometry')
    const top=prototypes.root.children.find(o=>o.userData.houseDesignerRole==='roof-top') as Mesh
    assert.ok(top.geometry.hasAttribute('hdGIExteriorReceiver'))
    assert.equal((top.material as MeshStandardMaterial).shadowSide,DoubleSide)
    assert.ok(snapshot.root.children.some(o=>(o as Mesh).material instanceof MeshStandardMaterial && ((o as Mesh).material as MeshStandardMaterial).transparent))
    assert.ok(snapshot.root.children.some(o=>((o as Mesh).material as MeshStandardMaterial).type==='MeshDepthMaterial'))
    const created=new Mesh(top.geometry,new MeshStandardMaterial())
    const material=created.material
    assert.ok(shaderWarmupRevisionIsCovered(getShaderWarmupSceneRevision(prototypes.root),getShaderWarmupSceneRevision(created)),
      'new roof meshes are covered before lighting controllers attach their hooks')
    applyRoomLightShader(material,room);applySpecularOnlyImageBasedLighting(material);applyIndirectLightingShader(material,indirect);enableExteriorSkyMaterial(material)
    assert.ok(shaderWarmupRevisionIsCovered(getShaderWarmupSceneRevision(prototypes.root),getShaderWarmupSceneRevision(created)))
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',fragmentShader:'#include <common>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>'}
    ;(top.material as MeshStandardMaterial).onBeforeCompile(shader as never,{} as never)
    assert.equal((shader.uniforms as Record<string,unknown>).hdRoomLightEnabled,room.enabled)
    assert.equal((shader.uniforms as Record<string,unknown>).hdExteriorSkyFeature,indirect.hdExteriorSkyFeature)
    material.dispose()
  } finally {snapshot.dispose();prototypes.dispose();existing.geometry.dispose();source.dispose();field.dispose();texture.dispose()}
})
