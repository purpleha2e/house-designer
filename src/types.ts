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

export type FloorLevel = {
  id: string
  name: string
  elevation: number
  roomHeight: number
  slabThickness: number
  walls: Wall[]
}
