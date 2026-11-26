import { useMemo } from 'react'
import type { PictureFrameDesign } from '../pictureFrameDesign'
import { createPictureFrameGeometry } from '../pictureFrameGeometry'
import { ParametricObjectMesh, type ParametricObjectMeshProps } from './ParametricObjectMesh'

export function PictureFrameMesh({ design, ...props }: ParametricObjectMeshProps & { design: PictureFrameDesign }) {
  const group = useMemo(() => createPictureFrameGeometry(design), [design])
  return <ParametricObjectMesh group={group} {...props} />
}
