import { BoxGeometry, BufferGeometry, CylinderGeometry, DataTexture, ExtrudeGeometry, Float32BufferAttribute, Group, LinearFilter,
  LinearMipmapLinearFilter, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Path, RepeatWrapping, Shape, SRGBColorSpace } from 'three'
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import { DEFAULT_DOOR_GROOVE_COLOR, DOOR_CASING_WIDTH, DOOR_LEAF_FLOOR_GAP, getDoorHandleHeight, getDoorHingeSide, getDoorOpeningSize, getDoorSwingSign,
  type DoorAngles, type DoorDesign, type DoorFrameProfile } from './doorDesign.ts'
import { kitchenHandleFinishes } from './kitchenUnitDesign.ts'
import type { MaterialTextureTransform } from './types.ts'

let oakTexture: DataTexture | undefined
function getOakTexture() {
  if (oakTexture) return oakTexture
  const width = 256, height = 512
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width * Math.PI * 2, v = y / height * Math.PI * 2
    const grain = u + .12 * Math.sin(v + u * 2) + .065 * Math.sin(2 * v - u * 3) + .024 * Math.sin(4 * v + u * 5)
    const pores = Math.pow(Math.max(0, Math.sin(grain * 43 + .8 * Math.sin(v * 4))), 12)
    const shade = 7 * Math.sin(grain * 8) + 4 * Math.sin(grain * 19) + 2 * Math.sin(grain * 63) - 9 * pores
    const index = (y * width + x) * 4
    data.set([208 + shade, 168 + shade, 111 + shade * .8, 255], index)
  }
  oakTexture = new DataTexture(data, width, height)
  oakTexture.wrapS = oakTexture.wrapT = RepeatWrapping
  oakTexture.colorSpace = SRGBColorSpace
  oakTexture.magFilter = LinearFilter
  oakTexture.minFilter = LinearMipmapLinearFilter
  oakTexture.generateMipmaps = true
  oakTexture.anisotropy = 4
  oakTexture.needsUpdate = true
  return oakTexture
}

type Rect = { x: number; y: number; w: number; h: number }

function subtractPanel(rect: Rect, panel: Rect): Rect[] {
  const left = Math.max(rect.x, panel.x), right = Math.min(rect.x + rect.w, panel.x + panel.w)
  const bottom = Math.max(rect.y, panel.y), top = Math.min(rect.y + rect.h, panel.y + panel.h)
  if (left >= right || bottom >= top) return [rect]
  return [
    { x: rect.x, y: rect.y, w: rect.w, h: bottom - rect.y },
    { x: rect.x, y: top, w: rect.w, h: rect.y + rect.h - top },
    { x: rect.x, y: bottom, w: left - rect.x, h: top - bottom },
    { x: right, y: bottom, w: rect.x + rect.w - right, h: top - bottom },
  ].filter(piece => piece.w > 1e-6 && piece.h > 1e-6)
}

function plankSpacing(planks: Rect[], horizontal: boolean) {
  const maxSpacing = .008
  const spans = horizontal ? planks.map(({ x, y, w, h }) => ({ x: y, y: x, w: h, h: w })) : planks
  let spacing = 0
  for (const left of spans) for (const right of spans) {
    const gap = right.x - (left.x + left.w)
    const overlap = Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y)
    if (gap > spacing && gap <= maxSpacing && overlap > 0) spacing = gap
  }
  return spacing
}

function plankRecess(panel: Rect, leaf: Rect, margin: number): Rect {
  const edge = .002
  const x = Math.max(leaf.x + edge, panel.x - margin)
  const y = Math.max(leaf.y + edge, panel.y - margin)
  const right = Math.min(leaf.x + leaf.w - edge, panel.x + panel.w + margin)
  const top = Math.min(leaf.y + leaf.h - edge, panel.y + panel.h + margin)
  return { x, y, w: right - x, h: top - y }
}

function mapGrain(geometry: BufferGeometry, horizontal: boolean, phase: number, mapping?: MaterialTextureTransform) {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uvs = geometry.getAttribute('uv')
  const rotation = ((mapping?.textureRotation ?? 0) % 360) * Math.PI / 180
  const cos = Math.cos(rotation), sin = Math.sin(rotation)
  const scale = mapping?.textureScale ?? 1
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index)
    const across = horizontal ? y : x, along = horizontal ? x : y
    const normalAcross = horizontal ? normals.getY(index) : normals.getX(index)
    const normalAlong = horizontal ? normals.getX(index) : normals.getY(index)
    const endGrain = Math.abs(-normalAcross * sin + normalAlong * cos) > .8
    const narrow = across * cos + along * sin + (endGrain ? 0 : z)
    const length = endGrain ? z : -across * sin + along * cos
    uvs.setXY(index, narrow / (.43 * scale) + phase * .137, length / (1.8 * scale) + phase * .063)
  }
  return geometry
}

