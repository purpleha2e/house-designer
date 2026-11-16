// Dimensioned visual concept, not a fabrication drawing or certified child bed.
// Run: node scripts/generate-junior-cabin-bed.mjs
import { Document, NodeIO } from '@gltf-transform/core'
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, CylinderGeometry, TubeGeometry,
  CatmullRomCurve3, Vector3, Quaternion, Color, Shape, Path, ExtrudeGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import assert from 'node:assert/strict'

const output = 'exports/junior-cabin-bed-spindles-left-hd.glb'
const doc = new Document(), buffer = doc.createBuffer('Bed geometry'), parts = new Map()
const scene = doc.createScene('Juniper • compact cabin bed')
doc.getRoot().setDefaultScene(scene)
const dimensions = {
  units: 'metres', frameLength: 1.91, frameWidth: .85, platformHeight: .80,
  mattressLength: 1.90, mattressWidth: .75, mattressThickness: .12,
  mattressTop: .92, guardrailTop: 1.14, hangingRailHeight: .68,
  hangingCompartmentFloor: .055, accessOpeningWidth: .38,
  barrierStyle: 'rounded vertical spindles', ladderSide: 'left', drawerSide: 'right',
  requiredWallLength: 1.92, orientation: 'Y up; long axis X; access at +Z; head at +X, opposite the left ladder',
  constructionNote: 'Visual concept only. End structures are beneath or above the mattress, not a conventional thick-walled mattress box. Actual mattress tolerances, wall/skirting clearance, structure and child safety require professional review. Raised version is not recommended for a child under six.',
}
const root = doc.createNode('Juniper cabin bed • 191 × 85 cm').setExtras(dimensions)
scene.addChild(root)
function material(name, hex, roughness) {
  const c = new Color(hex)
  const mat = doc.createMaterial(name).setBaseColorFactor([c.r, c.g, c.b, 1])
    .setRoughnessFactor(roughness).setMetallicFactor(0)
  parts.set(mat, []); return mat
}
const frame = material('hd_frame', '#e6decc', .64)
const ladder = material('hd_ladder', '#caa77a', .57)
const drawers = material('hd_drawer_fronts', '#819b8b', .57)
const mattress = material('hd_mattress', '#ede9df', .94)
const pillow = material('hd_pillow', '#fff6e8', .95)
const quilt = material('hd_quilt', '#628c9c', .96)

// Independent UV0 coordinates on every surface. Hard parts use a consistent
// 50 cm repeat in their local axes; textiles use an overall 0–1 layout.
function hardUV(g) {
  const p = g.attributes.position, n = g.attributes.normal, uv = []
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i))
    uv.push(...(ay >= ax && ay >= az ? [p.getX(i)*2, p.getZ(i)*2]
      : ax >= az ? [p.getZ(i)*2, p.getY(i)*2] : [p.getX(i)*2, p.getY(i)*2]))
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
}
let mirrorX = false
function add(g, pos, mat, rotation, textile = false) {
  if (!textile) hardUV(g)
  if (rotation instanceof Quaternion) g.applyQuaternion(rotation)
  else if (rotation) { g.rotateX(rotation[0]); g.rotateY(rotation[1]); g.rotateZ(rotation[2]) }
  g.translate(...pos)
  const flat = g.index ? g.toNonIndexed() : g
  if (flat !== g) g.dispose()
  if (mirrorX) {
    flat.scale(-1,1,1)
    // Restore outward winding after reflection, preserving normals and UVs.
    for (const attr of Object.values(flat.attributes)) for (let i=0;i<attr.count;i+=3)
      for (let c=0;c<attr.itemSize;c++) {
        const a=(i+1)*attr.itemSize+c,b=(i+2)*attr.itemSize+c,t=attr.array[a]
        attr.array[a]=attr.array[b];attr.array[b]=t
      }
  }
  parts.get(mat).push(flat)
}
function box(size, pos, mat = frame, radius = .004, rotation) {
  const g = radius ? new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(x=>x/2.1))) : new BoxGeometry(...size)
  add(g, pos, mat, rotation)
}
function beam(a, b, width, depth, mat = frame, radius = .006) {
  const p = new Vector3(...a), q = new Vector3(...b), direction = q.clone().sub(p)
  box([width, direction.length(), depth], p.clone().add(q).multiplyScalar(.5).toArray(), mat, radius,
    new Quaternion().setFromUnitVectors(new Vector3(0,1,0), direction.normalize()))
}
function rod(a, b, radius, mat = frame) {
  const p = new Vector3(...a), q = new Vector3(...b), d = q.clone().sub(p)
  add(new CylinderGeometry(radius, radius, d.length(), 12), p.clone().add(q).multiplyScalar(.5).toArray(), mat,
    new Quaternion().setFromUnitVectors(new Vector3(0,1,0), d.normalize()))
}
function tube(points, radius, mat, segments = 30, closed = false) {
  add(new TubeGeometry(new CatmullRomCurve3(points.map(p=>new Vector3(...p)), closed, 'centripetal'),
    segments, radius, 6, closed), [0,0,0], mat)
}

