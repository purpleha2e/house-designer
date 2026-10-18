import { createRoomLightMaskStack, type RoomLightMaskBounds, type RoomLightMaskFloor } from './roomLightMask.ts'
self.onmessage = (event: MessageEvent<{ floors: RoomLightMaskFloor[]; bounds: RoomLightMaskBounds }>) => {
  const mask = createRoomLightMaskStack(event.data.floors, event.data.bounds)
  self.postMessage(mask, { transfer: [mask.data.buffer] })
}
