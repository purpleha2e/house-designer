// Rebuild the reference-inspired island: node scripts/generate-waterfall-island.mjs
// Metres; floor at Y=0, cabinet front at +Z. Independent of existing house assets.
import { Document, NodeIO } from '@gltf-transform/core'
import { KHRTextureBasisu } from '@gltf-transform/extensions'
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, CylinderGeometry, TubeGeometry, CatmullRomCurve3, Vector3, Color } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import sharp from 'sharp'
import { encodeToKTX2 } from 'ktx2-encoder'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { exportBlenderIsland } from './export-waterfall-island-blender.mjs'

const output='src/models/assets/waterfall_shaker_island.glb'
const document=new Document(), buffer=document.createBuffer(), parts=new Map()
const scene=document.createScene('Ivory waterfall shaker island')
document.getRoot().setDefaultScene(scene)
const root=document.createNode('waterfall_shaker_island').setExtras({
  width:2.4,depth:1.05,worktopHeight:.92,units:'metres',front:'+Z',
  description:'Ivory veined waterfall end, grey inset shaker cabinetry, apron sink and aged bronze bridge tap',
})
scene.addChild(root)
function material(name,hex,roughness,metalness=0){
  const c=new Color(hex)
  const m=document.createMaterial(name).setBaseColorFactor([c.r,c.g,c.b,1]).setRoughnessFactor(roughness).setMetallicFactor(metalness)
  parts.set(m,[]);return m
}
const stone=material('Ivory veined stone','#ffffff',.23)
const paint=material('Warm grey shaker cabinetry','#666b65',.48)
const ceramic=material('Ivory fireclay sink','#f8f6ef',.19)
const bronze=material('Aged bronze hardware','#574733',.34,.82)
const recess=material('Cabinet and drain recesses','#292c29',.86)

