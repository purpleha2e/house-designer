import { useEffect, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Object3D } from 'three'
import { createModelSelectionHighlight } from '../modelSelectionHighlight'

export function ModelSelectionHighlight({ object, selected = true }: {
  object: RefObject<Object3D | null>; selected?: boolean
}) {
  const [highlight] = useState(createModelSelectionHighlight)
  useEffect(() => () => highlight.dispose(), [highlight])
  useFrame(() => highlight.sync(object.current, selected))
  return null
}
