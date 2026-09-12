import type {
  FloorplanViewportState,
  SavedThreeDViewState,
  SavedTwoDViewState,
  ThreeDViewCameraState,
} from './types.ts'

export const ALL_FLOORS_VIEW_ID = 'all'

export const DEFAULT_THREE_D_CAMERA_STATE: ThreeDViewCameraState = {
  position: { x: 6, y: 5, z: 8 },
  quaternion: { w: 1, x: 0, y: 0, z: 0 },
}

export const DEFAULT_FLOORPLAN_VIEWPORT: FloorplanViewportState = {
  scale: 1,
  x: 0,
  y: 0,
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function normalizeThreeDViewCameraState(
  value: unknown,
): ThreeDViewCameraState {
  if (!value || typeof value !== 'object') {
    return structuredClone(DEFAULT_THREE_D_CAMERA_STATE)
  }

  const camera = value as Partial<ThreeDViewCameraState>
  const position = camera.position
  const quaternion = camera.quaternion

  if (
    !position || !quaternion ||
    !finite(position.x) || !finite(position.y) || !finite(position.z) ||
    !finite(quaternion.w) || !finite(quaternion.x) ||
    !finite(quaternion.y) || !finite(quaternion.z)
  ) {
    return structuredClone(DEFAULT_THREE_D_CAMERA_STATE)
  }

  const quaternionLength = Math.hypot(
    quaternion.w,
    quaternion.x,
    quaternion.y,
    quaternion.z,
  )

  if (quaternionLength <= 0.000001) {
    return structuredClone(DEFAULT_THREE_D_CAMERA_STATE)
  }

  return {
    position: { ...position },
    quaternion: {
      w: quaternion.w / quaternionLength,
      x: quaternion.x / quaternionLength,
      y: quaternion.y / quaternionLength,
      z: quaternion.z / quaternionLength,
    },
  }
}

export function normalizeSavedThreeDViewState(
  value: unknown,
  floorIds: readonly string[],
  activeFloorId: string,
): SavedThreeDViewState {
  const candidate = value && typeof value === 'object'
    ? value as Partial<SavedThreeDViewState>
    : undefined
  const floorViewId =
    candidate?.floorViewId === ALL_FLOORS_VIEW_ID ||
    (typeof candidate?.floorViewId === 'string' && floorIds.includes(candidate.floorViewId))
      ? candidate.floorViewId
      : activeFloorId

  return {
    camera: normalizeThreeDViewCameraState(candidate?.camera),
    floorViewId,
  }
}

export function normalizeFloorplanViewportState(
  value: unknown,
): FloorplanViewportState {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_FLOORPLAN_VIEWPORT }
  }

  const viewport = value as Partial<FloorplanViewportState>

  if (
    !finite(viewport.x) ||
    !finite(viewport.y) ||
    !finite(viewport.scale) ||
    viewport.scale <= 0
  ) {
    return { ...DEFAULT_FLOORPLAN_VIEWPORT }
  }

  return {
    scale: Math.min(4, Math.max(0.45, viewport.scale)),
    x: viewport.x,
    y: viewport.y,
  }
}

export function normalizeSavedTwoDViewState(
  value: unknown,
  floorIds: readonly string[],
): SavedTwoDViewState {
  const candidate = value && typeof value === 'object'
    ? value as Partial<SavedTwoDViewState>
    : undefined
  const savedViewports = candidate?.viewportsByFloorId
  const viewportsByFloorId = Object.fromEntries(
    floorIds.map((floorId) => [
      floorId,
      normalizeFloorplanViewportState(savedViewports?.[floorId]),
    ]),
  )

  return { viewportsByFloorId }
}
