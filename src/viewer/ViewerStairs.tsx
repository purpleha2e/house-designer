import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import type { FloorLevel, Point } from '../types'
import { modelsById } from '../models/modelLibrary'
import { getViewerStairTransitions } from './viewerNavigation'

export function ViewerStairs({ floor, floors, onNavigate }: {
  floor: FloorLevel; floors: FloorLevel[]; onNavigate: (floorId: string, position: Point) => void
}) {
  const transitions = useMemo(() => getViewerStairTransitions(floor, floors, modelsById), [floor, floors])
  return transitions.map(transition => (
    <Html key={transition.id} position={[transition.from.x, floor.elevation + 1.2, transition.from.y]}
      center occlude zIndexRange={[6, 0]}>
      <button type="button" className="viewer-stair-button" aria-label={transition.label}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onNavigate(transition.targetFloorId, transition.to) }}>
        {transition.label}
      </button>
    </Html>
  ))
}
