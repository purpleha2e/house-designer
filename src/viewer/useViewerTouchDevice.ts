import { useSyncExternalStore } from 'react'

const query = '(pointer: coarse)'
const getSnapshot = () => window.matchMedia(query).matches
const getServerSnapshot = () => false
function subscribe(onChange: () => void) {
  const media = window.matchMedia(query)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** Use the primary input, so a desktop with an optional touchscreen keeps its quality. */
export function useViewerTouchDevice() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
