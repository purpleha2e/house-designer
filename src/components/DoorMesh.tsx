import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Scene } from 'three'
import { normalizeDoorAngles, type DoorAngles, type DoorDesign } from '../doorDesign'
import { createDoorGeometry, setDoorLeafAngles } from '../doorGeometry'
import { ParametricObjectMesh, type ParametricObjectMeshProps } from './ParametricObjectMesh'

const swingSeconds = .36

function requestPoseDraw(scene: Scene, invalidate: () => void) {
  scene.userData.displayEffectRevision = (scene.userData.displayEffectRevision ?? 0) + 1
  invalidate()
}

export function DoorMesh({ design, wallThickness, depthScale, angles, ...props }: ParametricObjectMeshProps & {
  design: DoorDesign; wallThickness: number; depthScale?: number; angles?: DoorAngles
}) {
  const group = useMemo(() => createDoorGeometry(design, wallThickness, depthScale), [design, wallThickness, depthScale])
  const { invalidate, scene } = useThree()
  const [left, right] = normalizeDoorAngles(angles)
  const pose = useRef<DoorAngles>([left, right])
  const target = useRef<DoorAngles>([left, right])
  const swing = useRef<{ from: DoorAngles; elapsed: number } | null>(null)

  useLayoutEffect(() => {
    if (target.current[0] !== left || target.current[1] !== right) {
      target.current = [left, right]
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        swing.current = null
        pose.current = target.current
      } else {
        swing.current = { from: pose.current, elapsed: 0 }
      }
    }
    setDoorLeafAngles(group, design, pose.current)
    requestPoseDraw(scene, invalidate)
  }, [left, right, design, group, invalidate, scene])

  useFrame((_, delta) => {
    const motion = swing.current
    if (!motion) return
    motion.elapsed += Math.min(delta, .05)
    const progress = Math.min(1, motion.elapsed / swingSeconds)
    const eased = progress * progress * (3 - 2 * progress)
    const [a, b] = target.current
    pose.current = progress === 1 ? target.current : [motion.from[0] + (a - motion.from[0]) * eased,
      motion.from[1] + (b - motion.from[1]) * eased]
    setDoorLeafAngles(group, design, pose.current)
    if (progress === 1) swing.current = null
    requestPoseDraw(scene, invalidate)
  })

  return <ParametricObjectMesh group={group} {...props} />
}