function frameFace(style: DoorFrameProfile, jambWidth: number, innerDepth: number, wallFace: number, projection: number) {
  const profile = new Path().moveTo(-jambWidth, innerDepth)
  const outer = DOOR_CASING_WIDTH
  const z = (height: number) => wallFace + height * projection
  const corner = (u: number, height: number) => profile.lineTo(u * outer, z(height))
  const curve = (u1: number, h1: number, u2: number, h2: number, u: number, height: number) =>
    profile.bezierCurveTo(u1 * outer, z(h1), u2 * outer, z(h2), u * outer, z(height))

  if (style === 'plain') {
    const step = z(.34)
    const middle = (innerDepth + step) / 2
    profile.lineTo(-jambWidth * .86, innerDepth).lineTo(-jambWidth * .86, middle)
      .lineTo(-jambWidth * .69, middle).lineTo(-jambWidth * .69, step)
    corner(.25, .34).lineTo(outer * .25, z(1))
  } else if (style === 'curved') {
    const shoulder = z(.71)
    const tangent = .45 * projection / outer
    profile.bezierCurveTo(-jambWidth * .94, (innerDepth + shoulder) / 2,
      -jambWidth * .38, shoulder - tangent * jambWidth * .38, 0, shoulder)
    curve(.20, .80, .39, 1, .64, 1)
  } else {
    const shoulder = z(.18)
    profile.bezierCurveTo(-jambWidth * .94, (innerDepth + shoulder) / 2,
      -jambWidth * .38, shoulder - (shoulder - innerDepth) * .14, 0, shoulder)
    curve(.025, .35, .095, .43, .15, .27)
    corner(.18, .27).lineTo(outer * .18, z(.42))
    curve(.23, .62, .30, .59, .37, .43)
    curve(.44, .35, .52, .60, .56, .80)
    corner(.59, .80).lineTo(outer * .59, z(.91))
    corner(.66, .91).lineTo(outer * .66, z(1))
  }
  return corner(1, 1).getPoints(10)
}

function frameProfile(style: DoorFrameProfile, jambWidth: number, leafHalf: number, wallFace: number, projection: number, swingFace: number) {
  const seat = leafHalf + .00035
  const stopDepth = Math.max(0, Math.min(.012, (wallFace - seat) * .8))
  const swingDepth = Math.min(leafHalf, wallFace)
  const stopFace = stopDepth > .001 ? seat + stopDepth : swingDepth
  const front = frameFace(style, jambWidth, swingDepth, wallFace, projection)
  const back = frameFace(style, jambWidth, stopFace, wallFace, projection)
  const backing = wallFace - projection * .035

  const profile = new Shape().moveTo(-jambWidth, swingFace * swingDepth)
  for (const { x, y } of front.slice(1)) profile.lineTo(x, swingFace * y)
  // The wall fits into the back of the two casing flanges.
  profile.lineTo(DOOR_CASING_WIDTH, swingFace * backing).lineTo(0, swingFace * backing)
    .lineTo(0, -swingFace * backing).lineTo(DOOR_CASING_WIDTH, -swingFace * backing)
  for (const { x, y } of back.reverse()) profile.lineTo(x, -swingFace * y)
  if (stopDepth > .001) {
    const stopEdge = -jambWidth - Math.min(.012, jambWidth * .6)
    profile.lineTo(stopEdge, -swingFace * stopFace).lineTo(stopEdge, -swingFace * seat)
      .lineTo(-jambWidth, -swingFace * seat)
  }
  return profile.closePath()
}

/** Sweep the cross-section around the opening, meeting on a common mitre plane. */
function sweepFrame(profile: Shape, opening: { width: number; height: number }, part: -1 | 1 | 'head', smooth: boolean) {
  const geometry = new ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false, curveSegments: 10 })
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    const offset = positions.getX(i), depth = positions.getY(i), step = positions.getZ(i)
    const span = opening.width / 2 + offset, height = opening.height + offset
    if (part === 'head') positions.setXYZ(i, (2 * step - 1) * span, height, depth)
    else positions.setXYZ(i, part * span, (part < 0 ? step : 1 - step) * height, depth)
  }
  geometry.computeVertexNormals()
  return mapGrain(smooth ? toCreasedNormals(geometry, Math.PI / 5) : geometry, part === 'head', part === 'head' ? 0 : part)
}

