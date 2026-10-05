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
  allowRoofClipHeight?: boolean
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
  ceilingMode?: 'horizontal' | 'open'
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

export type WallSurfaceFragmentReference = {
  fragmentId: string
  side: Exclude<SurfaceWallSide, 'both'>
  wallId: string
}

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
      type: 'wall-surface-fragment'
      fragmentId: string
      side: SurfaceWallSide
      wallId: string
    }
  | {
      type: 'ceiling'
      floorId: string
      roomSignature?: string
    }
  | {
      type: 'floor-slab-edge'
      floorId: string
    }
  | {
      type: 'portal-floor'
      floorId: string
      openingId: string
      wallId: string
    }
  | {
      type: 'roof'
      part?: 'underside' | 'gable' | 'gable-interior'
      gableEnd?: 'minY' | 'maxY' | 'minX' | 'maxX'
      spaceFloorId?: string
      floorId: string
      roofId: string
    }

export type SurfaceMaterialVariation = {
  enabled: boolean
  mode: 'surface' | 'brick'
  brickStrength: number
  broadStrength: number
  broadScaleMeters: number
  seed: number
  bricksAcross: number
  brickRows: number
  rowOffset: number
  offsetU: number
  offsetV: number
}

export type SurfaceMaterialPbr = {
  proceduralVariation?: SurfaceMaterialVariation
  ambientOcclusionTextureUrl?: string
  baseColor?: string
  baseColorTextureUrl?: string
  displacementScale?: number
  displacementTextureUrl?: string
  imageBasedLighting?: boolean
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
  customColor?: string
  id: string
  materialId: string
  target: SurfaceTarget
  textureRotation?: number
  textureScale?: number
}

export type WallFaceReference = {
  side: Exclude<SurfaceWallSide, 'both'>
  wallId: string
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
      adjoiningWallFaces?: WallFaceReference[]
      floorId: string
      side: Exclude<SurfaceWallSide, 'both'>
      wallFaces?: WallFaceReference[]
      wallId: string
      type: 'wall-face'
    }
  | {
      adjoiningFragments?: WallSurfaceFragmentReference[]
      floorId: string
      fragmentId: string
      fragments?: WallSurfaceFragmentReference[]
      pickedFragment?: WallSurfaceFragmentReference
      side: Exclude<SurfaceWallSide, 'both'>
      wallId: string
      type: 'wall-surface-fragment'
    }
  | {
      floorId: string
      type: 'floor-slab-edge'
    }
  | {
      floorId: string
      openingId: string
      type: 'portal-floor'
      wallId: string
    }
  | {
      floorId: string
      roofId: string
      type: 'roof'
      part?: 'underside' | 'gable' | 'gable-interior'
      gableEnd?: 'minY' | 'maxY' | 'minX' | 'maxX'
      spaceFloorId?: string
    }

export type PlacedModel = {
  /** Dormer body dimensions before the placed model's scale is applied. */
  dormerWidth?: number
  dormerHeight?: number
  dormerWindowModelId?: string
  /** Derived local openings; an empty array means a windowless dormer. */
  dormerWindowOpenings?: WallOpening[]
  /** Position on the parent dormer's front, in its unscaled local metres. */
  dormerAttachment?: { dormerId: string; offset: number; bottom: number }
  flipped?: boolean
  id: string
  height?: number
  lightColor?: string
  lightDistance?: number
  lightEnabled?: boolean
  lightFalloff?: number
  lightPower?: number
  lightSpread?: number
  mirrored?: boolean
  materialOverrides?: Record<string, string>
  modelId: string
  position: Point
  roofAttachment?: RoofAttachment
  rotation: number
  scale: number
  wallOpeningBottom?: number
  widthScale?: number
  depthScale?: number
  wallAttachment?: WallAttachment
}

export type RoofAttachment = {
  localPosition: Point
  roofId: string
  surface: 'negative-x' | 'positive-x' | 'negative-y' | 'positive-y'
}

export type WallAttachment = {
  wallId: string
  offset: number
  side?: -1 | 1
}

export type RoofEndConnection =
  | { mode: 'automatic' | 'exposed' }
  | { mode: 'join'; targetRoofId: string }

export type RoofEndChamfer = {
  angleDegrees: number
  distance: number
}

export type RoofStructure = {
  // Bay outline in support-relative coordinates; the first edge is the rear.
  bayOutline?: Point[]
  /** Ridge length from the mounting edge towards the bay front, in metres. */
  bayRidgeLength?: number
  // Derived from supporting walls during geometry resolution, not authored.
  baySupportOffsets?: number[]
  thickness?: number
  /** Whether this roof may trim house geometry and other roofs. Defaults to true. */
  clipsGeometry?: boolean
  /** Trim this roof's supporting wall tops independently of general clipping. */
  fitSupportingWalls?: boolean
  /** Gable slopes share a fixed ridge instead of equal eave heights. */
  asymmetricSides?: boolean
  /** The mounted side meets the support height; its pitch follows the ridge. */
  mountSide?: 'auto' | 'side1' | 'side2' | 'free'
  /** Ridge displacement from the support centre towards side 2, in metres. */
  ridgeOffset?: number
  /** Ridge height above the roof's wall-top datum, before heightOffset. */
  ridgeHeight?: number
  ridgeHeightTargetRoofId?: string
  ridgeEndChamfer?: RoofEndChamfer
  ridgeStart?: RoofEndConnection
  ridgeStartChamfer?: RoofEndChamfer
  ridgeEnd?: RoofEndConnection
  depth: number
  heightOffset?: number
  id: string
  overhangEnd?: number
  overhangPitchDegrees?: number
  soffitColor?: string
  overhangSide?: number
  overhangSideNegative?: number
  overhangSidePositive?: number
  pitchDegrees: number
  position: Point
  rotation: number
  supportDepth?: number
  supportPosition?: Point
  supportWidth?: number
  type: 'flat' | 'hip' | 'lean-to' | 'up-and-over' | 'bay'
  width: number
}

export type GroundImage = {
  /** Embedded image, so the project remains portable. */
  dataUrl: string
  name: string
  position: Point
  width: number
  length: number
  opacity: number
  visible: boolean
}

export type FloorLevel = {
  groundImage?: GroundImage
  /** Independent slab boundary for a loft, without perimeter walls. */
  floorFootprints?: Point[][]
  id: string
  name: string
  elevation: number
  models: PlacedModel[]
  roofs?: RoofStructure[]
  rooms: Room[]
  roomHeight: number
  /** Top-storey ceiling; intermediate floors always retain their ceiling. */
  ceilingMode?: 'horizontal' | 'open'
  /** Intermediate floor assembly depth, not necessarily a concrete slab. */
  slabThickness: number
  walls: Wall[]
}

export type SunPosition = {
  azimuth: number
  elevation: number
}

export type ThreeDViewCameraState = {
  position: { x: number; y: number; z: number }
  quaternion: { w: number; x: number; y: number; z: number }
}

export type FloorplanViewportState = {
  scale: number
  x: number
  y: number
}

export type SavedTwoDViewState = {
  viewportsByFloorId: Record<string, FloorplanViewportState>
}

export type SavedThreeDViewState = {
  camera: ThreeDViewCameraState
  /** A floor id, or `all` when the combined storey view is active. */
  floorViewId: string
}
