import { S3Providers, type S3ConnectionInfo, type S3ConnectionInput, type S3Provider } from '../shared/types'
import type { AppEnv } from './env'
import { decryptJson, encryptJson } from './utils/encryption'
import { HttpError } from './utils/http'

interface ConnectionRow {
  id: string
  name: string
  provider: string
  endpoint: string
  region: string
  bucket: string
  public_base_url: string
  force_path_style: number
  encrypted_credentials: string
  created_at: string
  updated_at: string
}

export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export interface S3ConnectionConfig extends S3ConnectionInfo {
  credentials: S3Credentials
}

function asRecord (value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_CONNECTION', '连接配置格式无效')
  }
  return value as Record<string, unknown>
}

function requiredText (record: Record<string, unknown>, key: string, label: string, maxLength: number): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new HttpError(400, 'INVALID_CONNECTION', `${label}不能为空或长度不符合要求`)
  }
  return value.trim()
}

function optionalText (record: Record<string, unknown>, key: string, maxLength: number): string {
  const value = record[key]
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw new HttpError(400, 'INVALID_CONNECTION', `${key} 格式无效`)
  }
  return value.trim()
}

function normalizedUrl (value: string, label: string, allowEmpty = false): string {
  if (!value && allowEmpty) return ''
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new HttpError(400, 'INVALID_CONNECTION', `${label}不是有效 URL`)
  }
  const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new HttpError(400, 'INVALID_CONNECTION', `${label}必须使用 HTTPS；本地地址可使用 HTTP`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new HttpError(400, 'INVALID_CONNECTION', `${label}不能包含用户名、密码、查询参数或片段`)
  }
  return url.toString().replace(/\/+$/, '')
}

export function parseConnectionInput (value: unknown, credentialsRequired: boolean): S3ConnectionInput {
  const record = asRecord(value)
  const providerValue = record.provider
  if (typeof providerValue !== 'string' || !S3Providers.includes(providerValue as S3Provider)) {
    throw new HttpError(400, 'INVALID_CONNECTION', '不支持该存储平台')
  }
  const region = requiredText(record, 'region', 'Region', 100)
  if (!/^[a-z0-9][a-z0-9-]*$/iu.test(region)) {
    throw new HttpError(400, 'INVALID_CONNECTION', 'Region 格式无效')
  }
  const accessKeyId = optionalText(record, 'accessKeyId', 512)
  const secretAccessKey = optionalText(record, 'secretAccessKey', 1024)
  const sessionToken = optionalText(record, 'sessionToken', 4096)
  if (credentialsRequired && (!accessKeyId || !secretAccessKey)) {
    throw new HttpError(400, 'CREDENTIALS_REQUIRED', 'Access Key ID 和 Secret Access Key 不能为空')
  }
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new HttpError(400, 'CREDENTIALS_INCOMPLETE', 'Access Key ID 和 Secret Access Key 必须同时填写')
  }
  if (sessionToken && !accessKeyId) {
    throw new HttpError(400, 'CREDENTIALS_INCOMPLETE', '更新 Session Token 时必须同时填写 Access Key ID 和 Secret Access Key')
  }

  return {
    name: requiredText(record, 'name', '连接名称', 100),
    provider: providerValue as S3Provider,
    endpoint: normalizedUrl(requiredText(record, 'endpoint', 'Endpoint', 500), 'Endpoint'),
    region,
    bucket: requiredText(record, 'bucket', 'Bucket', 255),
    publicBaseUrl: normalizedUrl(optionalText(record, 'publicBaseUrl', 500), '公开访问域名', true),
    forcePathStyle: record.forcePathStyle === true,
    ...(accessKeyId ? { accessKeyId, secretAccessKey } : {}),
    ...(sessionToken ? { sessionToken } : {})
  }
}

function toInfo (row: ConnectionRow): S3ConnectionInfo {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as S3Provider,
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    publicBaseUrl: row.public_base_url,
    forcePathStyle: Boolean(row.force_path_style),
    hasCredentials: Boolean(row.encrypted_credentials),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

async function findRow (env: AppEnv, id: string): Promise<ConnectionRow> {
  const row = await env.DB.prepare('SELECT * FROM connections WHERE id = ?').bind(id).first<ConnectionRow>()
  if (!row) throw new HttpError(404, 'CONNECTION_NOT_FOUND', '连接不存在')
  return row
}

export async function listConnections (env: AppEnv): Promise<S3ConnectionInfo[]> {
  const result = await env.DB.prepare('SELECT * FROM connections ORDER BY updated_at DESC').all<ConnectionRow>()
  return result.results.map(toInfo)
}

export async function getConnection (env: AppEnv, id: string): Promise<S3ConnectionConfig> {
  const row = await findRow(env, id)
  const credentials = await decryptJson<S3Credentials>(row.encrypted_credentials, env.CONFIG_ENCRYPTION_KEY, row.id)
  return { ...toInfo(row), credentials }
}

export async function createConnection (env: AppEnv, input: S3ConnectionInput): Promise<S3ConnectionInfo> {
  if (!input.accessKeyId || !input.secretAccessKey) throw new HttpError(400, 'CREDENTIALS_REQUIRED', '连接凭证不能为空')
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const encrypted = await encryptJson({
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    ...(input.sessionToken ? { sessionToken: input.sessionToken } : {})
  }, env.CONFIG_ENCRYPTION_KEY, id)

  await env.DB.prepare(`
    INSERT INTO connections (
      id, name, provider, endpoint, region, bucket, public_base_url,
      force_path_style, encrypted_credentials, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, input.name, input.provider, input.endpoint, input.region, input.bucket,
    input.publicBaseUrl, input.forcePathStyle ? 1 : 0, encrypted, now, now
  ).run()

  return toInfo(await findRow(env, id))
}

export async function updateConnection (env: AppEnv, id: string, input: S3ConnectionInput): Promise<S3ConnectionInfo> {
  const existing = await findRow(env, id)
  let encrypted = existing.encrypted_credentials
  if (input.accessKeyId && input.secretAccessKey) {
    encrypted = await encryptJson({
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      ...(input.sessionToken ? { sessionToken: input.sessionToken } : {})
    }, env.CONFIG_ENCRYPTION_KEY, id)
  }

  await env.DB.prepare(`
    UPDATE connections SET
      name = ?, provider = ?, endpoint = ?, region = ?, bucket = ?,
      public_base_url = ?, force_path_style = ?, encrypted_credentials = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    input.name, input.provider, input.endpoint, input.region, input.bucket,
    input.publicBaseUrl, input.forcePathStyle ? 1 : 0, encrypted, new Date().toISOString(), id
  ).run()
  return toInfo(await findRow(env, id))
}

export async function deleteConnection (env: AppEnv, id: string): Promise<void> {
  const result = await env.DB.prepare('DELETE FROM connections WHERE id = ?').bind(id).run()
  if (!result.meta.changes) throw new HttpError(404, 'CONNECTION_NOT_FOUND', '连接不存在')
}
