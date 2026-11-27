export type PortalSession = {
  manufacturer: { id: string; name: string; slug: string } | null
  token: string
  user: { email: string; id: string; name: string; role: 'admin' | 'manufacturer' }
}

export const portalTokenStorageKey = 'houseDesignerAssetPortalToken'
const portalTokenChanged = 'house-designer:portal-token-changed'

export function readPortalToken() {
  return localStorage.getItem(portalTokenStorageKey)
}

export function setPortalToken(token: string | null) {
  if (token) localStorage.setItem(portalTokenStorageKey, token)
  else localStorage.removeItem(portalTokenStorageKey)
  window.dispatchEvent(new Event(portalTokenChanged))
}

export function subscribePortalToken(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === portalTokenStorageKey || event.key === null) listener()
  }
  window.addEventListener(portalTokenChanged, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(portalTokenChanged, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export async function portalRequest<T>(path: string, { body, method = 'GET', token }: {
  body?: BodyInit; method?: string; token?: string | null
} = {}) {
  const headers = new Headers()
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (body && !(body instanceof FormData)) headers.set('content-type', 'application/json')
  const response = await fetch(path, { body, headers, method })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 404 && (path === '/api/portal/material-catalogue' || path === '/api/portal/materials/publish' ||
      (method === 'PATCH' && path.startsWith('/api/portal/materials/') && (data.error === 'Not found' || !data.error)))) {
      throw new Error('Public Materials needs the current asset portal. Restart the asset portal and sign in again through Assets.')
    }
    throw new Error(data.error ?? 'Asset portal request failed')
  }
  return data as T
}
