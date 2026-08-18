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
}

export type Room = {
  id: string
  name: string
  signature: string
}

export type FloorLevel = {
  id: string
  name: string
  elevation: number
  rooms: Room[]
  roomHeight: number
  slabThickness: number
  walls: Wall[]
}