function raisedPanel(w: number, h: number, thickness: number) {
  const bevel = Math.min(.013, w * .2, h * .2)
  const x = w / 2 - bevel, y = h / 2 - bevel
  const profile = new Shape().moveTo(-x, -y).lineTo(x, -y).lineTo(x, y).lineTo(-x, y).closePath()
  const bevelDepth = thickness * .14
  const depth = thickness - 2 * bevelDepth
  return new ExtrudeGeometry(profile, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevelDepth, bevelSegments: 2 })
    .translate(0, 0, -depth / 2)
}

// Cross-section measured from panel_interior_door_closed.glb, from rail to panel centre.
const detailedPanelProfile = [
  [0, .065], [.035, .09], [.07, .155], [.12, .23], [.18, .235], [.22, .29],
  [.26, .50], [.31, .54], [.36, .63], [.43, 1], [.52, 1], [.57, .93],
  [.89, .29], [.93, .16], [.97, .04], [1, 0],
] as const

function detailedRaisedPanel(width: number, height: number, thickness: number) {
  const band = Math.min(.056, Math.min(width, height) * .32)
  const relief = Math.min(thickness * .26, band * .24)
  const positions: number[] = []
  const rings = detailedPanelProfile.map(([inset, depth]) => {
    const x = width / 2 - band * inset, y = height / 2 - band * inset
    return { x, y, z: thickness * .49 - depth * relief }
  })
  const corners = ({ x, y, z }: typeof rings[number], face: number) =>
    [[-x, -y, z * face], [x, -y, z * face], [x, y, z * face], [-x, y, z * face]]
  const quad = (a: number[], b: number[], c: number[], d: number[]) => positions.push(...a, ...b, ...c, ...a, ...c, ...d)
  for (const face of [-1, 1]) {
    const sections = rings.map(ring => corners(ring, face))
    for (let band = 0; band < sections.length - 1; band++) {
      const outer = sections[band], inner = sections[band + 1]
      for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4
        if (face > 0) quad(outer[i], outer[next], inner[next], inner[i])
        else quad(outer[next], outer[i], inner[i], inner[next])
      }
    }
    const [a, b, c, d] = sections[sections.length - 1]
    if (face > 0) quad(a, b, c, d)
    else quad(a, d, c, b)
  }
  const front = corners(rings[0], 1), back = corners(rings[0], -1)
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4
    quad(back[i], back[next], front[next], front[i])
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2))
  geometry.computeVertexNormals()
  return toCreasedNormals(geometry, Math.PI / 9)
}

export function setDoorLeafAngles(group: Group, design: DoorDesign, angles: DoorAngles) {
  for (let index = 0; index < design.leafCount; index++) {
    const leaf = group.getObjectByName(`door-leaf-${index}`)
    if (leaf) leaf.rotation.y = getDoorSwingSign(design, index) * angles[index] * Math.PI / 180
  }
}

