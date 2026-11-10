export type CameraCommand = { id: number; angle: number; sentAt: number }
export type IsolationCommand =
  | { type: 'init'; generation: number; revision: number; canvas?: OffscreenCanvas; width: number; height: number }
  | { type: 'prepare' | 'cancel' | 'replace' | 'shutdown' | 'snapshot'; generation: number; revision: number; sentAt: number }
  | { type: 'camera'; generation: number; revision: number; command: CameraCommand }
export type IsolationEvent = { type: string; generation: number; revision: number; at: number; [key: string]: unknown }
export const isolationNow = () => performance.timeOrigin + performance.now()

/** Main retains one in-flight camera message and one newest intent, not a
 * growing queue behind a blocked worker. IDs remain monotonically increasing. */
export function createCameraMailbox(send: (command: CameraCommand) => void) {
  let next = 0, inFlight: number | undefined, latest: CameraCommand | undefined
  const flush = () => { if (inFlight !== undefined || !latest) return; const command = latest; latest = undefined; inFlight = command.id; send(command) }
  return {
    update(angle: number) { const command = { id: ++next, angle, sentAt: isolationNow() }; latest = command; flush(); return command },
    ack(id: number) { if (id !== inFlight) return; inFlight = undefined; flush() },
    clear() { inFlight = undefined; latest = undefined },
    state: () => ({ inFlight, pending: latest?.id, sent: next }),
  }
}
