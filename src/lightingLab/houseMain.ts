import { Euler, Vector3 } from 'three'
import { HouseLightingLab } from './houseEngine'
import type { HouseBridge, HouseInput } from './houseBridge'
import type { HouseGeometry } from './houseGeometry'
import type { HouseReference } from './houseReference'
import type { HousePreparedLighting } from './housePrepared'
import { HOUSE_DAYLIGHT_KEY, housePrototypeDaylight } from './housePreferences'
import './style.css'
const parameters = new URLSearchParams(location.search)
let savedDaylight: string | null = null
try { savedDaylight = localStorage.getItem(HOUSE_DAYLIGHT_KEY) } catch { /* Use the default when storage is unavailable. */ }
const prototypeDaylight = housePrototypeDaylight(parameters, savedDaylight)
const daylightOnly = prototypeDaylight || parameters.get('daylightOnly') === '1'

document.title = 'House lighting lab'
document.querySelector('#lab')!.innerHTML = `<aside>
<div class="eyebrow">HOUSE DESIGNER · EXPERIMENT</div><h1>House lighting lab</h1>
<p>Compare live lighting, prepared walkthroughs and reference renders using your house geometry.</p>
<label class="switch">Daylight<input id="daylight" type="checkbox" checked></label>
<label class="switch">Prototype window daylight<input id="prototype-daylight" type="checkbox" autocomplete="off"></label>
<p class="note">Uses luminous windows and sky through open exterior doors. Your choice is remembered. Switching reloads this view with room lamps and direct sun off.</p>
<label class="switch">Bounced light<input id="bounce" type="checkbox" checked></label>
<label class="switch">Show surface cache cards<input id="surface-cache-cards" type="checkbox" autocomplete="off" aria-describedby="surface-cache-cards-help"></label>
<p class="note" id="surface-cache-cards-help">Tint visible surfaces by their assigned lighting card in the live view.</p>
<h2>Room lights</h2><div id="lamps"></div>
<h2>View brightness</h2><input id="exposure" aria-label="View brightness" type="range" min="-2" max="3" step=".25" value="0">
<div class="choices"><button id="start-view">Starting view</button><button id="refresh-house">Refresh house snapshot</button></div>
<section><h2>Stable walkthrough</h2>
<p class="note">Prepare prototype daylight once, then walk without lighting updates. Uses full-geometry light paths, with room lamps and direct sun off. Prepare again after house edits. Reflections are approximate away from the starting room.</p>
<label class="reference-option">Preparation quality<select id="prepared-samples"><option value="128">Preview · 128 samples</option><option value="512" selected>High · 512 samples</option><option value="1024">Higher · 1024 samples</option></select></label>
<div class="choices"><button id="prepared-start" disabled>Prepare walkthrough</button><button id="prepared-stop" disabled>Cancel preparation</button></div>
<p class="note" id="prepared-state" role="status" aria-live="polite">Preparation may take several minutes. The completed lighting stays fixed as the camera moves.</p></section>
<section id="reference-controls"><h2>Final still / reference render</h2>
<p class="note">Full geometry and original textures, with many light paths. Uses this camera, daylight and exposure. The live view pauses while it renders.</p>
<label class="reference-option">Image width<select id="reference-width"><option value="640">640 px · preview</option><option value="1280" selected>1280 px</option><option value="1920">1920 px</option><option value="2560">2560 px</option><option value="3840">3840 px</option></select></label>
<label class="reference-option">Texture detail<select id="reference-textures"><option value="512">Standard · 512 px</option><option value="1024" selected>High · 1024 px</option><option value="2048">Higher · 2048 px</option></select></label>
<p class="note">The image keeps this view's proportions. Larger images and higher detail take longer to render. Wait for “HQ render complete”, then save the image.</p>
<label class="switch">Denoise final image<input id="reference-denoise" type="checkbox" checked></label>
<label class="switch">Exterior view and designer sun<input id="reference-exterior" type="checkbox" checked></label>
<p class="note">Clear windows, the designer’s outside view and current sun direction. Keeps the reference sky-light strength. Switch off for the original white-window comparison.</p>
<p class="note">Local GPU denoising preserves detail using surface-colour and normal guides. Requires WebGPU. Switch off for an unfiltered reference.</p>
<label class="reference-option">Materials<select id="reference-materials"><option value="pbr">Authored PBR</option><option value="diffuse">Diffuse comparison</option></select></label>
<label class="reference-option">Samples per pixel<select id="reference-samples"><option>256</option><option selected>512</option><option>1024</option><option>4096</option></select></label>
<label class="reference-option">Maximum bounces<select id="reference-bounces"><option>16</option><option selected>32</option><option>64</option></select></label>
<div class="choices"><button id="reference-start">Render reference</button><button id="reference-stop" disabled>Return to live</button></div>
<p id="reference-state" class="note" role="status" aria-live="polite">No reference rendered yet.</p>
<div class="choices"><button id="reference-image" disabled>Save HQ image</button><button id="reference-compare" disabled>Show raw image</button><button id="reference-data" disabled>Save raw HDR</button></div>
<button id="reference-report" disabled>Save reference settings</button>
<p class="note">Compare at 256, 1024 and 4096 samples to judge convergence. This keeps the prototype sky and glazing assumptions; it is not a measured daylight simulation.</p></section>
<p class="note">Move with WASD or arrows; Q/E move down/up. Drag to look. This view does not edit your house.</p>
<details><summary>Measurements &amp; limits</summary><dl id="measurements"></dl><button id="report">Save performance report</button>
<p class="note">Geometry and finishes are a snapshot; refresh after edits. Light controls affect only this tab. Prototype daylight uses luminous panes and sky through openings. The live experiment approximates diffuse lighting. Prepared walkthroughs use authored materials with fixed surface lighting and one local reflection capture; capture charts still limit shadow detail. Use the reference render for full camera-dependent light paths.</p></details>
</aside><main id="viewport"><div class="hud"><span id="fps" class="pill">Preparing</span><span id="gpu" class="pill">House lighting</span><span id="progress" class="pill"></span><span id="daylight-mode" class="pill"></span></div>
<div class="help">Drag to look · WASD / arrows · Q/E down/up · Shift faster</div><div id="loading">Reading the house snapshot…</div></main>`
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const loading = (message: string) => { get('loading').textContent = message }
let engine: HouseLightingLab | undefined
let worker: Worker | undefined
try {
  const bridge: HouseBridge | undefined = window.opener?.houseLightingSource
  if (!bridge) throw Error('Open your house in the editor, then choose “Open house lighting lab” in the 3D view menu. Keep the editor tab open.')
  get<HTMLInputElement>('prototype-daylight').checked = prototypeDaylight
  const snapshot = bridge.snapshot({ prototypeDaylight })
  if (prototypeDaylight && snapshot.prototypeDaylight !== true)
    throw Error('The editor could not supply prototype window daylight. Save your project, refresh the main editor tab, then reopen the house lighting lab.')
  try { localStorage.setItem(HOUSE_DAYLIGHT_KEY, prototypeDaylight ? '1' : '0') } catch { /* The current mode still works without persistence. */ }
  try {
    const saved=sessionStorage.getItem('houseLabComparisonCamera');sessionStorage.removeItem('houseLabComparisonCamera')
    if(saved){const view=JSON.parse(saved);if(view.position?.length===3&&view.quaternion?.length===4){snapshot.position=view.position;snapshot.quaternion=view.quaternion}}
  } catch { /* A comparison can still open if session storage is unavailable. */ }
  worker = new Worker(new URL('./houseGeometry.worker.ts', import.meta.url), { type: 'module' })
  const data = await new Promise<HouseGeometry>((resolve, reject) => {
    worker!.onmessage = event => { if (event.data.error) reject(Error(event.data.error)); else if (event.data.result) resolve(event.data.result); else loading(event.data.message) }
    worker!.onerror = event => reject(Error(event.message))
    worker!.postMessage(snapshot.parts)
  })
  worker.terminate(); worker = undefined
  const host = get('viewport'), lab = new HouseLightingLab(host, snapshot, data); engine = lab
  let prepared: HousePreparedLighting | undefined
  const preparedDisabled = new Map<HTMLInputElement | HTMLButtonElement | HTMLSelectElement, boolean>()
  const restorePreparedControls = () => {
    preparedDisabled.forEach((disabled, element) => element.disabled = disabled); preparedDisabled.clear()
    get<HTMLButtonElement>('prepared-stop').disabled = true
    get('prepared-stop').textContent = 'Cancel preparation'
  }
  get('prepared-start').addEventListener('click', async () => {
    if (!snapshot.prototypeDaylight) {get('prepared-state').textContent='Enable prototype window daylight first, then prepare the walkthrough.';return}
    if (snapshot.finishes.some(finish=>!finish.daylightEmitter&&!finish.referenceMaterial)) {
      get('prepared-state').textContent='Reopen this lab from the updated editor to capture authored materials.';return
    }
    document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('aside input, aside button, aside select').forEach(element=>{preparedDisabled.set(element,element.disabled);element.disabled=true})
    get('prepared-state').textContent='Loading lighting preparation…'
    try {
      const {HousePreparedLighting}=await import('./housePrepared')
      prepared=new HousePreparedLighting(lab,snapshot,Number(get<HTMLSelectElement>('prepared-samples').value))
      Object.assign(window,{housePreparedLighting:prepared})
      get<HTMLButtonElement>('prepared-stop').disabled=false
      await prepared.prepare(message=>get('prepared-state').textContent=message)
      get('prepared-stop').textContent='Return to live experiment'
    } catch(error) {
      prepared=undefined;Object.assign(window,{housePreparedLighting:undefined});restorePreparedControls()
      get('prepared-state').textContent=error instanceof DOMException&&error.name==='AbortError'?'Preparation cancelled.':`Preparation failed: ${error instanceof Error?error.message:String(error)}`
    }
  })
  get('prepared-stop').addEventListener('click',()=>{
    if(!prepared)return
    if(!prepared.stats().ready){prepared.cancel();get('prepared-state').textContent='Cancelling preparation…';get<HTMLButtonElement>('prepared-stop').disabled=true;return}
    prepared.dispose();prepared=undefined;Object.assign(window,{housePreparedLighting:undefined});restorePreparedControls()
    get('prepared-state').textContent='Live experiment resumed. Prepare again for a stable walkthrough.'
  })
  Object.assign(window, { houseLightingLab: lab })
  let input: HouseInput = structuredClone(bridge.lighting()), sourceKey = '', lastSourceCheck = 0, lastHud = 0
  const overrides = new Map<number, boolean>()
  if(daylightOnly)input.lights.forEach((_,i)=>overrides.set(i,false))
  const apply = () => lab.setInput({ ...input, daylight: get<HTMLInputElement>('daylight').checked,
    sunColour: daylightOnly ? [0,0,0] : input.sunColour,
    lights: input.lights.map((light, i) => ({ ...light, power: overrides.get(i) === false ? 0 : overrides.get(i) === true && light.power === 0 ? 90 : light.power })) })
  const lamps = () => {
    get('lamps').replaceChildren(...input.lights.slice(0, 32).map((light, i) => {
      const label = document.createElement('label'); label.className = 'switch'; label.textContent = `Light ${i + 1} · ${light.position[1].toFixed(1)} m`
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = overrides.get(i) ?? light.power > 0; checkbox.dataset.lamp = String(i)
      checkbox.addEventListener('change', () => { overrides.set(i, checkbox.checked); apply() }); label.append(checkbox); return label
    }))
  }
  get<HTMLInputElement>('daylight').checked = daylightOnly || input.daylight; lamps(); apply()
  let switchingDaylight = false
  get('prototype-daylight').addEventListener('change',()=>{
    const selected = get<HTMLInputElement>('prototype-daylight').checked
    switchingDaylight = true
    try { localStorage.setItem(HOUSE_DAYLIGHT_KEY, selected ? '1' : '0') } catch { /* URL still preserves the current choice. */ }
    get<HTMLInputElement>('prototype-daylight').disabled = true
    get('loading').hidden = false; loading('Switching daylight mode…')
    try { sessionStorage.setItem('houseLabComparisonCamera',JSON.stringify({position:lab.camera.position.toArray(),quaternion:lab.camera.quaternion.toArray()})) } catch { /* Optional camera retention. */ }
    const url=new URL(location.href);url.searchParams.set('prototypeDaylight',selected?'1':'0');url.searchParams.set('daylightOnly','1');location.href=url.href
  })
  get('daylight').addEventListener('change', apply)
  get('bounce').addEventListener('change', () => lab.setIndirect(get<HTMLInputElement>('bounce').checked))
  const surfaceCacheCards = get<HTMLInputElement>('surface-cache-cards')
  surfaceCacheCards.addEventListener('change', () => lab.setSurfaceCacheCardsVisible(surfaceCacheCards.checked))
  get('exposure').addEventListener('input', () => lab.setExposure(Number(get<HTMLInputElement>('exposure').value)))
  get('refresh-house').addEventListener('click', () => location.reload())
  get('report').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(lab.stats(), null, 2)], { type: 'application/json' })), a = document.createElement('a')
    a.href = url; a.download = 'house-lighting-lab.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  let reference: HouseReference | undefined, referenceGeneration = 0
  const disabledBefore = new Map<HTMLInputElement | HTMLButtonElement | HTMLSelectElement, boolean>()
  const referenceStatus = (message: string) => { if (get('reference-state').textContent !== message) get('reference-state').textContent = message }
  const stopReference = () => {
    referenceGeneration++; reference?.dispose(); reference = undefined
    Object.assign(window, { houseLightingReference: undefined }); lab.setPaused(false)
    disabledBefore.forEach((disabled, element) => { element.disabled = disabled }); disabledBefore.clear()
    for (const id of ['reference-stop', 'reference-image', 'reference-compare', 'reference-data', 'reference-report']) get<HTMLButtonElement>(id).disabled = true
    get('reference-compare').textContent = 'Show raw image'
    referenceStatus('Live view resumed. Render again to capture this camera.')
  }
  get('reference-stop').addEventListener('click', stopReference)
  get('reference-start').addEventListener('click', async () => {
    const generation = ++referenceGeneration, exterior = get<HTMLInputElement>('reference-exterior').checked
    const settings = lab.referenceInput()
    if (!settings) return
    if (exterior) { const designer = bridge.lighting(); settings.sunDirection = [...designer.sunDirection]; settings.sunColour = [...designer.sunColour] }
    const referenceSnapshot = exterior ? bridge.snapshot({ referenceExterior: true }) : snapshot
    if (exterior && !referenceSnapshot.exterior) { referenceStatus('Refresh the main editor and reopen the lab to capture the exterior view.'); return }
    const options = { diffuse: get<HTMLSelectElement>('reference-materials').value === 'diffuse',
      denoise: get<HTMLInputElement>('reference-denoise').checked,
      width: Number(get<HTMLSelectElement>('reference-width').value), textureSize: Number(get<HTMLSelectElement>('reference-textures').value),
      samples: Number(get<HTMLSelectElement>('reference-samples').value), bounces: Number(get<HTMLSelectElement>('reference-bounces').value) }
    if (!options.diffuse && snapshot.finishes.some(finish => !finish.daylightEmitter && !finish.referenceMaterial)) {
      referenceStatus('Reopen this lab from the updated editor to capture authored PBR materials, or select Diffuse comparison.')
      return
    }
    document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('aside input, aside button, aside select').forEach(element => {
      disabledBefore.set(element, element.disabled); element.disabled = true
    })
    get<HTMLButtonElement>('reference-stop').disabled = false; lab.setPaused(true); referenceStatus('Loading the reference renderer…')
    try {
      const { HouseReference } = await import('./houseReference')
      if (generation !== referenceGeneration) return
      reference = new HouseReference(host, referenceSnapshot, settings, lab.camera, lab.renderer.toneMappingExposure, options, message => {
        if (generation !== referenceGeneration) return
        referenceStatus(message)
        if (reference) {
          get<HTMLButtonElement>('reference-image').disabled = !reference.canSave
          get('reference-image').textContent = reference.hasDenoisedImage && !reference.showingRaw ? 'Save HQ image' : 'Save raw image'
          get<HTMLButtonElement>('reference-compare').disabled = !reference.hasDenoisedImage
          for (const id of ['reference-data', 'reference-report']) get<HTMLButtonElement>(id).disabled = reference.tracer.samples < 1
        }
      })
      Object.assign(window, { houseLightingReference: reference })
      if (exterior) referenceSnapshot.finishes.forEach(finish => finish.referenceMaterial?.dispose())
      await reference.start()
    } catch (error) {
      if (generation !== referenceGeneration) return
      stopReference(); referenceStatus(`Reference failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  get('reference-image').addEventListener('click', () => {
    const canvas=reference?.renderer.domElement
    const kind=reference?.hasDenoisedImage&&!reference.showingRaw?'hq':'raw'
    canvas?.toBlob(blob => { if (blob) download(blob, `house-render-${kind}-${canvas.width}x${canvas.height}.png`) })
  })
  get('reference-compare').addEventListener('click', () => {
    if (!reference?.hasDenoisedImage) return
    reference.showRaw(!reference.showingRaw)
    get('reference-compare').textContent = reference.showingRaw ? 'Show HQ image' : 'Show raw image'
    get('reference-image').textContent = reference.showingRaw ? 'Save raw image' : 'Save HQ image'
  })
  get('reference-report').addEventListener('click', () => { if (reference) download(new Blob([JSON.stringify(reference.stats(), null, 2)], { type: 'application/json' }), 'house-reference.json') })
  get('reference-data').addEventListener('click', async () => {
    if (!reference) return
    const { width, height, values } = await reference.pixels(), rgb = new Float32Array(width * height * 3)
    for (let i = 0; i < width * height; i++) rgb.set(values.subarray(i * 4, i * 4 + 3), i * 3)
    download(new Blob([`PF\n${width} ${height}\n-1.0\n`, rgb.buffer]), 'house-reference.pfm')
  })
  window.addEventListener('pagehide', () => { referenceGeneration++; reference?.dispose() }, { once: true })
  const angles = new Euler(0, 0, 0, 'YXZ'); angles.setFromQuaternion(lab.camera.quaternion, 'YXZ')
  get('start-view').addEventListener('click', () => { lab.camera.position.fromArray(snapshot.position); lab.camera.quaternion.fromArray(snapshot.quaternion); angles.setFromQuaternion(lab.camera.quaternion, 'YXZ') })
  const canvas = lab.renderer.domElement; canvas.tabIndex = 0
  let dragging = false
  canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); canvas.focus() })
  canvas.addEventListener('pointerup', () => dragging = false); canvas.addEventListener('pointercancel', () => dragging = false)
  canvas.addEventListener('pointermove', e => { if (!dragging) return; angles.y -= e.movementX * .003; angles.x = Math.max(-1.5, Math.min(1.5, angles.x - e.movementY * .003)); lab.camera.quaternion.setFromEuler(angles) })
  const keys = new Set<string>(), allowed = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'])
  window.addEventListener('keydown', e => { if (document.activeElement === canvas && allowed.has(e.code)) { keys.add(e.code); e.preventDefault() } })
  window.addEventListener('keyup', e => keys.delete(e.code)); window.addEventListener('blur', () => { keys.clear(); dragging = false })
  const direction = new Vector3(), forward = new Vector3(), right = new Vector3()
  const observer = new ResizeObserver(() => lab.resize()); observer.observe(host)
  await lab.start(delta => {
    const now = performance.now()
    if (!prepared && now - lastSourceCheck > 500) {
      lastSourceCheck = now
      try {
        const next = structuredClone(bridge.lighting()), key = JSON.stringify(next)
        if (key !== sourceKey) { sourceKey = key; input = next; lamps(); apply() }
      } catch { /* The snapshot remains usable if the editor tab closes. */ }
    }
    forward.set(-Math.sin(angles.y), 0, -Math.cos(angles.y)); right.set(Math.cos(angles.y), 0, -Math.sin(angles.y))
    const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'))
    const z = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'))
    direction.copy(forward).multiplyScalar(z).addScaledVector(right, x); direction.y = Number(keys.has('KeyE')) - Number(keys.has('KeyQ'))
    if (direction.lengthSq()) lab.camera.position.addScaledVector(direction.normalize(), delta * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1.5))
  }, () => {
    const now = performance.now(); if (now - lastHud < 500) return; lastHud = now
    const s = lab.stats(); if (!switchingDaylight) {
      get('loading').hidden = s.frames > 0
      // Browsers can restore form state after our asynchronous scene startup.
      // The control must describe the snapshot actually driving the renderer.
      get<HTMLInputElement>('prototype-daylight').checked = snapshot.prototypeDaylight === true
    }
    get('daylight-mode').textContent = s.frozenLighting ? 'Prepared daylight' : s.daylightMode === 'off' ? 'Daylight off' : s.daylightMode === 'windows'
      ? s.daylightEmitters ? 'Prototype daylight' : 'Prototype daylight · no window panes' : 'Exterior daylight'
    get('fps').textContent = `${Math.round(s.fps)} FPS`; get('gpu').textContent = s.frozenLighting ? 'Lighting prepared' : `Lighting ${s.lightingGpuMedianMs.toFixed(2)} ms`
    get('progress').textContent = s.frozenLighting ? 'Stable walkthrough' : s.pendingDirect ? 'Updating lights' : s.visibleCards && !s.visibleUnprepared ? 'Live lighting' : 'Preparing visible surfaces'
    const rows = s.frozenLighting ? [
      ['Mode', 'Prepared daylight · no lighting updates during navigation'],
      ['Preparation', `${prepared?.stats().samples} samples · 32 bounces`],
      ['Scene', `${s.triangles.toLocaleString()} triangles`],
      ['Frame p95', `${s.frameP95Ms.toFixed(2)} ms`],
      ['Reflections', 'One local capture at the preparation viewpoint'],
      ['Viewport', `${s.viewport.width} × ${s.viewport.height}`], ['GPU', s.device],
    ] : [['Scene', `${s.triangles.toLocaleString()} triangles · ${s.cards} cards`], ['Cache', `${s.tileResolution} × ${s.tileResolution} · ${s.cacheMiB.toFixed(1)} MiB targets`],
      ['Lighting GPU median / p95', `${s.lightingGpuMedianMs.toFixed(2)} / ${s.lightingGpuP95Ms.toFixed(2)} ms`], ['Frame p95', `${s.frameP95Ms.toFixed(2)} ms`], ['Work per frame', `${s.tilesPerFrame} cards`],
      ['Background surface coverage', `${Math.round(s.preparedCards/s.cards*100)}% · nearby surfaces update first`],
      ['Visible surfaces', `${s.visibleCards-s.visibleUnprepared} / ${s.visibleCards} prepared`],
      ['Viewport', `${s.viewport.width} × ${s.viewport.height}`], ['Shader programs', String(s.programs)], ['GPU', s.device]]
    get('measurements').replaceChildren(...rows.flatMap(([label, value]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; return [dt, dd] }))
  }, loading)
  get<HTMLButtonElement>('prepared-start').disabled=false
  window.addEventListener('pagehide', () => { prepared?.cancel();prepared?.dispose();observer.disconnect();lab.dispose() }, { once: true })
} catch (error) { worker?.terminate(); engine?.dispose(); loading(`Could not start: ${error instanceof Error ? error.message : String(error)}`); console.error(error) }
