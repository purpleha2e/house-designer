import test from 'node:test'
import assert from 'node:assert/strict'
import { CubeUVReflectionMapping, DataTexture, Mesh, MeshStandardMaterial } from 'three'
import { createTextureShaderWarmup } from '../src/materials/textureShaderWarmup.ts'
import { applyIndirectLightingShader, createIndirectUniforms } from '../src/indirectLightingShader.ts'
import { createIndirectField } from '../src/indirectLighting.ts'

test('texture preparation covers albedo and PBR finishes, including fades, without changing live materials',()=>{
  const field=createIndirectField([]),material=new MeshStandardMaterial(),mesh=new Mesh(undefined,material)
  applyIndirectLightingShader(material,createIndirectUniforms(field))
  mesh.userData.houseDesignerRole='wall-engine-render'
  const helper=createTextureShaderWarmup([]),variants=helper.materials(material,mesh,true,true)
  try {
    assert.equal(variants.length,4)
    assert.ok(variants.some(m=>m.map&&!m.normalMap&&!m.transparent))
    assert.ok(variants.some(m=>m.map&&m.normalMap&&m.roughnessMap&&!m.transparent))
    assert.ok(variants.some(m=>m.map&&m.normalMap&&m.roughnessMap&&m.transparent))
    assert.equal(material.map,null);assert.equal(material.transparent,false)
    for(const variant of variants){
      assert.equal(variant.customProgramCacheKey(),material.customProgramCacheKey())
      assert.equal(variant.map?.image.width,1)
    }
  } finally {variants.forEach(m=>m.dispose());helper.dispose();material.dispose();mesh.geometry.dispose();field.dispose()}
})

test('roof warmup covers reflective paint and PBR finishes before they are applied',()=>{
  const field=createIndirectField([]),material=new MeshStandardMaterial(),mesh=new Mesh(undefined,material)
  applyIndirectLightingShader(material,createIndirectUniforms(field))
  mesh.userData.houseDesignerRole='roof-top'
  const environment=new DataTexture(new Uint8Array(4),1,1)
  environment.mapping=CubeUVReflectionMapping
  let environmentDisposed=false
  environment.addEventListener('dispose',()=>{environmentDisposed=true})
  const helper=createTextureShaderWarmup([],environment),variants=helper.materials(material,mesh,false,true)
  try {
    for(const transparent of [false,true]) {
      assert.ok(variants.some(m=>m.envMap===environment&&!m.map&&m.transparent===transparent),'reflective paint is prepared')
      assert.ok(variants.some(m=>m.envMap===environment&&m.map&&m.normalMap&&m.roughnessMap&&m.transparent===transparent),'reflective roof tiles are prepared')
      assert.ok(variants.some(m=>!m.envMap&&m.map&&m.normalMap&&m.roughnessMap&&m.transparent===transparent),'direct-light finishes remain prepared')
    }
    assert.equal(material.envMap,null,'startup leaves live finishes unchanged')
    variants.forEach(m=>assert.equal(m.customProgramCacheKey(),material.customProgramCacheKey()))
    helper.dispose()
    assert.equal(environmentDisposed,false,'the environment remains owned by its provider')
  } finally {variants.forEach(m=>m.dispose());material.dispose();mesh.geometry.dispose();field.dispose();environment.dispose()}
})
