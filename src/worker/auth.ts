import type { AppEnv } from './env'
import { HttpError, json, readJson } from './utils/http'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const SessionCookie = 'cloud_shelf_session'
const SessionLifetimeSeconds = 12 * 60 * 60
const AttemptWindowMs = 15 * 60 * 1000
const MaxAttempts = 5

interface AttemptRow {
  failure_count: number
  window_started_at: number
  blocked_until: number
}

interface SessionPayload {
  v: 1
  exp: number
}

interface TimingSafeSubtleCrypto extends SubtleCrypto {
  timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean
}

function supportsTimingSafeEqual (subtle: SubtleCrypto): subtle is TimingSafeSubtleCrypto {
  return 'timingSafeEqual' in subtle
}

function secureEqual (left: Uint8Array<ArrayBufferLike>, right: Uint8Array<ArrayBufferLike>): boolean {
  if (left.byteLength !== right.byteLength) return false
  if (supportsTimingSafeEqual(crypto.subtle)) return crypto.subtle.timingSafeEqual(left, right)
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function bytesToBase64Url (bytes: Uint8Array<ArrayBufferLike>): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function base64UrlToBytes (value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function sha256 (value: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

async function hmac (value: string, secret: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

async function verifyPassword (provided: string, expected: string): Promise<boolean> {
  const [providedHash, expectedHash] = await Promise.all([sha256(provided), sha256(expected)])
  return secureEqual(providedHash, expectedHash)
}

function cookieValue (request: Request): string {
  const cookie = request.headers.get('cookie') ?? ''
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === SessionCookie) return value.join('=')
  }
  return ''
}

async function createSessionToken (env: AppEnv): Promise<string> {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    v: 1,
    exp: Math.floor(Date.now() / 1000) + SessionLifetimeSeconds
  } satisfies SessionPayload)))
  return `${payload}.${bytesToBase64Url(await hmac(payload, env.SESSION_SECRET))}`
}

async function verifySessionToken (token: string, env: AppEnv): Promise<boolean> {
  try {
    const [payload, signature, extra] = token.split('.')
    if (!payload || !signature || extra) return false
    if (!secureEqual(base64UrlToBytes(signature), await hmac(payload, env.SESSION_SECRET))) return false
    const parsed = JSON.parse(decoder.decode(base64UrlToBytes(payload))) as SessionPayload
    return parsed.v === 1 && Number.isSafeInteger(parsed.exp) && parsed.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

function setCookieHeader (request: Request, token: string): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SessionLifetimeSeconds}${secure}`
}

function clearCookieHeader (request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`
}

async function clientKey (request: Request, env: AppEnv): Promise<string> {
  const address = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  return bytesToBase64Url(await sha256(`${address}:${env.SESSION_SECRET}`))
}

async function getAttempt (env: AppEnv, key: string): Promise<AttemptRow | null> {
  return env.DB.prepare('SELECT failure_count, window_started_at, blocked_until FROM auth_attempts WHERE client_key = ?')
    .bind(key).first<AttemptRow>()
}

async function recordFailure (env: AppEnv, key: string, previous: AttemptRow | null): Promise<void> {
  const now = Date.now()
  const insideWindow = previous && now - previous.window_started_at < AttemptWindowMs
  const count = insideWindow ? previous.failure_count + 1 : 1
  const windowStartedAt = insideWindow ? previous.window_started_at : now
  const blockedUntil = count >= MaxAttempts ? now + AttemptWindowMs : 0
  await env.DB.prepare(`
    INSERT INTO auth_attempts (client_key, failure_count, window_started_at, blocked_until)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(client_key) DO UPDATE SET
      failure_count = excluded.failure_count,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until
  `).bind(key, count, windowStartedAt, blockedUntil).run()
}

export async function isAuthenticated (request: Request, env: AppEnv): Promise<boolean> {
  const token = cookieValue(request)
  return token ? verifySessionToken(token, env) : false
}

export async function requireAuthentication (request: Request, env: AppEnv): Promise<void> {
  if (!await isAuthenticated(request, env)) throw new HttpError(401, 'UNAUTHORIZED', '请先登录')
}

export async function login (request: Request, env: AppEnv): Promise<Response> {
  const input = await readJson<{ password?: unknown }>(request)
  if (typeof input.password !== 'string' || !input.password || input.password.length > 1024) {
    throw new HttpError(400, 'INVALID_PASSWORD', '请输入密码')
  }
  const key = await clientKey(request, env)
  const attempt = await getAttempt(env, key)
  if (attempt && attempt.blocked_until > Date.now()) {
    throw new HttpError(429, 'LOGIN_RATE_LIMITED', '登录失败次数过多，请 15 分钟后再试')
  }
  if (!await verifyPassword(input.password, env.APP_PASSWORD)) {
    await recordFailure(env, key, attempt)
    throw new HttpError(401, 'LOGIN_FAILED', '密码错误')
  }
  await env.DB.prepare('DELETE FROM auth_attempts WHERE client_key = ?').bind(key).run()
  return json({ authenticated: true }, {
    headers: { 'set-cookie': setCookieHeader(request, await createSessionToken(env)) }
  })
}

export function logout (request: Request): Response {
  return json({ authenticated: false }, { headers: { 'set-cookie': clearCookieHeader(request) } })
}
