import { DoubleSide, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Path, PlaneGeometry, Shape } from 'three'
import { getPictureFrameSize, type PictureFrameDesign } from './pictureFrameDesign.ts'

function rectangle(path: Path, width: number, height: number) {
  path.moveTo(-width / 2, -height / 2)
  path.lineTo(width / 2, -height / 2)
  path.lineTo(width / 2, height / 2)
  path.lineTo(-width / 2, height / 2)
  path.closePath()
}

function moulding(name: string, color: string, width: number, height: number,
  openingWidth: number, openingHeight: number, depth: number) {
  const shape = new Shape()
  const hole = new Path()
  rectangle(shape, width, height)
  rectangle(hole, openingWidth, openingHeight)
  shape.holes.push(hole)
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 })
  const material = new MeshStandardMaterial({ name, color, roughness: .55 })
  const mesh = new Mesh(geometry, material)
  mesh.name = name
  return mesh
}

export function createPictureFrameGeometry(design: PictureFrameDesign) {
  const { width, height, depth } = getPictureFrameSize(design)
  const slipWidth = design.openingWidth + 2 * design.slipWidth
  const slipHeight = design.openingHeight + 2 * design.slipWidth
  const back = -depth / 2
  const center = height / 2
  const group = new Group()
  const frame = moulding('hd_frame', design.frameColor, width, height, slipWidth, slipHeight, depth)
  frame.position.set(0, center, back)
  group.add(frame)
  if (design.slipWidth > 0) {
    const slip = moulding('hd_slip', design.slipColor, slipWidth, slipHeight,
      design.openingWidth, design.openingHeight, design.slipDepth)
    slip.position.set(0, center, back)
    group.add(slip)
  }

  const canvas = new Mesh(new PlaneGeometry(design.openingWidth, design.openingHeight),
    new MeshStandardMaterial({ name: 'hd_image', color: '#e9e4db', roughness: .87, side: DoubleSide }))
  const recessDepth = design.slipWidth > 0 ? design.slipDepth : depth
  canvas.name = 'hd_image'
  canvas.position.set(0, center, back + recessDepth - Math.min(.003, recessDepth / 2))
  group.add(canvas)
  return group
}

export function disposePictureFrameGeometry(group: Group) {
  for (const child of group.children) {
    if (!(child instanceof Mesh)) continue
    child.geometry.dispose()
    child.material.dispose()
  }
}
