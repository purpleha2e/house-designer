export type Point = {
  x: number
  y: number
}

export type Wall = {
  id: string
  start: Point
  end: Point
  thickness: number
  height: number
}
