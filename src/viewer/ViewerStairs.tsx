import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import { Group } from 'three'
import type { FloorLevel, Point } from '../types'
import { modelsById } from '../models/modelLibrary'
import { getViewerStairTransitions, type ViewerStairTransition } from './viewerNavigation'
import { createStairLabelOccluder } from './viewerStairOcclusion'

function StairLabel({ transition, elevation, onNavigate }: {
  transition: ViewerStairTransition; elevation: number; onNavigate: (floorId: string, position: Point) => void
}) {
  const scene = useThree(state => state.scene)
  const anchor = useMemo(() => new Group(), [])
  const occluders = useMemo(() => [createStairLabelOccluder(scene, () => anchor)], [scene, anchor])
  return <primitive object={anchor} name={`viewer-stair-label-${transition.id}`}
    position={[transition.from.x, elevation + 1.2, transition.from.y]}>
    <Html center occlude={occluders} zIndexRange={[6, 0]}>
      <button type="button" className="viewer-stair-button" aria-label={transition.label}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onNavigate(transition.targetFloorId, transition.to) }}>
        {transition.label}
      </button>
    </Html>
  </primitive>
}

export function ViewerStairs({ floor, floors, onNavigate }: {
  floor: FloorLevel; floors: FloorLevel[]; onNavigate: (floorId: string, position: Point) => void
}) {
  const transitions = useMemo(() => getViewerStairTransitions(floor, floors, modelsById), [floor, floors])
  return transitions.map(transition => (
    <StairLabel key={transition.id} transition={transition} elevation={floor.elevation} onNavigate={onNavigate} />
  ))
}
