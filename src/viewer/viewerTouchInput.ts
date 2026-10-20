import { createContext } from 'react'

export function createViewerTouchInput() {
  const value = { x: 0, y: 0 }
  return {
    get: () => value,
    set: (x: number, y: number) => { value.x = x; value.y = y },
    clear: () => { value.x = 0; value.y = 0 },
  }
}
export const ViewerTouchContext = createContext<ReturnType<typeof createViewerTouchInput> | null>(null)
