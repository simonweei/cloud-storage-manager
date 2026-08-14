import type {
  ApiErrorBody,
  ListObjectsResult,
  S3ConnectionInfo,
  S3ConnectionInput,
  UploadInitInput,
  UploadSession
} from '../shared/types'

async function apiFetch<T> (
  path: string,
  init: RequestInit = {},
  notifyUnauthorized = true
): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  if (!response.ok) {
    if (response.status === 401 && notifyUnauthorized) {
      window.dispatchEvent(new Event('cloud-shelf-unauthorized'))
    }
    let body: ApiErrorBody | null = null
    try {
      body = await response.json() as ApiErrorBody
    } catch {
      // Gateways may return non-JSON errors.
    }
    throw new Error(body?.error ?? `请求失败（${response.status}）`)
  }
  return await response.json() as T
}

export const api = {
  async session (): Promise<boolean> {
    const result = await apiFetch<{ authenticated: boolean }>('/api/auth/session', {}, false)
    return result.authenticated
  },
  async login (password: string): Promise<void> {
    await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    }, false)
  },
  async logout (): Promise<void> {
    await apiFetch('/api/auth/logout', { method: 'POST' }, false)
  },
  async connections (): Promise<S3ConnectionInfo[]> {
    const result = await apiFetch<{ connections: S3ConnectionInfo[] }>('/api/connections')
    return result.connections
  },
  createConnection (input: S3ConnectionInput): Promise<S3ConnectionInfo> {
    return apiFetch('/api/connections', { method: 'POST', body: JSON.stringify(input) })
  },
  updateConnection (id: string, input: S3ConnectionInput): Promise<S3ConnectionInfo> {
    return apiFetch(`/api/connections/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) })
  },
  deleteConnection (id: string): Promise<{ deleted: string }> {
    return apiFetch(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  list (connectionId: string, prefix: string, cursor?: string): Promise<ListObjectsResult> {
    const query = new URLSearchParams({ connection: connectionId, prefix, limit: '100' })
    if (cursor) query.set('cursor', cursor)
    return apiFetch(`/api/objects?${query.toString()}`)
  },
  createUpload (input: UploadInitInput): Promise<UploadSession> {
    return apiFetch('/api/uploads/init', { method: 'POST', body: JSON.stringify(input) })
  },
  delete (connectionId: string, keys: string[]): Promise<{ deleted: string[] }> {
    return apiFetch('/api/objects', {
      method: 'DELETE',
      body: JSON.stringify({ connectionId, keys })
    })
  }
}
