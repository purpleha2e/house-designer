import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Image as CanvasImage, Layer, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { GroundImage, Point } from '../types'
import { getTransformDragDelta } from '../transformModifiers'

const PIXELS_PER_METRE = 60

export function GroundImageControls({ image, editing, center, maxSize, onChange, onEditingChange }: {
  image?: GroundImage
  editing: boolean
  center: Point
  maxSize: { width: number; length: number }
  onChange: (image: GroundImage | undefined) => void
  onEditingChange: (editing: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  return <div className="render-options ground-image-controls">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>Floor image</button>
    {open && <div className="render-options-menu ground-image-menu" onKeyDown={event => event.stopPropagation()}>
      <label>{image ? 'Replace image' : 'Upload image'}
        <input type="file" accept="image/*" aria-label="Upload floor image" disabled={loading}
          onChange={async event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            setError(''); setLoading(true)
            const url = URL.createObjectURL(file)
            try {
              const decoded = new Image()
              decoded.src = url
              await decoded.decode()
              // Decode once to a portable PNG, retaining the source alpha channel.
              const canvas = document.createElement('canvas')
              canvas.width = decoded.naturalWidth; canvas.height = decoded.naturalHeight
              const context = canvas.getContext('2d')
              if (!context || !canvas.width || !canvas.height) throw new Error('Invalid image')
              context.drawImage(decoded, 0, 0)
              const width = image?.width ?? Math.min(10, maxSize.width, maxSize.length * canvas.width / canvas.height)
              const length = width * canvas.height / canvas.width
              if (!alive.current) return
              onChange({ dataUrl: canvas.toDataURL('image/png'), name: file.name,
                position: image?.position ?? { x: center.x - width / 2, y: center.y - length / 2 },
                width, length, opacity: image?.opacity ?? 0.5, visible: true })
              onEditingChange(true)
            } catch {
              if (alive.current) setError('Could not read this image. Please choose another file.')
            } finally {
              URL.revokeObjectURL(url)
              if (alive.current) setLoading(false)
            }
          }} />
      </label>
      {loading && <span role="status">Loading image…</span>}
      {error && <span role="alert">{error}</span>}
      {image && <>
        <span className="ground-image-name">{image.name}</span>
        <label><input type="checkbox" checked={image.visible} onChange={event => {
          onChange({ ...image, visible: event.target.checked })
          if (!event.target.checked) onEditingChange(false)
        }} /> Show image</label>
        <label>Opacity {Math.round(image.opacity * 100)}%
          <input type="range" min="0" max="100" value={image.opacity * 100} aria-label="Floor image opacity"
            onChange={event => onChange({ ...image, opacity: Number(event.target.value) / 100 })} />
        </label>
        <span>{image.width.toFixed(2)} × {image.length.toFixed(2)} m</span>
        <button type="button" disabled={!image.visible} aria-pressed={editing}
          onClick={() => onEditingChange(!editing)}>{editing ? 'Done editing image' : 'Move / resize image'}</button>
        {editing && <span>Drag to move; Shift locks movement to horizontal, vertical or diagonal. Corner handles preserve proportions; edge handles adjust width or length.</span>}
        <button type="button" onClick={() => { onChange(undefined); onEditingChange(false) }}>Remove image</button>
      </>}
    </div>}
  </div>
}

export function GroundImageLayer({ image, editing, zoom, onChange }: {
  image: GroundImage
  editing: boolean
  zoom: number
  onChange: (image: GroundImage) => void
}) {
  const [bitmap, setBitmap] = useState<HTMLImageElement | null>(null)
  const node = useRef<Konva.Image>(null)
  const transformer = useRef<Konva.Transformer>(null)
  useEffect(() => {
    let cancelled = false
    const decoded = new Image()
    decoded.src = image.dataUrl
    decoded.decode().then(() => { if (!cancelled) setBitmap(decoded) }).catch(() => { if (!cancelled) setBitmap(null) })
    return () => { cancelled = true }
  }, [image.dataUrl])
  useLayoutEffect(() => {
    if (editing && node.current) transformer.current?.nodes([node.current])
  }, [editing, bitmap])
  const commit = () => {
    const target = node.current
    if (!target) return
    const width = target.width() * target.scaleX() / PIXELS_PER_METRE
    const length = target.height() * target.scaleY() / PIXELS_PER_METRE
    target.scale({ x: 1, y: 1 })
    target.size({ width: width * PIXELS_PER_METRE, height: length * PIXELS_PER_METRE })
    onChange({ ...image, position: { x: target.x() / PIXELS_PER_METRE, y: target.y() / PIXELS_PER_METRE }, width, length })
  }
  if (!image.visible || !bitmap) return null
  return <Layer listening={editing}>
    <CanvasImage ref={node} name="ground-image" image={bitmap} x={image.position.x * PIXELS_PER_METRE}
      y={image.position.y * PIXELS_PER_METRE} width={image.width * PIXELS_PER_METRE}
      height={image.length * PIXELS_PER_METRE} opacity={image.opacity} draggable={editing}
      onPointerDown={event => { event.cancelBubble = true }}
      onDragStart={event => { event.cancelBubble = true }}
      onDragMove={event => {
        event.cancelBubble = true
        const delta = getTransformDragDelta({ x: event.target.x() - image.position.x * PIXELS_PER_METRE,
          y: event.target.y() - image.position.y * PIXELS_PER_METRE }, event.evt)
        event.target.position({ x: image.position.x * PIXELS_PER_METRE + delta.x,
          y: image.position.y * PIXELS_PER_METRE + delta.y })
      }}
      onDragEnd={event => { event.cancelBubble = true; commit() }}
      onTransformEnd={commit} />
    {editing && <Transformer ref={transformer} name="ground-image-handles" rotateEnabled={false}
      flipEnabled={false} keepRatio borderStroke="#248cff" anchorStroke="#248cff" anchorFill="white"
      anchorSize={9} anchorCornerRadius={0}
      onPointerDown={event => { event.cancelBubble = true }}
      boundBoxFunc={(oldBox, newBox) => newBox.width < 0.1 * PIXELS_PER_METRE * zoom ||
        newBox.height < 0.1 * PIXELS_PER_METRE * zoom ? oldBox : newBox} />}
  </Layer>
}
