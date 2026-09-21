import { createContext, useContext, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  Frustum,
  FrontSide,
  Matrix4,
  Vector3,
  type BufferGeometry,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from 'three'
import { getNearbyVisibleWallOpacities } from '../wallViewOcclusion'
import type { Wall } from '../types'
import type { WallBufferGeometryPayload } from '../wallEngine/wallBuffer'
import type { WallMeshFace } from '../wallEngine/wallMesh'

export const WallViewFadeContext = createContext(false)

export function isFadedWallSurface(object: Object3D, surface: { type: string; wallId?: string }) {
  return surface.wallId !== undefined &&
    (object.userData.fadedWallIds as Set<string> | undefined)?.has(surface.wallId) === true
}

type FadeMaterialVariant = {
  material: MeshStandardMaterial
  wallId: string
}

type FadeMaterialState = {
  mesh: Mesh
  originals: MeshStandardMaterial[]
  variants: FadeMaterialVariant[]
  versions: number[]
}

export function useWallViewFade({ meshRef, pickMeshRef, geometry, payload, faces, elevation, walls }: {
  meshRef: RefObject<Object3D | null>
  pickMeshRef: RefObject<Object3D | null>
  geometry: BufferGeometry
  payload: WallBufferGeometryPayload
  faces: WallMeshFace[]
  elevation: number
  walls: Wall[]
}) {
  const enabled = useContext(WallViewFadeContext)
  const view = useMemo(() => ({
    position: new Vector3(), frustum: new Frustum(), matrix: new Matrix4(),
    previousMatrix: new Matrix4(),
  }), [])
  const viewDirty = useRef(true)
  const materialState = useRef<FadeMaterialState | null>(null)
  const state = useMemo(() => ({
    faceWalls: new Map(faces.map(face => [face.faceId, face.wallId])),
    faded: new Set<string>(),
  }), [faces])

  useLayoutEffect(() => {
    viewDirty.current = true
  }, [enabled])

  const getOriginalMaterials = () => {
    const mesh = meshRef.current as Mesh | null
    if (!mesh) return null
    const attached = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshStandardMaterial[]
    const originals = attached.slice(0, payload.materialSlots.length)
    return originals.length === payload.materialSlots.length ? { mesh, originals } : null
  }

  const restoreOpaqueGroups = () => {
    geometry.clearGroups()
    payload.groups.forEach(group => {
      geometry.addGroup(group.start, group.count, group.materialIndex)
    })
  }

  const disposeFadeMaterials = () => {
    const current = materialState.current
    if (!current) return
    current.mesh.material = current.originals
    current.variants.forEach(({ material }) => material.dispose())
    materialState.current = null
  }

  const rebuildFadeGroups = (opacities: Map<string, number>) => {
    const source = getOriginalMaterials()
    if (!source) return
    disposeFadeMaterials()

    if (opacities.size === 0) {
      source.mesh.material = source.originals
      restoreOpaqueGroups()
      return
    }

    const variants: FadeMaterialVariant[] = []
    const variantIndices = new Map<string, number>()
    const materialIndexForWall = (originalIndex: number, wallId: string) => {
      const key = `${originalIndex}:${wallId}`
      const existing = variantIndices.get(key)
      if (existing !== undefined) return existing

      const original = source.originals[originalIndex]
      const material = original.clone()
      material.onBeforeCompile = original.onBeforeCompile.bind(original)
      material.customProgramCacheKey = original.customProgramCacheKey.bind(original)
      material.opacity = opacities.get(wallId) ?? 1
      material.transparent = true
      material.alphaHash = false
      material.depthWrite = false
      // A solid wall has opposing exterior and interior skins. Rendering both
      // while transparent blends them in geometry order, so a camera rotation
      // can make the perceived fade appear to reverse. The wall mesh has
      // outward winding on every face; its camera-facing skin is sufficient.
      material.side = FrontSide
      material.forceSinglePass = true
      const materialIndex = source.originals.length + variants.length
      variants.push({ material, wallId })
      variantIndices.set(key, materialIndex)
      return materialIndex
    }

    geometry.clearGroups()
    for (const group of payload.groups) {
      let runMaterialIndex: number | undefined
      let runStart = group.start
      let runCount = 0
      const flush = () => {
        if (runCount === 0 || runMaterialIndex === undefined) return
        geometry.addGroup(runStart, runCount, runMaterialIndex)
      }

      group.faceIds.forEach((faceId, faceIndex) => {
        const wallId = state.faceWalls.get(faceId)
        const materialIndex = wallId && opacities.has(wallId)
          ? materialIndexForWall(group.materialIndex, wallId)
          : group.materialIndex
        const faceStart = group.start + faceIndex * 6
        if (runMaterialIndex !== undefined && materialIndex !== runMaterialIndex) {
          flush()
          runStart = faceStart
          runCount = 0
        }
        runMaterialIndex = materialIndex
        runCount += 6
      })
      flush()
    }

    source.mesh.material = [
      ...source.originals,
      ...variants.map(({ material }) => material),
    ]
    materialState.current = {
      mesh: source.mesh,
      originals: source.originals,
      variants,
      versions: source.originals.map(material => material.version),
    }
  }

  const fadeMaterialsNeedRefresh = () => {
    const current = materialState.current
    if (!current) return false
    return current.originals.some((material, index) =>
      material.version !== current.versions[index])
  }

  const updateFadeOpacities = (opacities: Map<string, number>) => {
    const current = materialState.current
    if (!current || fadeMaterialsNeedRefresh()) {
      rebuildFadeGroups(opacities)
      return
    }
    current.variants.forEach(({ material, wallId }) => {
      material.opacity = opacities.get(wallId) ?? 1
    })
  }

  useLayoutEffect(() => {
    viewDirty.current = true
    return () => {
      const current = materialState.current
      if (!current) return
      current.mesh.material = current.originals
      current.variants.forEach(({ material }) => material.dispose())
      materialState.current = null
    }
  }, [geometry, state])

  useLayoutEffect(() => {
    const pickMesh = pickMeshRef.current
    if (!pickMesh) return
    pickMesh.userData.fadedWallIds = state.faded
    return () => { delete pickMesh.userData.fadedWallIds }
  }, [pickMeshRef, state])

  useFrame(({ camera }) => {
    camera.updateWorldMatrix(true, false)
    view.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    if (!viewDirty.current && view.previousMatrix.equals(view.matrix)) return

    viewDirty.current = false
    view.previousMatrix.copy(view.matrix)
    view.position.setFromMatrixPosition(camera.matrixWorld)
    view.frustum.setFromProjectionMatrix(view.matrix)
    const opacities = enabled ? getNearbyVisibleWallOpacities({
      camera: view.position, frustum: view.frustum, elevation, walls,
    }) : new Map<string, number>()
    const fadedIdsChanged = opacities.size !== state.faded.size ||
      [...opacities.keys()].some(wallId => !state.faded.has(wallId))

    if (fadedIdsChanged) {
      state.faded.clear()
      opacities.forEach((_, wallId) => state.faded.add(wallId))
      rebuildFadeGroups(opacities)
    } else if (opacities.size > 0) {
      updateFadeOpacities(opacities)
    }
  })
}
