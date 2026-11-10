import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { getWallOpeningPreview } from '../wallOpeningPreview'
import type { FloorLevel, SurfaceMaterialAssignment } from '../types'
import type { ModelTransformPreviewRef } from '../modelTransformPreview'
import { getWallMountForPoint, syncWallOpenings } from '../modelPlacement'
import { modelsById } from '../models/modelLibrary'

export function WallOpeningPreview({ liveFloors, modelPreview, assignments }: { liveFloors: { current: FloorLevel[] }; modelPreview?: ModelTransformPreviewRef; assignments: SurfaceMaterialAssignment[] }) {
  const { scene, invalidate } = useThree()
  const previous = useRef<{ floors?: FloorLevel[]; preview?: ModelTransformPreviewRef['current']; assignments?: SurfaceMaterialAssignment[] }>({})
  useFrame(() => {
    const floors = liveFloors.current, preview = modelPreview?.current
    if (previous.current.floors === floors && previous.current.preview === preview && previous.current.assignments === assignments) return
    previous.current = { floors, preview, assignments }
    const next = !preview ? floors : floors.map(floor => {
      const model = floor.models.find(model => model.id === preview.modelId)
      if (!model || !(model.wallAttachment || preview.updates.wallAttachment)) return floor
      const mount = preview.updates.position && !preview.updates.wallAttachment ? getWallMountForPoint(preview.updates.position, floor.walls) : null
      const updated = { ...model, ...preview.updates, ...(mount ? { position: mount.position, rotation: mount.rotation, wallAttachment: mount.wallAttachment } : {}) }
      return syncWallOpenings({ ...floor, models: floor.models.map(candidate => candidate.id === model.id ? updated : candidate) }, modelsById)
    })
    getWallOpeningPreview(scene).update(next, assignments); invalidate()
  })
  useLayoutEffect(() => {
    previous.current = {}; invalidate()
  }, [scene, assignments, invalidate])
  useLayoutEffect(() => () => getWallOpeningPreview(scene).dispose(), [scene])
  return null
}