// Main load-bearing concept stays below the mattress; the upper end guards
// rise above it. Thick conventional end boards cannot fit 190 cm into 192 cm.
for (const x of [-.925, .925]) for (const z of [-.403, .403]) {
  box([.06, 1.14, .044], [x, .57, z], frame, .010)
}
for (const z of [-.403, .403]) box([1.91, .14, .044], [0, .73, z], frame, .007)
for (const x of [-.925, .925]) box([.06, .14, .806], [x, .73, 0], frame, .005)
for (let i = 0; i < 22; i++) box([.062, .024, .79], [-.889+i*(1.778/21), .788, 0], frame, .002)
// Open, vertical spindle guards, including the head and foot. End guards
// remain above the mattress so they do not consume its 190 cm length.
// Nominal gaps are <=45 mm; this is geometry, not a safety certification.
function spindleBarrier(axis,start,end,cross,bottom,top) {
  const length=end-start, thickness=axis==='x'?.042:.028
  const position=(along,y)=>axis==='x'?[along,y,cross]:[cross,y,along]
  const size=(along,height)=>axis==='x'?[along,height,thickness]:[thickness,height,along]
  for(const y of [bottom+.0175,top-.0175])box(size(length,.035),position((start+end)/2,y),frame,.008)
  for(const along of [start+.014,end-.014])box(size(.028,top-bottom),position(along,(bottom+top)/2),frame,.006)
  const clear=length-.056,diameter=.024,count=Math.max(1,Math.ceil((clear-.045)/(diameter+.045)))
  const gap=(clear-count*diameter)/(count+1)
  assert.ok(gap>0&&gap<=.045001)
  for(let i=0;i<count;i++) {
    const along=start+.028+gap+diameter/2+i*(diameter+gap)
    rod(position(along,bottom+.03),position(along,top-.03),diameter/2,frame)
  }
}
spindleBarrier('x',-.955,.955,-.403,.80,1.14)
spindleBarrier('x',-.425,.955,.403,.80,1.14)
spindleBarrier('x',-.955,-.805,.403,.80,1.14)
for(const x of [-.925,.925])spindleBarrier('z',-.403,.403,x,.94,1.14)

// Three fully modelled drawer boxes, with rounded fronts and genuine finger
// apertures. Mirror the storage too, keeping drawers clear of the left ladder.
mirrorX = true
const left = -.885, divider = -.085, right = .885
box([right-left, .018, .735], [(left+right)/2, .046, -.008], frame, .003)
box([right-left, .03, .61], [(left+right)/2, .018, -.028], frame, .004)
for (const x of [left, divider, right]) box([.018, .605, .745], [x, .3575, -.008], frame, .004)
box([right-left, .605, .012], [0, .3575, -.374], frame, .003)

