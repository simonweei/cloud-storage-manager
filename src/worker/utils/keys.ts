import { HttpError } from './http'

export function normalizeObjectKey (input: string): string {
  const key = input.trim().replaceAll('\\', '/').replace(/^\/+/, '')
  const segments = key.split('/')
  if (!key || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new HttpError(400, 'INVALID_KEY', '文件路径无效')
  }
  if (key.length > 900 || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw new HttpError(400, 'INVALID_KEY', '文件路径过长或包含控制字符')
  }
  return key
}

export function normalizePrefix (input: string | null): string {
  if (!input) return ''
  const prefix = input.trim().replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!prefix) return ''
  const segments = prefix.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new HttpError(400, 'INVALID_PREFIX', '目录路径无效')
  }
  return `${prefix}/`
}

export function encodeObjectKey (key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

export function publicObjectUrl (baseUrl: string, key: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return base ? `${base}/${encodeObjectKey(key)}` : ''
}

export function objectName (key: string): string {
  const segments = key.replace(/\/$/, '').split('/')
  return segments.at(-1) ?? key
}
