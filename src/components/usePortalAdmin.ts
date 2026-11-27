import { useEffect, useState, useSyncExternalStore } from 'react'
import { portalRequest, readPortalToken, subscribePortalToken, type PortalSession } from '../assetPortalClient'

export function usePortalAdmin() {
  const token = useSyncExternalStore(subscribePortalToken, readPortalToken)
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let active = true
    void portalRequest<Omit<PortalSession, 'token'>>('/api/portal/session', { token }).then(session => {
      if (active) setVerifiedToken(session.user.role === 'admin' ? token : null)
    }).catch(() => { if (active) setVerifiedToken(null) })
    return () => { active = false }
  }, [token])

  return token === verifiedToken ? token : null
}