function roundedPath(w, h, r, hole = false) {
  const p = hole ? new Path() : new Shape(), x = -w/2, y = -h/2
  p.moveTo(x+r,y); p.lineTo(x+w-r,y); p.quadraticCurveTo(x+w,y,x+w,y+r)
  p.lineTo(x+w,y+h-r); p.quadraticCurveTo(x+w,y+h,x+w-r,y+h)
  p.lineTo(x+r,y+h); p.quadraticCurveTo(x,y+h,x,y+h-r)
  p.lineTo(x,y+r); p.quadraticCurveTo(x,y,x+r,y)
  return p
}
for (const y of [.155, .35, .545]) {
  const x = -.485, w = .768, h = .182
  const face = roundedPath(w, h, .012), hole = roundedPath(.145, .025, .0125, true)
  hole.curves.forEach(curve => { for (const key of ['v0','v1','v2','v3']) if (curve[key]) curve[key].y += .046 })
  face.holes.push(hole)
  add(new ExtrudeGeometry(face, { depth:.018, bevelEnabled:true, bevelSegments:2, steps:1,
    bevelSize:.0015, bevelThickness:.0015, curveSegments:6 }), [x,y,.39], drawers)
  box([.73,.012,.68], [x,y-.073,.015], frame, .002)
  for (const sx of [-1,1]) box([.014,.145,.68], [x+sx*.365,y,.015], frame, .002)
  box([.73,.145,.014], [x,y,-.325], frame, .002)
}
rod([-.067,.68,-.025],[.876,.68,-.025],.012,frame)
for (const x of [-.061,.871]) box([.014,.055,.052],[x,.672,-.025],frame,.006)
// Two illustrative hangers remain part of the Frame material group.
for (const x of [.13,.41]) {
  tube([[x,.635,-.025],[x,.66,-.025],[x,.695,-.025],[x+.024,.704,-.025],[x+.042,.686,-.025],[x+.027,.669,-.025]],.0035,frame,22)
  tube([[x,.636,-.025],[x,.584,-.19],[x,.566,-.19],[x,.56,.14],[x,.584,.14],[x,.636,-.025]],.006,frame,32)
}
mirrorX = false

// Front-mounted ladder: no extra bed length, four broad level treads, rounded
// stringers continue up as handholds. It projects ~29 cm beyond the frame.
for (const x of [-.405,-.825]) beam([x,.026,.694],[x,1.12,.432],.035,.055,ladder,.012)
for (const y of [.20,.40,.60,.80]) {
  const z = .694+(y-.026)/(1.12-.026)*(.432-.694)
  box([.42,.03,.11],[-.615,y-.015,z],ladder,.006)
  // Shallow integral tread ribs use the same replaceable ladder material.
  for (const dz of [-.029,0,.029]) box([.355,.0025,.005],[-.615,y+.0008,z+dz],ladder,.001)
}

// Mattress has an exact uncompressed 190 × 75 × 12 cm envelope.
const mattressGeometry = new RoundedBoxGeometry(1.9,.12,.75,4,.028)
add(mattressGeometry,[0,.86,0],mattress,undefined,true)
function perimeter(x0,x1,z0,z1,y,r) {
  const pts=[]
  for (const [x,z,start] of [[x1-r,z1-r,0],[x0+r,z1-r,Math.PI/2],[x0+r,z0+r,Math.PI],[x1-r,z0+r,Math.PI*1.5]])
    for(let i=0;i<8;i++){const a=start+i*Math.PI/16;pts.push([x+r*Math.cos(a),y,z+r*Math.sin(a)])}
  return pts
}
for(const y of [.818,.901])tube(perimeter(-.938,.938,-.358,.358,y,.035),.0023,mattress,96,true)

// Gently pillowed linen, with a stitched perimeter instead of a hard cuboid.
const pg = new RoundedBoxGeometry(.39,.10,.61,6,.045), pp=pg.attributes.position
for(let i=0;i<pp.count;i++){
  const x=pp.getX(i),y=pp.getY(i),z=pp.getZ(i)
  const puff=Math.max(0,1-(x/.195)**2)*Math.max(0,1-(z/.305)**2)
  pp.setY(i,y+Math.sign(y)*.018*puff + .002*Math.sin(z*35+x*14)*puff)
}
pg.computeVertexNormals();add(pg,[-.677,.977,0],pillow,undefined,true)
tube(perimeter(-.867,-.487,-.299,.299,.975,.046),.0017,pillow,90,true)

