import { Arrow, Group, Line } from 'react-konva'
import { getStairLayout, type StairDesign } from '../stairDesign'

export function StairPlanSymbol({ design, scaleX, scaleY, selected }: {
  design: StairDesign; scaleX: number; scaleY: number; selected: boolean
}) {
  const layout = getStairLayout(design)
  return <Group name="parametric-stair-plan" scaleX={scaleX} scaleY={scaleY}>
    {layout.surfaces.map((surface, i) => <Line key={i} points={surface.polygon.flatMap(p => [p.x, p.z])}
      closed fill={design.finishes.treads.color} opacity={.85} stroke={selected ? '#2563eb' : '#475569'}
      strokeWidth={selected ? 2 : 1} strokeScaleEnabled={false} />)}
    {layout.flights.map((flight, i) => {
      const a = flight.left[0], b = flight.left.at(-1)!, ar = flight.right[0], br = flight.right.at(-1)!
      return <Arrow key={i} points={[(a.x + ar.x) / 2, (a.z + ar.z) / 2, (b.x + br.x) / 2, (b.z + br.z) / 2]}
        pointerLength={.10} pointerWidth={.10} stroke="#176f9d" fill="#176f9d" strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
    })}
  </Group>
}
