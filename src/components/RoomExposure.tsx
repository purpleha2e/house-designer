import { useEffect, useMemo } from 'react'
import { RoomExposureEffect } from '../roomExposure'

export function RoomExposure() {
  const effect = useMemo(() => new RoomExposureEffect(), [])
  useEffect(() => () => effect.dispose(), [effect])
  return <primitive object={effect} />
}
