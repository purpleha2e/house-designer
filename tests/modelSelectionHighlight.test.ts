import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Plane, Scene, Texture, Vector3 } from 'three'
import { createModelSelectionHighlight } from '../src/modelSelectionHighlight.ts'
import { ImportedModelBatching, isBatchedModelSource } from '../src/importedModelBatching.ts'
import { createViewportSelection } from '../src/viewportSelection.ts'
import { createOpaqueViewportScene } from '../src/opaqueViewportScene.ts'
import { getShaderWarmupSceneRevision, getShaderWarmupResourceRevision } from '../src/shaderWarmup.ts'

test('selection reuses overlays and preserves batching, authored revisions and resource ownership', () => {
  const scene = new Scene(), batches = new ImportedModelBatching(), geometry = new BoxGeometry(), material = new MeshBasicMaterial()
  const roots = [new Group(), new Group()], sources = roots.map(root => { const mesh = new Mesh(geometry, material);root.add(mesh);scene.add(root);return mesh })
  roots.forEach((root, i) => batches.register(root, String(i)));scene.add(batches.group);batches.update()
  const highlights = roots.map(createModelSelectionHighlight), batch = batches.group.children[0]
  const revision = getShaderWarmupSceneRevision(scene), resources = getShaderWarmupResourceRevision(scene)
  let disposed = 0, sourceDisposed = 0
  geometry.addEventListener('dispose', () => sourceDisposed++);material.addEventListener('dispose', () => sourceDisposed++)
  highlights.forEach((highlight,i) => highlight.sync(roots[i],true))
  const meshes = highlights.map(h => h.root.children[0] as Mesh)
  meshes.forEach(m => (m.material as MeshBasicMaterial).addEventListener('dispose', () => disposed++))
  for(let i=0;i<30;i++){
    highlights.forEach((h,j)=>h.sync(roots[j],i%2===j));batches.invalidate();batches.update()
    assert.equal(batches.group.children[0],batch)
    assert.equal(getShaderWarmupSceneRevision(scene),revision)
    assert.equal(getShaderWarmupResourceRevision(scene),resources)
    sources.forEach(source => {assert.equal(source.visible,false);assert.equal(isBatchedModelSource(source),true);assert.equal(source.children.length,0)})
    highlights.forEach((h,j)=>assert.equal(h.root.children[0],meshes[j]))
  }
  assert.equal(disposed,0)
  highlights.forEach(h=>h.dispose());assert.equal(disposed,2);assert.equal(sourceDisposed,0)
  batches.reset();geometry.dispose();material.dispose()
})

test('basic/retained selection follows transformed batched sources and clears on deselect or replacement', () => {
  const scene = new Scene(), model = new Group(), part = new Group(), source = new Mesh(new BoxGeometry(),new MeshBasicMaterial())
  model.position.set(4,3,2);model.scale.set(-2,1,3);part.rotation.y=.4;part.position.y=2;part.add(source);model.add(part);scene.add(model)
  const highlight=createModelSelectionHighlight(),selection=createViewportSelection(),display=createOpaqueViewportScene(scene,{basic:true})
  highlight.sync(model,true);scene.updateMatrixWorld(true)
  const overlay=highlight.root.children[0] as Mesh
  overlay.matrixWorld.elements.forEach((v,i)=>assert.ok(Math.abs(v-source.matrixWorld.elements[i])<1e-8))
  selection.sync(scene,display.scene,'selected')
  assert.ok(display.scene.getObjectByName('model-selection-highlight'))
  highlight.sync(model,false);selection.sync(scene,display.scene,'none')
  assert.equal(display.scene.getObjectByName('model-selection-highlight'),undefined)
  highlight.sync(model,true);part.visible=false;highlight.sync(model,true);assert.equal(overlay.visible,false)
  part.visible=true;source.removeFromParent();highlight.sync(model,true);assert.equal(highlight.root.children.length,0)
  scene.remove(model);selection.sync(scene,display.scene,'new-project');assert.equal(display.scene.getObjectByName('model-selection-highlight'),undefined)
  highlight.dispose();selection.clear();display.dispose();source.geometry.dispose();(source.material as MeshBasicMaterial).dispose()
})

test('alpha, transparency and clipping are preserved without mutating source materials', () => {
  const map=new Texture(),alphaMap=new Texture(),plane=new Plane(new Vector3(1,0,0),0)
  const material=new MeshBasicMaterial({map,alphaMap,alphaTest:.4,side:DoubleSide,opacity:.5,transparent:true,clippingPlanes:[plane],clipIntersection:true})
  const source=new Mesh(new BoxGeometry(),[material]),root=new Group(),highlight=createModelSelectionHighlight();root.add(source)
  highlight.sync(root,true)
  const overlay=highlight.root.children[0] as Mesh,blue=(overlay.material as MeshBasicMaterial[])[0]
  assert.equal(overlay.geometry,source.geometry);assert.equal(blue.map,map);assert.equal(blue.alphaMap,alphaMap)
  assert.equal(blue.alphaTest,.4);assert.equal(blue.opacity,.14);assert.equal(blue.side,DoubleSide);assert.equal(blue.clippingPlanes,material.clippingPlanes);assert.equal(blue.clipIntersection,true)
  assert.equal(material.opacity,.5);assert.equal(material.color.getHex(),0xffffff)
  material.alphaTest=0;highlight.sync(root,true);assert.equal(blue.map,null);assert.equal(blue.alphaMap,alphaMap)
  highlight.dispose();source.geometry.dispose();material.dispose();map.dispose();alphaMap.dispose()
})

test('asset replacement while deselected releases cached highlight leases without disposing the asset', () => {
  const geometry=new BoxGeometry(),material=new MeshBasicMaterial(),source=new Mesh(geometry,material),root=new Group(),highlight=createModelSelectionHighlight()
  root.add(source);highlight.sync(root,true)
  let released=0,assetReleased=0
  const owned=(highlight.root.children[0] as Mesh).material as MeshBasicMaterial
  owned.addEventListener('dispose',()=>released++)
  material.addEventListener('dispose',()=>assetReleased++);geometry.addEventListener('dispose',()=>assetReleased++)
  const replacement=new MeshBasicMaterial();source.material=replacement
  highlight.sync(root,false);assert.equal(released,1);assert.equal(assetReleased,0);assert.equal(highlight.root.children.length,0)
  highlight.sync(root,true);source.removeFromParent();highlight.sync(root,false);assert.equal(highlight.root.children.length,0)
  highlight.dispose();geometry.dispose();material.dispose();replacement.dispose()
})