export function createDoorGeometry(design: DoorDesign, wallThickness = .1, instanceDepthScale = 1) {
  const group = new Group()
  const wood = new MeshStandardMaterial({ name: 'hd_oak', map: getOakTexture(), color: '#ffffff', roughness: .51 })
  const frame = wood.clone()
  frame.name = 'hd_frame'
  const finish = kitchenHandleFinishes[design.handleFinish]
  const metal = new MeshPhysicalMaterial({ name: 'hd_handle', color: finish.color, metalness: finish.metalness,
    roughness: finish.roughness, anisotropy: finish.anisotropy })
  const opening = getDoorOpeningSize(design)
  const { width, height, thickness, jambWidth } = design
  const swingFace = design.swing === 'front' ? 1 : -1
  const hingeZ = swingFace * thickness / 2
  const leafCentre = -hingeZ
  const wallFace = wallThickness / (2 * instanceDepthScale)
  const projection = design.frameProjection / instanceDepthScale
  const style = design.frameProfile ?? 'plain'
  const planked = design.style !== 'raised'
  const panelGap = planked ? .004 : .0022
  const panelThickness = planked ? thickness - .006 : thickness * .82
  const addWood = (owner: Group, name: string, pieces: BufferGeometry[], material: MeshStandardMaterial) => {
    const geometry = mergeGeometries(pieces, false)
    pieces.forEach(piece => piece.dispose())
    if (!geometry) throw new Error('Could not build door woodwork.')
    const mesh = new Mesh(geometry, material)
    mesh.name = name
    owner.add(mesh)
  }
  const timber = (w: number, h: number, d: number, x: number, y: number, z: number, horizontal: boolean, phase = 0,
    mapping?: MaterialTextureTransform) => {
    const box = new BoxGeometry(w, h, d)
    const mapped = mapGrain(box, horizontal, phase, mapping).toNonIndexed()
    box.dispose()
    return mapped.translate(x, y, z)
  }

  const profile = frameProfile(style, jambWidth, thickness / 2, wallFace, projection, swingFace)
  const framePieces = ([-1, 1, 'head'] as const).map(part => sweepFrame(profile, opening, part, style !== 'plain'))
  addWood(group, 'door-frame', framePieces, frame)

  let grooveMaterial: MeshStandardMaterial | undefined
  for (let index = 0; index < design.leafCount; index++) {
    const leaf = new Group()
    leaf.name = `door-leaf-${index}`
    const side = getDoorHingeSide(design, index)
    leaf.position.set(side * (opening.width / 2 - jambWidth - .003), DOOR_LEAF_FLOOR_GAP, hingeZ)
    group.add(leaf)
    const xMin = side < 0 ? 0 : -width
    const panels = design.panels.map(panel => ({ x: xMin + panel.left * width, y: panel.bottom * height,
      w: panel.width * width, h: panel.height * height }))
    const leafRect = { x: xMin, y: 0, w: width, h: height }
    const margin = panelGap / 2 + plankSpacing(panels, design.style === 'horizontal')
    const insets = planked ? panels.map(panel => plankRecess(panel, leafRect, margin)) : panels
    const field = insets.reduce((pieces, inset) => pieces.flatMap(piece => subtractPanel(piece, inset)), [leafRect])
    const pieces = field.map(({ x, y, w, h }, i) => timber(w, h, thickness, x + w / 2, y + h / 2, leafCentre, w > h, i, design.leafTexture))
    if (panels.length) pieces.push(timber(width - .002, height - .002, thickness * .42,
      xMin + width / 2, height / 2, leafCentre, false, 0, design.leafTexture))
    panels.forEach(({ x, y, w, h }, i) => {
      const mapping = { ...design.panels[i], ...design.panelTexture }
      if (design.style === 'raised') {
        const panel = design.panelDetail === 'detailed' ? detailedRaisedPanel(w - panelGap, h - panelGap, thickness) :
          raisedPanel(w - panelGap, h - panelGap, panelThickness)
        pieces.push(mapGrain(panel, false, i + 2, mapping).translate(x + w / 2, y + h / 2, leafCentre))
      } else pieces.push(timber(w - panelGap, h - panelGap, panelThickness, x + w / 2, y + h / 2, leafCentre, design.style === 'horizontal', i + 2, mapping))
    })
    addWood(leaf, 'door-leaf-woodwork', pieces, wood)
    if (planked && panels.length) {
      grooveMaterial ??= new MeshStandardMaterial({ name: 'door-plank-groove', color: design.grooveColor ?? DEFAULT_DOOR_GROOVE_COLOR, roughness: .8 })
      // Adjacent recesses overlap. Subdivide the backing so their faces are coplanar without covering each other.
      const channels = insets.flatMap((inset, i) => insets.slice(0, i)
        .reduce((pieces, other) => pieces.flatMap(piece => subtractPanel(piece, other)), [inset]))
        .map(({ x, y, w, h }) => timber(w, h, panelThickness - .002, x + w / 2, y + h / 2, leafCentre, false))
      addWood(leaf, 'door-plank-grooves', channels, grooveMaterial)
    }

    const addHardware = (name: string, geometry: BufferGeometry, x: number, y: number, z: number, handle = false) => {
      const mesh = new Mesh(geometry, metal)
      mesh.name = name
      mesh.position.set(x, y, z)
      if (handle) mesh.userData.doorHandleLeaf = index
      leaf.add(mesh)
      return mesh
    }
    for (const heightRatio of [.14, .51, .86]) addHardware('hinge', new CylinderGeometry(.007, .007, .076, 12), 0, height * heightRatio, 0)
    const handleX = -side * (width - .058), handleY = getDoorHandleHeight(design) - DOOR_LEAF_FLOOR_GAP
    for (const face of [-1, 1]) {
      const faceZ = face * thickness / 2 + leafCentre
      addHardware('handle-rosette', new CylinderGeometry(.024, .025, .008, 20), handleX, handleY, faceZ + face * .004, true).rotation.x = Math.PI / 2
      addHardware('handle-neck', new CylinderGeometry(.01, .01, .047, 16), handleX, handleY, faceZ + face * .025, true).rotation.x = Math.PI / 2
      addHardware('door-handle', new CylinderGeometry(.009, .01, .102, 18), handleX + side * .045, handleY, faceZ + face * .047, true).rotation.z = Math.PI / 2
    }
  }
  return group
}
