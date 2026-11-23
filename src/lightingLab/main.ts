import { Euler, Vector3 } from 'three'
import { LightingLab, type rugColours } from './engine'
import './style.css'

document.querySelector<HTMLDivElement>('#lab')!.innerHTML = `
<aside>
  <div class="eyebrow">HOUSE DESIGNER · EXPERIMENT</div>
  <h1>Live lighting lab</h1>
  <p>Two rooms. Changing light. Watch reflections of colour spread from the rug onto the walls.</p>
  <h2>Lights</h2>
  <label class="switch">Room lights<input id="room-lights" type="checkbox" checked></label>
  <label class="switch">Left room<input id="left-lamp" type="checkbox" checked></label>
  <label class="switch">Right room<input id="right-lamp" type="checkbox" checked></label>
  <label class="switch">Daylight<input id="daylight" type="checkbox" checked></label>
  <label class="switch">Bounced light<input id="indirect" type="checkbox" checked></label>
  <h2>Rug colour</h2>
  <div class="choices rug"><button data-rug="neutral" style="--swatch:#c4baa3" aria-pressed="false">Neutral</button><button data-rug="red" style="--swatch:#e05c48" aria-pressed="true">Red</button><button data-rug="blue" style="--swatch:#719eea" aria-pressed="false">Blue</button></div>
  <h2>Move the cabinet</h2>
  <input id="cabinet" type="range" min="-3.2" max="3.2" value="-1.3" step=".05" aria-label="Cabinet position">
  <div class="range-caption"><span>Left room</span><span>Right room</span></div>
  <h2>Look around</h2>
  <div class="choices"><button data-view="left">Left room</button><button data-view="door">Doorway</button><button data-view="right">Right room</button></div>
  <details><summary>Measurements &amp; limits</summary><dl id="measurements"></dl>
  <button id="save-report">Save performance report</button>
  <p class="note">GPU surface-cache experiment, not Unreal Lumen. Simple planar surfaces and one box; no imported house, hardware ray tracing, or screen-space probes. Lighting converges over several frames. Full-resolution viewport throughout.</p></details>
</aside>
<main id="viewport"><div class="hud"><span id="fps" class="pill">Starting…</span><span id="gpu" class="pill">Preparing lighting</span><span class="pill">Full-resolution view</span></div><div class="help">Drag to look · WASD / arrows to move · Shift for faster movement</div><div id="loading"><strong>Preparing the lighting experiment</strong><p>Preparing GPU programs once before interaction.</p></div></main>`

