import type { ApiErrorBody } from '../../shared/types'

const JsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
}

export class HttpError extends Error {
  constructor (
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export function json<T> (data: T, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: { ...JsonHeaders, ...init.headers }
  })
}

export function errorResponse (error: unknown): Response {
  if (error instanceof HttpError) {
    return json<ApiErrorBody>({ error: error.message, code: error.code }, { status: error.status })
  }
  console.error(JSON.stringify({
    message: 'request failed',
    error: error instanceof Error ? error.message : String(error)
  }))
  return json<ApiErrorBody>({ error: '服务暂时不可用，请稍后重试', code: 'INTERNAL_ERROR' }, { status: 500 })
}

export async function readJson<T> (request: Request): Promise<T> {
  try {
    return await request.json() as T
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求内容不是有效的 JSON')
  }
}
