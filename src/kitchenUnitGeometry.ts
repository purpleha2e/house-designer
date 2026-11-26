import { BoxGeometry, CapsuleGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Shape, type BufferGeometry } from 'three'
import { getKitchenHandleFinish, getKitchenUnitConstruction, getKitchenUnitSize, type KitchenUnitDesign } from './kitchenUnitDesign.ts'

const doorDepth = .02
const gap = .003

type Front = {
  left: number
  bottom: number
  width: number
  height: number
  handleSide?: -1 | 1
}

function getFronts(design: KitchenUnitDesign, bottom: number, bodyHeight: number): Front[] {
  const { width, layout } = design
  if (layout === 'single-door' || layout === 'glass-front') {
    return [{ left: -width / 2, bottom, width, height: bodyHeight, handleSide: 1 }]
  }
  if (layout === 'three-drawers') return [0, 1, 2].map(index => ({
    left: -width / 2, bottom: bottom + index * bodyHeight / 3, width, height: bodyHeight / 3,
  }))
  const drawerHeight = layout === 'drawer-and-doors' ? Math.min(.17, bodyHeight / 3) : 0
  const doorHeight = bodyHeight - drawerHeight
  const doors: Front[] = [
    { left: -width / 2, bottom, width: width / 2, height: doorHeight, handleSide: 1 },
    { left: 0, bottom, width: width / 2, height: doorHeight, handleSide: -1 },
  ]
  if (drawerHeight) doors.push({ left: -width / 2, bottom: bottom + doorHeight, width, height: drawerHeight })
  return doors
}

function createRolledWorktop(width: number, depth: number, thickness: number, radius: number) {
  // Sweep the side profile across the width, keeping the sides and back square.
  const profile = new Shape()
  const arcZ = depth - radius
  const arcY = thickness - radius
  profile.moveTo(0, 0).lineTo(depth, 0)
  if (arcY > 0) profile.lineTo(depth, arcY)
  profile.absarc(arcZ, arcY, radius, 0, Math.PI / 2, false)
  profile.lineTo(0, thickness).closePath()
  const geometry = new ExtrudeGeometry(profile, { depth: width, bevelEnabled: false, curveSegments: 12 })
  geometry.rotateY(-Math.PI / 2)
  geometry.translate(width / 2, -thickness / 2, -depth / 2)
  return geometry
}

function mapWorktopTexture(geometry: BufferGeometry, width: number, depth: number, thickness: number, radius: number) {
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const uvs = geometry.getAttribute('uv')
  const arcZ = depth - radius
  const arcY = thickness - radius
  const frontEdgeDistance = arcZ + radius * Math.PI / 2
  const tolerance = Math.min(1e-6, radius * .01)

  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index) / width + .5
    const y = positions.getY(index) + thickness / 2
    const z = positions.getZ(index) + depth / 2
    const normalX = normals.getX(index)
    if (Math.abs(normalX) > .5) {
      // Unfold the side from the top edge using the top's texture scale across the width.
      const edgeDrop = (thickness - y) / width
      uvs.setXY(index, normalX > 0 ? 1 + edgeDrop : -edgeDrop, 1 - z / depth)
      continue
    }
    if (normals.getY(index) < -.5) {
      uvs.setXY(index, x, z / depth)
      continue
    }

    // Preserve the top UVs and carry the grain over the curved front edge.
    const frontArc = radius > 0 && Math.abs(Math.hypot(y - arcY, z - arcZ) - radius) < tolerance &&
      y >= arcY - tolerance && z >= arcZ - tolerance && normals.getY(index) >= 0
    let distance = z
    if (frontArc) {
      const angle = Math.max(0, Math.min(Math.PI / 2, Math.atan2(z - arcZ, y - arcY)))
      normals.setXYZ(index, 0, Math.cos(angle), Math.sin(angle))
      distance = arcZ + radius * angle
    } else if (normals.getZ(index) > .5) {
      distance = frontEdgeDistance + arcY - y
    } else if (normals.getZ(index) < -.5) {
      distance = y - thickness
    }
    uvs.setXY(index, x, 1 - distance / depth)
  }
}

