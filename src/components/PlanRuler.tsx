import { useEffect, useMemo, useState } from 'react'
import { Arrow, Circle, Group, Layer, Rect, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Point, FloorplanViewportState } from '../types'
import type { WallBodyPerimeter } from '../wallEngine/wallBodyPerimeter'
import { getRulerPoint } from '../planRuler'

/** Own layer/state keeps pointer updates out of the house and 3D renderer. */
export function PlanRuler({ perimeters, viewport, size, onExit }: {
  perimeters: WallBodyPerimeter[]; viewport: FloorplanViewportState
  size: { width: number; height: number }; onExit: () => void
}) {
  const [start, setStart] = useState<Point | null>(null)
  const [pointer, setPointer] = useState<Point | null>(null)
  const [finished, setFinished] = useState<Point | null>(null)
  const [ctrl, setCtrl] = useState(false)
  const segments = useMemo(() => perimeters.flatMap(body => [body.outline, ...body.holes]
    .flatMap(ring => ring.map((point, i) => ({ start: point, end: ring[(i + 1) % ring.length] })))), [perimeters])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      setCtrl(event.ctrlKey)
      if (event.key === 'Escape' && event.type === 'keydown') { event.preventDefault(); onExit() }
    }
    const blur = () => setCtrl(false)
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur) }
  }, [onExit])
  const scale = viewport.scale, unit = 1 / scale
  const snap = pointer ? getRulerPoint(pointer, segments, 10 / (60 * scale), finished ? null : start, ctrl) : null
  const end = finished ?? snap?.point
  const measurement = start && end ? Math.hypot(end.x - start.x, end.y - start.y) : null
  const readPointer = (event: KonvaEventObject<PointerEvent>) => {
    const p = event.target.getStage()?.getPointerPosition()
    return p ? { x: (p.x - viewport.x) / scale / 60, y: (p.y - viewport.y) / scale / 60 } : null
  }
  const label = measurement !== null ? `${measurement.toFixed(3)} m` : ''
  const labelWidth = Math.max(88, label.length * 8 + 20) * unit
  return <Layer name="plan-ruler">
    <Rect name="ruler-input" x={-viewport.x / scale} y={-viewport.y / scale}
      width={size.width / scale} height={size.height / scale} fill="transparent"
      onPointerDown={event => {
        if (event.evt.button !== 0) return
        event.cancelBubble = true
        const raw = readPointer(event)
        if (!raw) return
        const result = getRulerPoint(raw, segments, 10 / (60 * scale), finished ? null : start, event.evt.ctrlKey)
        setPointer(raw); setCtrl(event.evt.ctrlKey)
        if (!start || finished) { setStart(result.point); setFinished(null) }
        else setFinished(result.point)
      }}
      onPointerMove={event => {
        if (event.evt.buttons & 4) return // Let the stage handle middle-button panning.
        event.cancelBubble = true
        setPointer(readPointer(event)); setCtrl(event.evt.ctrlKey)
      }}
      onClick={event => { event.cancelBubble = true }}
      onContextMenu={event => { event.evt.preventDefault(); event.cancelBubble = true }} />
    <Group listening={false}>
      {start && end && <>
        <Arrow name="ruler-measurement" points={[start.x * 60, start.y * 60, end.x * 60, end.y * 60]}
          stroke="#0369a1" fill="#0369a1" strokeWidth={1.8 * unit} dash={[2 * unit, 5 * unit]}
          lineCap="round" pointerAtBeginning pointerAtEnding pointerLength={8 * unit} pointerWidth={7 * unit} />
        <Group x={(start.x + end.x) * 30} y={(start.y + end.y) * 30 - 30 * unit}>
          <Rect x={-labelWidth / 2} width={labelWidth} height={24 * unit} cornerRadius={4 * unit}
            fill="white" stroke="#0369a1" strokeWidth={unit} />
          <Text name="ruler-reading" x={-labelWidth / 2} width={labelWidth} y={5 * unit}
            text={label} fontSize={14 * unit} align="center" fill="#075985" />
        </Group>
      </>}
      {!finished && snap && <Circle name="ruler-snap" x={snap.point.x * 60} y={snap.point.y * 60}
        radius={(snap.snapped ? 5 : 3) * unit} stroke={snap.snapped ? '#059669' : '#0369a1'}
        fill="white" strokeWidth={2 * unit} />}
    </Group>
  </Layer>
}
