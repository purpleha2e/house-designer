import { NodeIO } from '@gltf-transform/core'
const doc = await new NodeIO().read(process.argv[2] ?? 'src/models/assets/patio_doors.glb')
const root = doc.getRoot()
console.log(JSON.stringify({
  nodes: root.listNodes().map(node => ({name:node.getName(),translation:node.getTranslation(),rotation:node.getRotation(),scale:node.getScale(),mesh:node.getMesh()?.getName(),children:node.listChildren().map(n=>n.getName())})),
  meshes: root.listMeshes().map(mesh=>({name:mesh.getName(),primitives:mesh.listPrimitives().map(p=>({material:p.getMaterial()?.getName(),vertices:p.getAttribute('POSITION').getCount(),min:p.getAttribute('POSITION').getMin([]),max:p.getAttribute('POSITION').getMax([])}))})),
  materials:root.listMaterials().map(m=>({name:m.getName(),color:m.getBaseColorFactor(),metalness:m.getMetallicFactor(),roughness:m.getRoughnessFactor(),alphaMode:m.getAlphaMode(),doubleSided:m.getDoubleSided()})),
},null,2))