export function createKitchenUnitGeometry(design: KitchenUnitDesign) {
  const size = getKitchenUnitSize(design)
  const front = design.depth
  const { plinthHeight, worktopThickness } = getKitchenUnitConstruction(design)
  const bodyHeight = design.height - worktopThickness - plinthHeight
  const glassFront = design.layout === 'glass-front'
  const group = new Group()
  const cabinet = new MeshStandardMaterial({ name: 'hd_cabinet', color: design.cabinetColor, roughness: .65 })
  const fronts = new MeshStandardMaterial({ name: 'hd_fronts', color: design.frontColor, roughness: .48 })
  const worktop = new MeshStandardMaterial({ name: 'hd_worktop', color: design.worktopColor, roughness: .37 })
  const plinth = new MeshStandardMaterial({ name: 'hd_plinth', color: design.plinthColor, roughness: .66 })
  const finish = getKitchenHandleFinish(design)
  const handles = new MeshPhysicalMaterial({ name: 'hd_handles', color: finish.color, roughness: finish.roughness,
    metalness: finish.metalness, anisotropy: finish.anisotropy })

  function box(name: string, material: MeshStandardMaterial, width: number, height: number, depth: number,
    x: number, y: number, z: number) {
    const mesh = new Mesh(new BoxGeometry(width, height, depth), material)
    mesh.name = name
    mesh.position.set(x, y, z)
    group.add(mesh)
  }

  const bodyDepth = design.depth - doorDepth - gap
  if (glassFront) {
    const panelThickness = .018
    const backThickness = .012
    const insideWidth = design.width - 2 * panelThickness
    const insideHeight = bodyHeight - 2 * panelThickness
    const shelfDepth = bodyDepth - backThickness - panelThickness
    box('cabinet-back', cabinet, insideWidth, insideHeight, backThickness, 0, bodyHeight / 2, backThickness / 2)
    for (const side of [-1, 1]) {
      box('cabinet-side', cabinet, panelThickness, insideHeight, bodyDepth,
        side * (design.width - panelThickness) / 2, bodyHeight / 2, bodyDepth / 2)
      box('cabinet-end', cabinet, design.width, panelThickness, bodyDepth,
        0, bodyHeight / 2 + side * (bodyHeight - panelThickness) / 2, bodyDepth / 2)
      box('shelf', cabinet, insideWidth, panelThickness, shelfDepth,
        0, bodyHeight / 2 + side * insideHeight / 6, backThickness + shelfDepth / 2)
    }
  } else {
    box('carcass', cabinet, design.width, bodyHeight, bodyDepth, 0, plinthHeight + bodyHeight / 2, bodyDepth / 2)
  }
  if (plinthHeight) {
    const plinthDepth = design.depth - design.plinthInset
    box('plinth', plinth, design.width, plinthHeight, plinthDepth, 0, plinthHeight / 2, plinthDepth / 2)
  }
  if (worktopThickness) {
    const { width, depth, height } = size
    const thickness = worktopThickness
    const radius = design.frontRollRadius ?? 0
    const geometry = radius > 0 ? createRolledWorktop(width, depth, thickness, radius) : new BoxGeometry(width, thickness, depth)
    mapWorktopTexture(geometry, width, depth, thickness, radius)
    const slab = new Mesh(geometry, worktop)
    slab.name = 'worktop'
    slab.position.set(0, height - thickness / 2, depth / 2)
    group.add(slab)
  }

  for (const panel of getFronts(design, plinthHeight, bodyHeight)) {
    const width = panel.width - gap
    const height = panel.height - gap
    const x = panel.left + panel.width / 2
    const y = panel.bottom + panel.height / 2
    if (design.doorStyle === 'slab' && !glassFront) {
      box('slab-front', fronts, width, height, doorDepth, x, y, front - doorDepth / 2)
    } else {
      const rail = Math.min(.055, width * .27, height * .24)
      const railDepth = .014
      if (glassFront) {
        const glass = new MeshPhysicalMaterial({ name: 'glass', color: '#dbeaf0', roughness: .16,
          transparent: true, opacity: .24, depthWrite: false })
        box('glass-pane', glass, width - 2 * rail, height - 2 * rail, .004, x, y, front - railDepth / 2)
      } else {
        box('recessed-panel', fronts, width - rail, height - rail, .008, x, y, front - doorDepth + .004)
      }
      for (const sign of [-1, 1]) {
        box('stile', fronts, rail, height, railDepth, x + sign * (width - rail) / 2, y, front - railDepth / 2)
        box('rail', fronts, width - 2 * rail, rail, railDepth, x, y + sign * (height - rail) / 2, front - railDepth / 2)
      }
      if (design.doorStyle === 'raised-panel' && !glassFront) {
        const halfWidth = (width - 2 * rail) * .44
        const halfHeight = (height - 2 * rail) * .44
        const profile = new Shape().moveTo(-halfWidth, -halfHeight).lineTo(halfWidth, -halfHeight)
          .lineTo(halfWidth, halfHeight).lineTo(-halfWidth, halfHeight)
        profile.closePath()
        const mesh = new Mesh(new ExtrudeGeometry(profile, { depth: .005, bevelEnabled: true,
          bevelThickness: .003, bevelSize: .005, bevelSegments: 1 }), fronts)
        mesh.name = 'raised-panel'
        mesh.position.set(x, y, front - .01)
        group.add(mesh)
      }
    }

    if (design.handleStyle === 'none') continue
    const door = panel.handleSide !== undefined
    const handleX = x + (panel.handleSide ?? 0) * Math.max(0, width / 2 - .035)
    const edgeInset = Math.min(.12, panel.height * .24)
    const handleY = door ? panel.bottom + (design.unitType === 'wall' ? edgeInset : panel.height - edgeInset) : y
    if (design.handleStyle === 'knob') {
      const knob = new Mesh(new CylinderGeometry(.012, .009, .02, 16), handles)
      knob.name = 'knob'
      knob.position.set(handleX, handleY, front + .01)
      knob.rotation.x = Math.PI / 2
      group.add(knob)
    } else {
      const barLength = Math.min(.13, (door ? height : width) * .58)
      const rounded = design.handleStyle === 'rounded-bar'
      if (rounded) {
        const radius = .006
        const bar = new Mesh(new CapsuleGeometry(radius, barLength - radius * 2, 6, 16), handles)
        bar.name = 'handle-bar'
        bar.position.set(handleX, handleY, front + .023)
        if (!door) bar.rotation.z = Math.PI / 2
        group.add(bar)
      } else {
        box('handle-bar', handles, door ? .011 : barLength, door ? barLength : .011, .012, handleX, handleY, front + .023)
      }
      for (const sign of [-1, 1]) {
        const mountX = handleX + (door ? 0 : sign * barLength * .34)
        const mountY = handleY + (door ? sign * barLength * .34 : 0)
        if (rounded) {
          const mount = new Mesh(new CylinderGeometry(.0045, .0045, .023, 12), handles)
          mount.name = 'handle-mount'
          mount.position.set(mountX, mountY, front + .0115)
          mount.rotation.x = Math.PI / 2
          group.add(mount)
        } else {
          box('handle-mount', handles, .009, .009, .023, mountX, mountY, front + .0115)
        }
      }
    }
  }
  for (const material of [worktop, plinth, handles]) {
    if (!group.children.some(child => child instanceof Mesh && child.material === material)) material.dispose()
  }
  return group
}
