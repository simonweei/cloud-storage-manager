import type { UploadInitInput } from '../shared/types'
import { isAuthenticated, login, logout, requireAuthentication } from './auth'
import {
  createConnection,
  deleteConnection,
  getConnection,
  listConnections,
  parseConnectionInput,
  updateConnection
} from './connections'
import type { AppEnv } from './env'
import { S3CompatibleDriver } from './storage/s3'
import { errorResponse, HttpError, json, readJson } from './utils/http'
import { normalizeObjectKey, normalizePrefix } from './utils/keys'

interface DeleteInput {
  connectionId: string
  keys: string[]
}

function connectionIdFromPath (pathname: string): string | null {
  const match = /^\/api\/connections\/([0-9a-f-]+)$/iu.exec(pathname)
  return match?.[1] ?? null
}

function requireConnectionId (value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/iu.test(value)) {
    throw new HttpError(400, 'INVALID_CONNECTION_ID', '连接 ID 无效')
  }
  return value
}

async function handleList (url: URL, env: AppEnv): Promise<Response> {
  const connectionId = requireConnectionId(url.searchParams.get('connection'))
  const prefix = normalizePrefix(url.searchParams.get('prefix'))
  const cursor = url.searchParams.get('cursor')
  const rawLimit = Number(url.searchParams.get('limit') ?? 100)
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100
  const driver = new S3CompatibleDriver(await getConnection(env, connectionId))
  return json(await driver.list({ prefix, cursor, limit }))
}

async function handleDelete (request: Request, env: AppEnv): Promise<Response> {
  const input = await readJson<DeleteInput>(request)
  const connectionId = requireConnectionId(input.connectionId)
  if (!Array.isArray(input.keys) || input.keys.length === 0 || input.keys.length > 20) {
    throw new HttpError(400, 'INVALID_KEYS', '每次必须删除 1 到 20 个文件')
  }
  const keys = Array.from(new Set(input.keys.map(normalizeObjectKey)))
  const driver = new S3CompatibleDriver(await getConnection(env, connectionId))
  await driver.delete(keys)
  return json({ deleted: keys })
}

async function handleUploadInit (request: Request, env: AppEnv): Promise<Response> {
  const input = await readJson<UploadInitInput>(request)
  const connectionId = requireConnectionId(input.connectionId)
  const key = normalizeObjectKey(input.key)
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > 5 * 1024 * 1024 * 1024) {
    throw new HttpError(400, 'INVALID_SIZE', '文件大小无效或超过 5 GB')
  }
  const contentType = typeof input.contentType === 'string' && input.contentType.length <= 200
    ? input.contentType
    : 'application/octet-stream'
  const driver = new S3CompatibleDriver(await getConnection(env, connectionId))
  return json(await driver.createUpload({ connectionId, key, size: input.size, contentType }))
}

async function route (request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/api/health') return json({ ok: true })
  if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    return json({ authenticated: await isAuthenticated(request, env) })
  }
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, env)
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(request)
  await requireAuthentication(request, env)

  if (url.pathname === '/api/connections') {
    if (request.method === 'GET') return json({ connections: await listConnections(env) })
    if (request.method === 'POST') {
      const input = parseConnectionInput(await readJson<unknown>(request), true)
      return json(await createConnection(env, input), { status: 201 })
    }
  }

  const connectionId = connectionIdFromPath(url.pathname)
  if (connectionId) {
    if (request.method === 'PUT') {
      const input = parseConnectionInput(await readJson<unknown>(request), true)
      return json(await updateConnection(env, connectionId, input))
    }
    if (request.method === 'DELETE') {
      await deleteConnection(env, connectionId)
      return json({ deleted: connectionId })
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/objects') return handleList(url, env)
  if (request.method === 'DELETE' && url.pathname === '/api/objects') return handleDelete(request, env)
  if (request.method === 'POST' && url.pathname === '/api/uploads/init') return handleUploadInit(request, env)

  throw new HttpError(404, 'NOT_FOUND', '接口不存在')
}

export default {
  async fetch (request: Request, env: AppEnv): Promise<Response> {
    try {
      const response = await route(request, env)
      const headers = new Headers(response.headers)
      headers.set('x-content-type-options', 'nosniff')
      headers.set('referrer-policy', 'same-origin')
      headers.set('content-security-policy', "default-src 'self'; img-src 'self' https: data: http://localhost:* http://127.0.0.1:*; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https: http://localhost:* http://127.0.0.1:*")
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    } catch (error) {
      return errorResponse(error)
    }
  }
} satisfies ExportedHandler<AppEnv>
