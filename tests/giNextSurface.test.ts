import assert from 'node:assert/strict'
import test from 'node:test'
import {BufferAttribute,BufferGeometry,Mesh,MeshStandardMaterial} from 'three'
import {bakeSurface} from './giNextSurface.ts'
test('surface atlas isolates triangles, pads islands and preserves vertex interpolation',()=>{
  const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0,10,0,0,11,0,0,10,1,0]),3));geometry.computeVertexNormals()
  const material=new MeshStandardMaterial(),mesh=new Mesh(geometry,material);mesh.updateMatrixWorld()
  const bake=bakeSurface(mesh,p=>({rgb:p.position[0]>5?[10,0,0]:[0,1,0]}))
  try{for(const [face,position,expected]of [[0,[.2,.3,0],[0,1,0]],[1,[10.2,.3,0],[10,0,0]]] as const){const p=bake.at(face,[...position]);p.vertex.forEach((v,c)=>assert.ok(Math.abs(v-expected[c])<1e-5));p.lightmap.forEach((v,c)=>assert.ok(Math.abs(v-expected[c])<1e-5))}assert.equal(bake.geometry.attributes.giNextIrradiance.count,6);assert.equal(bake.metadata.padding,2)}finally{bake.dispose();geometry.dispose();material.dispose()}
})
