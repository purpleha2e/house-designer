import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { getWindowLayout, type WindowDesign } from './windowDesign.ts'

/** Origin matches wall-mounted assets: centred X, bottom Y, back face Z=0. */
export function createWindowGeometry(design: WindowDesign) {
  const group = new Group()
  group.name = 'parametric-window'
  group.userData.windowDesign = design
  const frame = new MeshStandardMaterial({ color: design.color, roughness: 0.38 })
  frame.name = 'Window frame'
  const glass = new MeshStandardMaterial({ color: '#b8dfec', transparent: true, opacity: 0.32,
    roughness: 0.12, metalness: 0.1, depthWrite: false })
  glass.name = 'Window glass'
  const metal = new MeshStandardMaterial({ color: '#b7bec4', roughness: 0.25, metalness: 0.7 })
  metal.name = 'Window handles'
  function box(name: string, x: number, y: number, w: number, h: number,
    depth: number, z: number, material = frame) {
    const mesh = new Mesh(new BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), depth), material)
    mesh.name = name
    mesh.position.set(x + w / 2 - design.width / 2, design.height - y - h / 2, z)
    group.add(mesh)
  }
  const f = design.frame, z = design.depth / 2
  box('frame-top', 0, 0, design.width, f, design.depth, z)
  box('frame-bottom', 0, design.height - f, design.width, f, design.depth, z)
  box('frame-left', 0, f, f, design.height - 2*f, design.depth, z)
  box('frame-right', design.width-f, f, f, design.height-2*f, design.depth, z)
  const { panes, dividers } = getWindowLayout(design)
  for (const d of dividers) box(`divider-${d.path}`, d.x, d.y, d.width, d.height, design.depth, z)
  for (const p of panes) {
    const opening = p.section.kind === 'pane' ? p.section.opening : 'fixed'
    const s = opening === 'fixed' ? 0 : 0.025
    if (s) {
      const sz = design.depth * 0.65, sd = design.depth * 0.7
      box(`sash-top-${p.path}`, p.x, p.y, p.width, s, sd, sz)
      box(`sash-bottom-${p.path}`, p.x, p.y+p.height-s, p.width, s, sd, sz)
      box(`sash-left-${p.path}`, p.x, p.y+s, s, p.height-2*s, sd, sz)
      box(`sash-right-${p.path}`, p.x+p.width-s, p.y+s, s, p.height-2*s, sd, sz)
      const hx = opening === 'top' ? p.x+p.width/2-0.025 : opening === 'left' ? p.x+p.width-s : p.x
      const hy = opening === 'top' ? p.y+p.height-s : p.y+p.height/2-0.025
      box(`handle-${opening}-${p.path}`, hx, hy, opening === 'top' ? 0.05 : s,
        opening === 'top' ? s : 0.05, 0.015, design.depth+0.0075, metal)
    }
    box(`glass-${p.path}`, p.x+s, p.y+s, p.width-2*s, p.height-2*s, 0.006, design.depth*0.6, glass)
  }
  return group
}

export function disposeWindowGeometry(group: Group) {
  const materials = new Set<MeshStandardMaterial>()
  group.traverse(object => {
    if (object instanceof Mesh) { object.geometry.dispose(); materials.add(object.material as MeshStandardMaterial) }
  })
  materials.forEach(material => material.dispose())
}
