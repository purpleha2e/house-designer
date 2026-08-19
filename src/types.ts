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

export type PlacedModel = {
  id: string
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
