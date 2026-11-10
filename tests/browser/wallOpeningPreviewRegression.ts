import { AmbientLight, DoubleSide, Mesh, MeshStandardMaterial, OrthographicCamera, Path, Scene, Shape, ShapeGeometry, WebGLRenderer, Color } from 'three'
import { applyWallOpeningPreviewShader, getWallOpeningPreview } from '../../src/wallOpeningPreview'
import { requestShaderWarmup } from '../../src/shaderWarmupState'
import type { FloorLevel } from '../../src/types'

const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); renderer.setSize(400, 240)
document.body.appendChild(renderer.domElement)
const scene = new Scene(); scene.background = new Color('white'); scene.add(new AmbientLight('white', 2))
const camera = new OrthographicCamera(-.5, 4.5, 2.8, -.2, .1, 10); camera.position.z = 5; camera.updateMatrixWorld()
const floor: FloorLevel = { id: 'floor', name: '', elevation: 0, roomHeight: 2.4, slabThickness: .2, rooms: [], roofs: [], models: [], walls: [{
  id: 'wall', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, height: 2.4, thickness: .2, kind: 'external',
  openings: [{ id: 'window', center: 1, bottom: .8, width: 1, height: 1 }],
}] }
const wallGeometry = (center: number) => {
  const shape = new Shape().moveTo(0, 0).lineTo(4, 0).lineTo(4, 2.4).lineTo(0, 2.4).closePath()
  shape.holes.push(new Path().moveTo(center - .5, .8).lineTo(center - .5, 1.8).lineTo(center + .5, 1.8).lineTo(center + .5, .8).closePath())
  return new ShapeGeometry(shape).translate(0, 0, .1)
}
const material = new MeshStandardMaterial({ color: '#444444', side: DoubleSide }), mesh = new Mesh(wallGeometry(1), material)
Object.assign(mesh.userData, { floorId: floor.id, wallOpeningPreviewEligible: true, wallPreparedWalls: floor.walls })
scene.add(mesh); applyWallOpeningPreviewShader(material, scene)
const preview = getWallOpeningPreview(scene), context = renderer.getContext()
const sample = (x: number, y: number) => {
  const pixel = new Uint8Array(4); context.readPixels(Math.round((x + .5) / 5 * 400), Math.round((y + .2) / 3 * 240), 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel)
  return [...pixel]
}
renderer.render(scene, camera)
const before = { old: sample(1, 1.3), next: sample(2.5, 1.3) }
let compiles = 0; const compile = context.compileShader.bind(context); context.compileShader = shader => { compiles++; compile(shader) }
const next = structuredClone(floor); next.walls[0].openings![0].center = 2.5
const started = performance.now(); preview.update([next], []); preview.sync(); scene.add(preview.group); renderer.render(scene, camera); preview.group.removeFromParent()
const immediate = { old: sample(1, 1.3), next: sample(2.5, 1.3), ms: performance.now() - started, compiles }
mesh.geometry.dispose(); mesh.geometry = wallGeometry(2.5); mesh.userData.wallPreparedWalls = next.walls; requestShaderWarmup(scene)
preview.sync(); renderer.render(scene, camera)
const final = { old: sample(1, 1.3), next: sample(2.5, 1.3), active: preview.active }
const moved = structuredClone(next); moved.walls[0].start.x += .5; moved.walls[0].end.x += .5
preview.update([moved], []); preview.sync(); scene.add(preview.group); renderer.render(scene, camera); preview.group.removeFromParent()
const wallMove = { oldEnd: sample(.25, 2), newEnd: sample(4.25, 2), body: sample(2.25, 1.3), hole: sample(3, 1.3) }
mesh.geometry.dispose(); mesh.geometry = wallGeometry(2.5).translate(.5, 0, 0); mesh.userData.wallPreparedWalls = moved.walls; requestShaderWarmup(scene)
const added = structuredClone(moved); added.walls.push({ ...added.walls[0], id: 'new-wall', start: { x: -.25, y: .6 }, end: { x: .25, y: .6 }, openings: [] })
preview.update([added], []); preview.sync(); scene.add(preview.group); renderer.render(scene, camera); preview.group.removeFromParent()
const wallAdd = sample(0, 2)
const removed = structuredClone(moved); removed.walls = []
preview.update([removed], []); preview.sync(); renderer.render(scene, camera)
Object.assign(window, { openingPreviewResult: { before, immediate, final, wallMove, wallAdd, wallRemove: sample(1, 2), compiles, glError: context.getError() } })
