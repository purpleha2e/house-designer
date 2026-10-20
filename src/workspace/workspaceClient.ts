export type Workspace = { id: string; quotaBytes: number; usedBytes: number }
export type WorkspaceSession = {
  user: { id: string; email: string; name: string } | null
  workspace: Workspace | null
  mode: 'local-development'
  maxUploadBytes: number
}
export type WorkspaceAsset = {
  id: string; name: string; kind: 'material' | 'object' | 'project'; bytes: number
  contentType: string; createdAt: number; visibility: 'private'; sha256: string
}
const endpoint = '/api/workspace'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${endpoint}${path}`, { ...options, credentials: 'same-origin',
      headers: { 'X-House-Designer-Client': 'editor', ...options.headers } })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw Error('The account service is unavailable. You can keep working locally.', { cause: error })
  }
  const value = await response.json().catch(() => null)
  if (!response.ok || !value) throw Error(value?.error ?? 'The account service is unavailable. You can keep working locally.')
  return value as T
}

export const workspaceClient = {
  session: (signal?: AbortSignal) => request<WorkspaceSession>('/session', { signal }),
  authenticate: (action: 'register' | 'login', credentials: { email: string; password: string; name?: string }, signal?: AbortSignal) =>
    request<WorkspaceSession>(`/auth/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials), signal }),
  logout: (signal?: AbortSignal) => request<{ ok: boolean }>('/auth/logout', { method: 'POST', signal }),
  list: (signal?: AbortSignal) => request<{ assets: WorkspaceAsset[]; workspace: Workspace }>('/assets', { signal }),
  upload: (file: File, kind: WorkspaceAsset['kind'], signal?: AbortSignal) => request<{ asset: WorkspaceAsset; workspace: Workspace }>(
    `/assets?${new URLSearchParams({ name: file.name, kind })}`, { method: 'POST', body: file, signal }),
  remove: (id: string, signal?: AbortSignal) => request<{ ok: boolean; workspace: Workspace }>(`/assets/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
  downloadUrl: (id: string) => `${endpoint}/assets/${encodeURIComponent(id)}`,
}

export function formatWorkspaceBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
