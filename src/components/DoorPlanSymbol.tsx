import { Group, Line, Rect, Shape } from 'react-konva'

export function DoorPlanSymbol({ width, wallThickness, leafCount, selected = false, angles, hingeSide = -1, swingDirection = -1 }: {
  width: number
  wallThickness: number
  leafCount: 1 | 2
  selected?: boolean
  angles?: [number, number]
  hingeSide?: -1 | 1
  swingDirection?: -1 | 1
}) {
  const stroke = selected ? '#2563eb' : '#334155'
  const jambWidth = Math.min(2, width / 12, wallThickness / 3)
  const clearWidth = width - 2 * jambWidth
  const radius = clearWidth / leafCount
  const leafThickness = Math.min(1.75, wallThickness / 4, radius / 10)
  return <Group name="door-plan-symbol">
    <Rect name="door-opening-mask" x={-width / 2} y={-wallThickness / 2}
      width={width} height={wallThickness} fill="#f8fafc" />
    <Line name="door-threshold" points={[-clearWidth / 2, wallThickness / 2, clearWidth / 2, wallThickness / 2]}
      stroke={selected ? stroke : '#94a3b8'} strokeWidth={0.75} strokeScaleEnabled={false}
      dash={[3, 3]} listening={false} />
    {[-1, 1].map(side => <Rect key={side} name="door-jamb"
      x={side < 0 ? -width / 2 : width / 2 - jambWidth} y={-wallThickness / 2}
      width={jambWidth} height={wallThickness} fill="#e2e8f0"
      stroke={stroke} strokeWidth={selected ? 2 : 1.25} strokeScaleEnabled={false} />)}
    {(leafCount === 2 ? [-1, 1] : [hingeSide]).map((side, index) => <Group key={side}
      x={side * clearWidth / 2} y={angles ? 0 : -wallThickness / 2} scaleX={-side}>
      <Rect name="door-leaf" x={0} y={angles ? -leafThickness / 2 : -radius}
        width={angles ? radius : leafThickness} height={angles ? leafThickness : radius}
        rotation={angles ? angles[index] * swingDirection : 0}
        fill="#f8fafc" stroke={stroke} strokeWidth={selected ? 2 : 1.25}
        strokeScaleEnabled={false} hitStrokeWidth={12} />
      <Shape name="door-swing" stroke={stroke} strokeWidth={selected ? 1.75 : 1}
        strokeScaleEnabled={false}
        sceneFunc={(context, shape) => {
          context.beginPath()
          context.arc(0, 0, radius, 0, swingDirection * Math.PI / 2, swingDirection < 0)
          context.strokeShape(shape)
        }}
        hitFunc={(context, shape) => {
          // The clear swing area remains easy to select and drag.
          context.beginPath()
          context.moveTo(0, 0)
          context.arc(0, 0, radius, 0, swingDirection * Math.PI / 2, swingDirection < 0)
          context.closePath()
          context.fillStrokeShape(shape)
        }} fillEnabled fill="rgba(0,0,0,0)" />
    </Group>)}
  </Group>
}