// Closed quilt surface: subtle channels, natural edge falloff and a turned
// back fold. The tessellation supports ordinary cloth textures without maps.
function cloth(x0,x1,z0,z1,height,thickness,nx,nz) {
  const positions=[],uv=[],indices=[]
  for(let layer=0;layer<2;layer++)for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){
    const u=i/nx,v=j/nz,x=x0+(x1-x0)*u,z=z0+(z1-z0)*v
    const edge=Math.sin(Math.PI*u)*Math.sin(Math.PI*v)
    const channels=.0035*Math.cos(z*75)*Math.sin(Math.PI*u)**2
    const waves=.004*Math.sin(x*24+z*11)*edge+.002*Math.sin(z*45-x*8)*edge
    const y=height+.016*edge+channels+waves-(layer?thickness:0)-.014*Math.abs(2*v-1)**10
    positions.push(x,y,z);uv.push(u,v)
  }
  const stride=nz+1,count=(nx+1)*stride
  for(let i=0;i<nx;i++)for(let j=0;j<nz;j++){
    const a=i*stride+j,b=a+stride,c=b+1,d=a+1
    indices.push(a,d,b,d,c,b,a+count,b+count,d+count,d+count,b+count,c+count)
  }
  const boundary=[]
  for(let i=0;i<=nx;i++)boundary.push(i*stride)
  for(let j=1;j<=nz;j++)boundary.push(nx*stride+j)
  for(let i=nx-1;i>=0;i--)boundary.push(i*stride+nz)
  for(let j=nz-1;j>0;j--)boundary.push(j)
  for(let i=0;i<boundary.length;i++){const a=boundary[i],b=boundary[(i+1)%boundary.length];indices.push(a,b,a+count,b,b+count,a+count)}
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals()
  add(g,[0,0,0],quilt,undefined,true)
}
cloth(-.43,.934,-.365,.365,.943,.018,62,38)
cloth(-.43,-.22,-.365,.365,.965,.014,16,38)
tube([[-.426,.959,-.354],[-.426,.972,-.18],[-.426,.977,0],[-.426,.972,.18],[-.426,.959,.354]],.004,quilt,32)

// Turn the complete bedding assembly end-for-end; UVs turn with the fabric.
for (const mat of [mattress,pillow,quilt]) for (const geometry of parts.get(mat)) geometry.rotateY(Math.PI)

let triangles=0
const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}
const materialBounds={}
for(const [mat,geometries] of parts){
  const merged=mergeGeometries(geometries,false), g=mergeVertices(merged,1e-6), primitive=doc.createPrimitive().setMaterial(mat)
  merged.dispose()
  g.computeBoundingBox();const b=g.boundingBox;materialBounds[mat.getName()]={min:b.min.toArray(),max:b.max.toArray()}
  for(let i=0;i<3;i++){bounds.min[i]=Math.min(bounds.min[i],b.min.toArray()[i]);bounds.max[i]=Math.max(bounds.max[i],b.max.toArray()[i])}
  for(const [attr,semantic,type] of [['position','POSITION','VEC3'],['normal','NORMAL','VEC3'],['uv','TEXCOORD_0','VEC2']]){
    const array=g.attributes[attr].array;assert.ok(array.every(Number.isFinite))
    primitive.setAttribute(semantic,doc.createAccessor().setType(type).setArray(array).setBuffer(buffer))
  }
  root.addChild(doc.createNode(mat.getName()).setMesh(doc.createMesh(mat.getName()).addPrimitive(primitive)))
  primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(g.index.array).setBuffer(buffer))
  triangles+=g.index.count/3
  geometries.forEach(g=>g.dispose());g.dispose()
}
const size=bounds.max.map((x,i)=>x-bounds.min[i])
assert.ok(Math.abs(size[0]-1.91)<.00001,'191 cm total length including ladder and bedding')
assert.ok(Math.abs(size[1]-1.14)<.00001,'114 cm overall guardrail height')
const mb=materialBounds['hd_mattress'];assert.ok(Math.abs(mb.max[0]-mb.min[0]-1.90)<.00001,JSON.stringify(mb));assert.ok(Math.abs(mb.max[2]-mb.min[2]-.75)<.00001,JSON.stringify(mb))
await mkdir('exports',{recursive:true});await new NodeIO().write(output,doc)
const check=await new NodeIO().read(output)
assert.equal(check.getRoot().listMaterials().length,6)
assert.equal(check.getRoot().listMeshes().length,6)
assert.equal(check.getRoot().listExtensionsRequired().length,0)
const report={output,bytes:(await stat(output)).size,triangles,materials:check.getRoot().listMaterials().map(m=>m.getName()),dimensions,bounds,size,materialBounds}
await writeFile('exports/junior-cabin-bed-spindles-left-hd-dimensions.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
