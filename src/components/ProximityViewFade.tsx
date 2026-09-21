import { createContext, useContext, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  Box3,
  Frustum,
  Matrix4,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
} from 'three'
import { getNearbyVisibleBoundsOpacity } from '../wallViewOcclusion'

export const RoofViewFadeContext = createContext(false)

type MaterialState = Pick<Material,
  'alphaHash' | 'depthWrite' | 'forceSinglePass' | 'opacity' | 'transparent'>

const excludedRoles = new Set([
  'roof-underside-highlight',
])

function isFadeSurface(object: Object3D): object is Mesh {
  return 'isMesh' in object && object.isMesh === true &&
    typeof object.userData.houseDesignerRole === 'string' &&
    !excludedRoles.has(object.userData.houseDesignerRole as string)
}

function collectFadeSurfaceBounds(object: Object3D, bounds: Box3, scratch: Box3) {
  bounds.makeEmpty()
  object.updateWorldMatrix(true, true)
  object.traverse((candidate) => {
    if (!isFadeSurface(candidate) || !candidate.visible) return
    if (!candidate.geometry.boundingBox) candidate.geometry.computeBoundingBox()
    if (!candidate.geometry.boundingBox) return
    scratch.copy(candidate.geometry.boundingBox).applyMatrix4(candidate.matrixWorld)
    bounds.union(scratch)
  })
  return bounds
}

function collectMaterials(object: Object3D) {
  const materials = new Set<Material>()
  object.traverse((candidate) => {
    if (!isFadeSurface(candidate)) return
    const attached = Array.isArray(candidate.material) ? candidate.material : [candidate.material]
    attached.forEach(material => materials.add(material))
  })
  return materials
}

export function isProximityFadedObject(object: Object3D) {
  let current: Object3D | null = object
  while (current) {
    if (current.userData.proximityFadeOpacity !== undefined) return true
    current = current.parent
  }
  return false
}

export function useProximityViewFade({ objectRef, eligible = true }: {
  objectRef: RefObject<Object3D | null>
  eligible?: boolean
}) {
  const enabled = useContext(RoofViewFadeContext) && eligible
  const materials = useRef(new Map<Material, MaterialState>())
  const viewDirty = useRef(true)
  const view = useMemo(() => ({
    bounds: new Box3(),
    frustum: new Frustum(),
    matrix: new Matrix4(),
    previousMatrix: new Matrix4(),
    position: new Vector3(),
    scratchBounds: new Box3(),
  }), [])

  const restore = () => {
    const object = objectRef.current
    if (object) delete object.userData.proximityFadeOpacity
    materials.current.forEach((state, material) => {
      material.alphaHash = state.alphaHash
      material.depthWrite = state.depthWrite
      material.forceSinglePass = state.forceSinglePass
      material.opacity = state.opacity
      material.transparent = state.transparent
      material.needsUpdate = true
    })
    materials.current.clear()
  }

  const apply = (object: Object3D, opacity: number) => {
    const attached = collectMaterials(object)
    materials.current.forEach((state, material) => {
      if (attached.has(material)) return
      material.alphaHash = state.alphaHash
      material.depthWrite = state.depthWrite
      material.forceSinglePass = state.forceSinglePass
      material.opacity = state.opacity
      material.transparent = state.transparent
      material.needsUpdate = true
      materials.current.delete(material)
    })
    attached.forEach((material) => {
      let original = materials.current.get(material)
      if (!original) {
        original = {
          alphaHash: material.alphaHash,
          depthWrite: material.depthWrite,
          forceSinglePass: material.forceSinglePass,
          opacity: material.opacity,
          transparent: material.transparent,
        }
        materials.current.set(material, original)
        material.alphaHash = false
        material.depthWrite = false
        material.forceSinglePass = true
        material.transparent = true
        material.needsUpdate = true
      }
      material.opacity = original.opacity * opacity
    })
    object.userData.proximityFadeOpacity = opacity
  }

  useLayoutEffect(() => {
    viewDirty.current = true
  })
  useLayoutEffect(() => restore, [])

  useFrame(({ camera }) => {
    const object = objectRef.current
    if (!object || !enabled) {
      if (materials.current.size > 0) restore()
      return
    }

    camera.updateWorldMatrix(true, false)
    view.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    if (!viewDirty.current && view.previousMatrix.equals(view.matrix)) return
    viewDirty.current = false
    view.previousMatrix.copy(view.matrix)
    view.position.setFromMatrixPosition(camera.matrixWorld)
    view.frustum.setFromProjectionMatrix(view.matrix)
    collectFadeSurfaceBounds(object, view.bounds, view.scratchBounds)
    const opacity = getNearbyVisibleBoundsOpacity({
      bounds: view.bounds,
      camera: view.position,
      frustum: view.frustum,
    })
    if (opacity === null || opacity >= 1) restore()
    else apply(object, opacity)
  })
}