const host = document.querySelector<HTMLElement>('#viewport')!
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const format = (value: number | null) => value === null ? 'Unavailable' : `${value.toFixed(2)} ms`
let lastHud = 0
let lab: LightingLab
try {
  lab = new LightingLab(host, () => {
    const now = performance.now()
    if (now - lastHud < 500) return
    lastHud = now
    const s = lab.stats()
    get('fps').textContent = `${Math.round(s.fps ?? 0)} FPS`
    get('gpu').textContent = s.lightingGpuMedianMs === null ? 'GPU timing unavailable' : `Lighting ${format(s.lightingGpuMedianMs)}`
    const rows = [
      ['Frame cadence · median / p95', `${format(s.frameMedianMs)} / ${format(s.frameP95Ms)}`],
      ['Whole-frame GPU · median / p95', `${format(s.frameGpuMedianMs)} / ${format(s.frameGpuP95Ms)}`],
      ['Lighting GPU · median / p95', `${format(s.lightingGpuMedianMs)} / ${format(s.lightingGpuP95Ms)}`],
      ['CPU submission · p95', format(s.cpuP95Ms)],
      ['Lighting work target', `${s.lightingBudgetMs} ms · ${s.tilesPerFrame} cards/frame`],
      ['Surface cache', `${s.cards} cards · ${s.tileResolution} × ${s.tileResolution} texels/card · 8 rays/texel/update`],
      ['Viewport', `${s.viewport.width} × ${s.viewport.height} · fixed ${s.viewport.pixelRatio}× pixel ratio`],
      ['Shader programs', String(s.programs)], ['Renderer', s.device.renderer],
    ]
    get('measurements').replaceChildren(...rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; return [dt, dd]
    }))
  })
  const keys = new Set<string>()
  const angles = new Euler(0, 0, 0, 'YXZ')
  const syncAngles = () => angles.setFromQuaternion(lab.camera.quaternion, 'YXZ')
  syncAngles()
  const canvas = lab.renderer.domElement
  canvas.tabIndex = 0
  let dragging = false
  canvas.addEventListener('pointerdown', event => { dragging = true; canvas.setPointerCapture(event.pointerId); canvas.focus() })
  canvas.addEventListener('pointerup', () => dragging = false)
  canvas.addEventListener('pointercancel', () => dragging = false)
  canvas.addEventListener('pointermove', event => {
    if (!dragging) return
    angles.y -= event.movementX * .003; angles.x = Math.max(-1.4, Math.min(1.4, angles.x - event.movementY * .003))
    lab.camera.quaternion.setFromEuler(angles)
  })
  const movement = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'])
  window.addEventListener('keydown', event => { if (document.activeElement === canvas && movement.has(event.code)) { keys.add(event.code); event.preventDefault() } })
  window.addEventListener('keyup', event => keys.delete(event.code))
  window.addEventListener('blur', () => { keys.clear(); dragging = false })
  const forward = new Vector3(), right = new Vector3(), direction = new Vector3()
  const observer = new ResizeObserver(() => lab.resize()); observer.observe(host)
  const checkbox = (id: string, action: (checked: boolean) => void) => get<HTMLInputElement>(id).addEventListener('change', event => action((event.currentTarget as HTMLInputElement).checked))
  const roomLights = get<HTMLInputElement>('room-lights')
  const lampControls = ['left-lamp', 'right-lamp'].map(id => get<HTMLInputElement>(id))
  const syncRoomLights = () => {
    roomLights.checked = lab.settings.lamps.some(Boolean)
    roomLights.indeterminate = roomLights.checked && !lab.settings.lamps.every(Boolean)
  }
  checkbox('room-lights', value => {
    lampControls.forEach((control, index) => { control.checked = value; lab.setLamp(index, value) })
    syncRoomLights()
  })
  lampControls.forEach((control, index) => checkbox(control.id, value => { lab.setLamp(index, value); syncRoomLights() }))
  checkbox('daylight', value => lab.setDaylight(value)); checkbox('indirect', value => lab.setIndirect(value))
  document.querySelectorAll<HTMLButtonElement>('[data-rug]').forEach(button => button.addEventListener('click', () => {
    lab.setRug(button.dataset.rug as keyof typeof rugColours)
    document.querySelectorAll('[data-rug]').forEach(b => b.setAttribute('aria-pressed', String(b === button)))
  }))
  get<HTMLInputElement>('cabinet').addEventListener('input', event => lab.setCabinet(Number((event.currentTarget as HTMLInputElement).value)))
  const views: Record<string, [number[], number[]]> = {
    left: [[-2.7, 1.55, 2.2], [.25, 1.2, -.5]], door: [[-1.8, 1.55, .3], [2.7, 1.3, -1]], right: [[2.7, 1.55, 2.2], [-.25, 1.2, -.5]],
  }
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => {
    const [position, target] = views[button.dataset.view!]; lab.camera.position.fromArray(position); lab.camera.lookAt(new Vector3().fromArray(target)); syncAngles()
  }))
  get('save-report').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: 1, date: new Date().toISOString(), ...lab.stats() }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'lighting-lab-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  Object.assign(window, { lightingLab: lab })
  await lab.start(delta => {
    forward.set(-Math.sin(angles.y), 0, -Math.cos(angles.y)); right.set(Math.cos(angles.y), 0, -Math.sin(angles.y))
    const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'))
    const z = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'))
    direction.copy(forward).multiplyScalar(z).addScaledVector(right, x)
    if (!direction.lengthSq()) return
    const oldX = lab.camera.position.x
    lab.camera.position.addScaledVector(direction.normalize(), delta * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1.5))
    lab.camera.position.x = Math.max(-3.85, Math.min(3.85, lab.camera.position.x)); lab.camera.position.z = Math.max(-2.85, Math.min(2.85, lab.camera.position.z))
    if (Math.abs(lab.camera.position.z) > .65 && Math.abs(lab.camera.position.x) < .2) lab.camera.position.x = oldX < 0 ? -.2 : .2
  })
  get('loading').hidden = true
  window.addEventListener('pagehide', () => { observer.disconnect(); lab.dispose() }, { once: true })
} catch (error) {
  get('loading').textContent = `Could not start the lighting experiment: ${error instanceof Error ? error.message : String(error)}`
  get('loading').classList.add('error')
  console.error(error)
}