// A single 1K atlas, with fine branching mineral veins. Unfolded mapping makes
// the veining continuous from the top across the left waterfall corner.
let seed=821
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
const lines=[]
for(let n=0;n<9;n++){
  let x=-210+n*192+(random()-.5)*120,y=-80,points=[[x,y]]
  const slope=(random()-.25)*45
  for(let i=0;i<40;i++){x+=slope+(random()-.5)*47;y+=31;points.push([x,y])}
  const d=points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const width=1+random()*3.8
  lines.push(`<path d="${d}" fill="none" stroke="#b7a48a" opacity=".24" stroke-width="${width*8}" filter="url(#soft)"/><path d="${d}" fill="none" stroke="#927146" opacity=".65" stroke-width="${width}" filter="url(#fracture)"/><path d="${d}" fill="none" stroke="#d5c4a6" opacity=".65" stroke-width="${width*.3}"/>`)
  for(let j=3;j<37;j+=4){const [bx,by]=points[j];let x=bx,y=by,d=`M${x},${y}`;for(let k=0;k<8;k++){x-=7+random()*24;y+=9+random()*18;d+=`L${x},${y}`}lines.push(`<path d="${d}" fill="none" stroke="#9b8059" opacity=".48" stroke-width="${.5+random()}" filter="url(#fracture)"/>`)}
}
const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><filter id="soft"><feGaussianBlur stdDeviation="3"/></filter><filter id="fracture" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="3" seed="7" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="13" xChannelSelector="R" yChannelSelector="G"/></filter><filter id="grain"><feTurbulence baseFrequency=".017" numOctaves="4" seed="9"/><feColorMatrix type="saturate" values="0"/></filter></defs><rect width="1024" height="1024" fill="#eee8d9"/><rect width="1024" height="1024" filter="url(#grain)" opacity=".065"/>${lines.join('')}</svg>`)
const png=await sharp(svg).png().toBuffer()
const ktx=await encodeToKTX2(new Uint8Array(png),{
  compressionLevel:2,enableRDO:false,generateMipmap:true,isKTX2File:true,
  isPerceptual:true,isSetKTX2SRGBTransferFunc:true,isUASTC:false,qualityLevel:220,
  imageDecoder:async bytes=>{const {data,info}=await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {data:new Uint8Array(data),width:info.width,height:info.height}},
})
document.createExtension(KHRTextureBasisu).setRequired(true)
stone.setBaseColorTexture(document.createTexture('Ivory stone 1024').setImage(ktx).setMimeType('image/ktx2'))
function add(geometry,position,m,rotation){
  if(rotation){geometry.rotateX(rotation[0]);geometry.rotateY(rotation[1]);geometry.rotateZ(rotation[2])}
  geometry.translate(...position)
  if(m===stone){const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv
    for(let i=0;i<p.count;i++){
      // Wall's unfolded X joins exactly to the top's X=-1.2 edge.
      const x=Math.abs(n.getX(i))>.5 ? -1.2-(.92-p.getY(i)) : p.getX(i)
      uv.setXY(i,(x+2.2)/3.5,(p.getZ(i)+.525)/1.05)
    }
  }
  const flat=geometry.index?geometry.toNonIndexed():geometry
  if(flat!==geometry)geometry.dispose()
  parts.get(m).push(flat)
}
function box(size,position,m=paint,bevel=.0015){add(bevel?new RoundedBoxGeometry(...size,1,Math.min(bevel,...size.map(v=>v/4))):new BoxGeometry(...size),position,m)}
function cylinder(r1,r2,height,position,m=bronze){add(new CylinderGeometry(r1,r2,height,12),position,m)}
function tube(points,radius=.012,m=bronze,segments=28){add(new TubeGeometry(new CatmullRomCurve3(points.map(p=>new Vector3(...p))),segments,radius,8,false),[0,0,0],m)}

// Stone slab, with an actual apron-sink notch (no worktop crossing the basin).
const sx=.22,sw=.80,left=sx-sw/2,right=sx+sw/2
box([left+1.2,.035,1.05],[(-1.2+left)/2,.9025,0],stone,.002)
box([1.2-right,.035,1.05],[(right+1.2)/2,.9025,0],stone,.002)
box([sw,.035,.52],[sx,.9025,-.265],stone,.002)
box([.035,.885,1.05],[-1.1825,.4425,0],stone,.002)

// Recessed plinth, rigid carcass and panelled rear beneath the seating overhang.
box([2.29,.09,.67],[.0175,.055,.09],recess)
box([2.28,.76,.025],[.015,.49,-.245])
box([.025,.79,.75],[1.1575,.49,.12])
box([2.28,.025,.72],[.015,.1125,.12])
box([.045,.775,.75],[-1.14,.4975,.12])
for(const x of [left-.035,right+.035])box([.04,.77,.72],[x,.5,.12])

function door(x,y,w,h,z=.49,back=false){
  const dir=back?-1:1, rail=.064, depth=.027
  box([w,h,.012],[x,y,z-dir*.019],recess,0)
  box([w-2*rail+.008,h-2*rail+.008,.018],[x,y,z-dir*.011],paint)
  for(const sign of [-1,1]){
    box([rail,h,depth],[x+sign*(w-rail)/2,y,z],paint)
    box([w-2*rail,rail,depth],[x,y+sign*(h-rail)/2,z],paint)
  }
  if(!back){
    // Shallow inset finger pull, with a painted lower lip and dark interior.
    box([.105,.018,.002],[x,y+h/2-.037,z+.0145],recess,.0005)
    box([.105,.004,.004],[x,y+h/2-.045,z+.016],paint,.0005)
    for(const hingeY of [y-h*.28,y+h*.28])cylinder(.0035,.0035,.032,[x-w/2+.006,hingeY,z+.015])
  }
}
const frontTop=.88,frontBottom=.11
door((-1.13+left-.04)/2,(frontTop+frontBottom)/2,left-.04+1.13,frontTop-frontBottom)
door((right+.04+1.14)/2,(frontTop+frontBottom)/2,1.14-right-.04,frontTop-frontBottom)
for(const side of [-1,1])door(sx+side*.198,.386,.386,.542)
for(const x of [-.76,0,.76])door(x,.49,.748,.74,-.263,true)
// Right end inset panel; use the same material so it stays in one draw.
box([.008,.60,.57],[1.173,.49,.12],recess)
box([.010,.58,.55],[1.179,.49,.12],paint)

// Fireclay basin: continuous rounded rectangular rings form rim, inner walls
// and sloping bowl. The central opening is genuinely hollow and has a drain.
function ring(w,d,r,y,z){const points=[];for(const [cx,cz,start]of [[w/2-r,d/2-r,0],[-w/2+r,d/2-r,Math.PI/2],[-w/2+r,-d/2+r,Math.PI],[w/2-r,-d/2+r,Math.PI*1.5]])for(let i=0;i<8;i++){const a=start+i*Math.PI/16;points.push([sx+cx+r*Math.cos(a),y,z+cz+r*Math.sin(a)])}return points}
const rings=[ring(.80,.54,.045,.67,.255),ring(.80,.54,.045,.91,.255),ring(.785,.525,.045,.921,.255),ring(.715,.455,.055,.921,.255),ring(.70,.44,.055,.902,.255),ring(.64,.38,.07,.727,.255),ring(.58,.32,.085,.714,.255)]
function skin(rings,m){const pos=[],uv=[];for(let r=0;r<rings.length-1;r++)for(let i=0;i<rings[r].length;i++){const j=(i+1)%rings[r].length;for(const p of [rings[r][i],rings[r+1][i],rings[r][j],rings[r][j],rings[r+1][i],rings[r+1][j]]){pos.push(...p);uv.push(0,0)}}const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(pos,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.computeVertexNormals();add(g,[0,0,0],m)}
skin(rings,ceramic)
// Bottom slopes to an inset drain; ring correspondence keeps the surface open.
const drainRing=Array.from({length:32},(_,i)=>{const a=i*Math.PI/16;return[sx+.024*Math.cos(a),.709,.255+.024*Math.sin(a)]})
skin([rings.at(-1),drainRing],ceramic)
cylinder(.024,.024,.002,[sx,.707,.255],bronze)
cylinder(.014,.014,.002,[sx,.7082,.255],recess)
for(let i=0;i<6;i++){const a=i*Math.PI/3;cylinder(.002,.002,.002,[sx+Math.cos(a)*.019,.7085,.255+Math.sin(a)*.019],recess)}

// Traditional bronze bridge mixer, including flared feet and cross handles.
for(const x of [sx-.14,sx+.14]){
  cylinder(.026,.032,.014,[x,.928,-.066])
  cylinder(.012,.021,.038,[x,.954,-.066])
  cylinder(.013,.013,.10,[x,1.023,-.066])
  cylinder(.022,.015,.032,[x,1.080,-.066])
  cylinder(.007,.007,.027,[x,1.109,-.066])
  tube([[x-.033,1.125,-.066],[x+.033,1.125,-.066]],.005,bronze,1)
  tube([[x,1.125,-.099],[x,1.125,-.033]],.005,bronze,1)
}
tube([[sx-.14,1.04,-.066],[sx,1.04,-.066],[sx+.14,1.04,-.066]],.014,bronze,2)
tube([[sx,1.035,-.066],[sx,1.18,-.066],[sx,1.34,-.055],[sx,1.405,.045],[sx,1.39,.16],[sx,1.30,.22],[sx,1.245,.22]],.014,bronze,40)
cylinder(.018,.017,.023,[sx,1.244,.22])

// Exactly one primitive per material, no transparent or double-sided parts.
let triangles=0
for(const [m,geometries]of parts){
  const merged=mergeGeometries(geometries,false)
  const p=document.createPrimitive().setMaterial(m)
  for(const [attr,semantic,type]of [['position','POSITION','VEC3'],['normal','NORMAL','VEC3'],['uv','TEXCOORD_0','VEC2']])p.setAttribute(semantic,document.createAccessor().setType(type).setArray(merged.attributes[attr].array).setBuffer(buffer))
  root.addChild(document.createNode(m.getName()).setMesh(document.createMesh(m.getName()).addPrimitive(p)))
  triangles+=merged.attributes.position.count/3
  geometries.forEach(g=>g.dispose());merged.dispose()
}
const io=new NodeIO().registerExtensions([KHRTextureBasisu])
await io.write(output,document)
await mkdir('tmp/waterfall-island',{recursive:true})
await writeFile('tmp/waterfall-island/stone.png',png)
await exportBlenderIsland(new Uint8Array(png))
const report={output,bytes:(await stat(output)).size,triangles,drawCalls:parts.size,textures:1,textureResolution:1024,textureBytes:ktx.length,width:2.4,depth:1.05,worktopHeight:.92}
await writeFile('tmp/waterfall-island/model-report.json',JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
