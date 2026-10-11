import { createRoomLightMask, type RoomLightMaskBounds, type RoomLightMaskRoom } from './roomLightMask.ts'
self.onmessage = (event: MessageEvent<{ rooms: RoomLightMaskRoom[]; bounds: RoomLightMaskBounds }>) => {
  const mask = createRoomLightMask(event.data.rooms, event.data.bounds)
  self.postMessage(mask, { transfer: [mask.data.buffer] })
}
