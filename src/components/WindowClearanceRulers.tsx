import { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3, type Object3D } from 'three'
import type { Wall } from '../types'
import { editWindowClearance, getWindowClearances, parseClearanceDistance, type WindowClearance } from '../windowClearances'

const svgNamespace = 'http://www.w3.org/2000/svg'
const captions = { left: 'Left clearance', right: 'Right clearance', sill: 'Floor to sill', head: 'Head to ceiling' }

/** Screen-space annotations stay readable on either face and never enter GI,
 * picking, shadows, retained scene snapshots or the renderer's draw-call list. */
export function WindowClearanceRulers({ object, wall, walls, modelId, openingType = 'window', anchor, center, width, bottom, height, elevation, ceiling, onChange }: {
  object: RefObject<Object3D | null>
  wall: Wall; walls: Wall[]; modelId: string; anchor: [number, number, number]
  openingType?: 'window' | 'patio-door'
  center: number; width: number; bottom: number; height: number; elevation: number; ceiling: number
  onChange: (placement: { center: number; bottom: number }) => void
}) {
  const gl = useThree(state => state.gl)
  const overlay = useRef<SVGSVGElement | null>(null)
  const rows = useRef(new Map<string, { group: SVGGElement; path: SVGPathElement; box: SVGRectElement; text: SVGTextElement }>())
  const scratch = useRef({ point: new Vector3(), camera: new Vector3() })
  const commit = useRef(onChange)
  commit.current = onChange
  const liveInput = useRef<Parameters<typeof getWindowClearances>[0] | null>(null)
  useEffect(() => {
    const root = document.createElementNS(svgNamespace, 'svg')
    root.dataset.windowClearanceRulers = modelId
    root.setAttribute('aria-label', openingType === 'patio-door' ? 'Patio door clearances' : 'Window clearances')
    Object.assign(root.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'hidden', zIndex: '2', display: 'none' })
    const editor = document.createElement('div'), input = document.createElement('input')
    const hint = document.createElement('div'), error = document.createElement('div')
    Object.assign(editor.style, { position: 'absolute', display: 'none', zIndex: '3', width: '220px', maxWidth: 'calc(100% - 16px)', padding: '8px', boxSizing: 'border-box', background: '#f8fafc', color: '#0c4a6e', border: '1px solid #075985', borderRadius: '5px', boxShadow: '0 3px 12px #0004', font: '12px system-ui, sans-serif', pointerEvents: 'auto' })
    input.type = 'text'; input.inputMode = 'decimal'; input.autocomplete = 'off'
    Object.assign(input.style, { width: '100%', boxSizing: 'border-box', padding: '5px', font: '600 14px system-ui, sans-serif', color: '#0c4a6e', background: 'white', border: '1px solid #075985', borderRadius: '3px' })
    hint.textContent = 'Metres, cm or mm · Enter to apply · Esc to cancel'
    hint.style.marginTop = '5px'; error.style.color = '#b91c1c'; error.setAttribute('role', 'alert')
    editor.append(input, hint, error)
    let editing: { kind: WindowClearance['kind']; source: Parameters<typeof getWindowClearances>[0]; group: SVGGElement } | null = null
    const close = (focusLabel = false) => {
      const previous = editing; editing = null; editor.style.display = 'none'; error.textContent = ''
      if (focusLabel) previous?.group.focus()
    }
    editor.addEventListener('pointerdown', event => event.stopPropagation())
    editor.addEventListener('click', event => event.stopPropagation())
    input.addEventListener('keydown', event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); close(true) }
      if (event.key !== 'Enter' || !editing) return
      event.preventDefault()
      try {
        const placement = editWindowClearance(editing.source, editing.kind, parseClearanceDistance(input.value))
        commit.current(placement); close(true)
      } catch (cause) {
        error.textContent = cause instanceof Error ? cause.message : 'Unable to apply this distance.'
        input.setAttribute('aria-invalid', 'true')
      }
    })
    input.addEventListener('blur', () => close())
    for (const kind of ['left', 'right', 'sill', 'head'] as const) {
      const group = document.createElementNS(svgNamespace, 'g'), path = document.createElementNS(svgNamespace, 'path')
      const box = document.createElementNS(svgNamespace, 'rect'), text = document.createElementNS(svgNamespace, 'text')
      group.dataset.measurement = kind
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#075985'); path.setAttribute('stroke-width', '1.5')
      path.style.filter = 'drop-shadow(0 0 1px white)'
      box.setAttribute('fill', '#f8fafc'); box.setAttribute('fill-opacity', '.96'); box.setAttribute('stroke', '#075985'); box.setAttribute('rx', '4')
      text.setAttribute('fill', '#0c4a6e'); text.setAttribute('text-anchor', 'middle'); text.setAttribute('dominant-baseline', 'central')
      text.style.font = '600 12px system-ui, sans-serif'
      const editable = openingType === 'window' || kind === 'left' || kind === 'right'
      if (editable) {
        group.setAttribute('role', 'button'); group.setAttribute('tabindex', '0')
        box.style.pointerEvents = 'auto'; text.style.pointerEvents = 'auto'
        box.style.cursor = 'text'; text.style.cursor = 'text'
        const title = document.createElementNS(svgNamespace, 'title'); title.textContent = 'Click to enter a distance'; group.append(title)
        group.addEventListener('pointerdown', event => event.stopPropagation())
        const open = () => {
          const source = liveInput.current, measurement = source && getWindowClearances(source).find(m => m.kind === kind)
          if (!source || !measurement) return
          editing = { kind, source: { ...source }, group }
          input.value = measurement.distance.toFixed(3); input.setAttribute('aria-label', `Edit ${captions[kind].toLowerCase()}`)
          input.removeAttribute('aria-invalid'); error.textContent = ''
          editor.style.left = `${Math.max(8, Math.min(root.clientWidth - 228, Number(text.getAttribute('x')) - 110))}px`
          editor.style.top = `${Math.max(8, Math.min(root.clientHeight - 120, Number(text.getAttribute('y')) + 16))}px`
          editor.style.display = 'block'; input.focus(); input.select()
        }
        group.addEventListener('click', event => { event.stopPropagation(); open() })
        group.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); open() }
        })
      }
      group.append(path, box, text); root.append(group); rows.current.set(kind, { group, path, box, text })
    }
    gl.domElement.parentElement?.append(root, editor); overlay.current = root
    const elements = rows.current
    return () => { root.remove(); editor.remove(); overlay.current = null; elements.clear() }
  }, [gl, modelId, openingType])

  useFrame(({ camera, size }) => {
    const root = overlay.current, model = object.current
    if (!root) return
    root.style.display = model ? 'block' : 'none'
    if (!model) return
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    if (length < 1e-6) { root.style.display = 'none'; return }
    const ux = (wall.end.x - wall.start.x) / length, uz = (wall.end.y - wall.start.y) / length
    camera.getWorldPosition(scratch.current.camera)
    const side = ((scratch.current.camera.x - wall.start.x) * -uz + (scratch.current.camera.z - wall.start.y) * ux >= 0 ? 1 : -1)
    root.dataset.wallSide = String(side)
    root.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`)
    const liveCenter = center + (model.position.x - anchor[0]) * ux + (model.position.z - anchor[2]) * uz
    const liveBottom = bottom + model.position.y - anchor[1]
    liveInput.current = { wall, walls, modelId, center: liveCenter, width, bottom: liveBottom, height, ceiling, side }
    const measurements = getWindowClearances(liveInput.current)
    for (const row of rows.current.values()) row.group.style.display = 'none'
    const project = ([along, y]: [number, number]) => {
      const normal = side * (wall.thickness / 2 + .025)
      const point = scratch.current.point.set(wall.start.x + ux * along - uz * normal, elevation + y, wall.start.y + uz * along + ux * normal).project(camera)
      return { x: (point.x + 1) * size.width / 2, y: (1 - point.y) * size.height / 2, z: point.z }
    }
    for (const measurement of measurements) {
      const row = rows.current.get(measurement.kind)!, a = project(measurement.from), b = project(measurement.to)
      if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1 || Math.max(a.x, b.x) < 0 || Math.min(a.x, b.x) > size.width || Math.max(a.y, b.y) < 0 || Math.min(a.y, b.y) > size.height) continue
      const dx = b.x - a.x, dy = b.y - a.y, pixels = Math.hypot(dx, dy)
      let nx = pixels > .1 ? -dy / pixels : 1, ny = pixels > .1 ? dx / pixels : 0
      if (ny > .1 || (Math.abs(ny) <= .1 && nx < 0)) { nx = -nx; ny = -ny }
      row.group.style.display = ''
      row.group.dataset.distance = measurement.distance.toFixed(6)
      row.group.dataset.target = measurement.target
      row.path.setAttribute('d', `M${a.x},${a.y}L${b.x},${b.y}M${a.x - nx * 5},${a.y - ny * 5}L${a.x + nx * 5},${a.y + ny * 5}M${b.x - nx * 5},${b.y - ny * 5}L${b.x + nx * 5},${b.y + ny * 5}`)
      const label = `${measurement.distance.toFixed(3)} m`, labelWidth = label.length * 7.5 + 12
      const x = Math.max(labelWidth / 2 + 2, Math.min(size.width - labelWidth / 2 - 2, (a.x + b.x) / 2 + nx * (Math.abs(nx) > .7 ? labelWidth / 2 + 8 : 18)))
      const y = Math.max(13, Math.min(size.height - 13, (a.y + b.y) / 2 + ny * 18))
      const caption = measurement.kind === 'sill' && openingType === 'patio-door' ? 'Floor to threshold' : captions[measurement.kind]
      row.text.textContent = label; row.group.setAttribute('aria-label', `${caption}: ${label}`)
      row.text.setAttribute('x', String(x)); row.text.setAttribute('y', String(y))
      row.box.setAttribute('x', String(x - labelWidth / 2)); row.box.setAttribute('y', String(y - 11))
      row.box.setAttribute('width', String(labelWidth)); row.box.setAttribute('height', '22')
    }
  })
  return null
}
