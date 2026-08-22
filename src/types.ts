export type Point = {
  x: number
  y: number
}

export type WallKind = 'external' | 'internal'

export type Wall = {
  id: string
  kind: WallKind
  start: Point
  end: Point
  thickness: number
  height: number
  openings?: WallOpening[]
}

export type WallOpening = {
  id: string
  modelId: string
  center: number
  width: number
  bottom: number
  height: number
}

export type Room = {
  id: string
  name: string
  signature: string
}

export type SurfaceCategory =
  | 'ceiling'
  | 'flooring'
  | 'paint'
  | 'tile'
  | 'wall-covering'
  | 'worktop'

export type SurfaceFinish =
  | 'eggshell'
  | 'gloss'
  | 'matt'
  | 'satin'
  | 'textured'

export type SurfaceWallSide = -1 | 1 | 'both'

export type SurfaceTarget =
  | {
      type: 'room-floor'
      floorId: string
      roomSignature: string
    }
  | {
      type: 'floor'
      floorId: string
    }
  | {
      type: 'wall-face'
      side: SurfaceWallSide
      wallId: string
    }
  | {
      type: 'ceiling'
      floorId: string
      roomSignature?: string
    }

export type SurfaceMaterialPbr = {
  ambientOcclusionTextureUrl?: string
  baseColor?: string
  baseColorTextureUrl?: string
  displacementScale?: number
  displacementTextureUrl?: string
  metalness?: number
  metalnessTextureUrl?: string
  normalTextureUrl?: string
  realWorldHeightMeters?: number
  realWorldWidthMeters?: number
  repeatX?: number
  repeatY?: number
  rotation?: number
  roughness?: number
  roughnessTextureUrl?: string
}

export type SurfaceMaterialProduct = {
  category: SurfaceCategory
  collection?: string
  colourFamily?: string
  finish?: SurfaceFinish
  id: string
  manufacturer: string
  materialType?: string
  pbr: SurfaceMaterialPbr
  productName: string
  productUrl?: string
  sku?: string
  tags?: string[]
}

export type SurfaceMaterialAssignment = {
  coverageHeight?: number
  id: string
  materialId: string
  target: SurfaceTarget
  textureRotation?: number
  textureScale?: number
}

export type SelectableSurface =
  | {
      floorId: string
      roomSignature: string
      type: 'room-floor'
    }
  | {
      floorId: string
      roomSignature: string
      type: 'ceiling'
    }
  | {
      floorId: string
      wallId: string
      type: 'wall-face'
    }

export type PlacedModel = {
  id: string
  height?: number
  lightColor?: string
  lightEnabled?: boolean
  lightPower?: number
  lightSpread?: number
  modelId: string
  position: Point
  rotation: number
  scale: number
  wallAttachment?: WallAttachment
}

export type WallAttachment = {
  wallId: string
  offset: number
}

export type FloorLevel = {
  id: string
  name: string
  elevation: number
  models: PlacedModel[]
  rooms: Room[]
  roomHeight: number
  slabThickness: number
  walls: Wall[]
}
