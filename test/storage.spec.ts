import { describe, expect, it } from 'vitest'
import { parseConnectionInput } from '../src/worker/connections'
import { normalizeObjectKey, normalizePrefix, publicObjectUrl } from '../src/worker/utils/keys'

describe('connection validation', () => {
  it('normalizes a complete S3 connection', () => {
    const result = parseConnectionInput({
      name: 'R2 production',
      provider: 'r2',
      endpoint: 'https://account.r2.cloudflarestorage.com/',
      region: 'auto',
      bucket: 'assets',
      publicBaseUrl: 'https://files.example.com/',
      forcePathStyle: true,
      accessKeyId: 'access',
      secretAccessKey: 'secret'
    }, true)
    expect(result.endpoint).toBe('https://account.r2.cloudflarestorage.com')
    expect(result.publicBaseUrl).toBe('https://files.example.com')
    expect(result.accessKeyId).toBe('access')
    expect(result.secretAccessKey).toBe('secret')
  })

  it('rejects insecure external endpoints', () => {
    expect(() => parseConnectionInput({
      name: 'Unsafe', provider: 's3', endpoint: 'http://example.com', region: 'us-east-1',
      bucket: 'files', publicBaseUrl: '', forcePathStyle: true,
      accessKeyId: 'access', secretAccessKey: 'secret'
    }, true)).toThrow('必须使用 HTTPS')
  })

  it('accepts an arbitrary S3-compatible provider', () => {
    const result = parseConnectionInput({
      name: 'Compatible storage',
      provider: 's3',
      endpoint: 'https://objects.storage.example.com/',
      region: 'ap-southeast-1',
      bucket: 'media',
      publicBaseUrl: 'https://cdn.example.com/',
      forcePathStyle: false,
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      sessionToken: 'temporary-token'
    }, true)

    expect(result).toMatchObject({
      provider: 's3',
      endpoint: 'https://objects.storage.example.com',
      region: 'ap-southeast-1',
      bucket: 'media',
      publicBaseUrl: 'https://cdn.example.com',
      forcePathStyle: false,
      sessionToken: 'temporary-token'
    })
  })

  it('requires credentials when saving a connection', () => {
    expect(() => parseConnectionInput({
      name: 'R2', provider: 'r2', endpoint: 'https://account.r2.cloudflarestorage.com', region: 'auto',
      bucket: 'files', publicBaseUrl: '', forcePathStyle: true
    }, true)).toThrow('Access Key ID 和 Secret Access Key 不能为空')
  })
})

describe('storage key utilities', () => {
  it('normalizes safe keys and prefixes', () => {
    expect(normalizeObjectKey('/assets\\logo.png')).toBe('assets/logo.png')
    expect(normalizePrefix('/assets/images/')).toBe('assets/images/')
  })

  it('rejects path traversal', () => {
    expect(() => normalizeObjectKey('../secret')).toThrow('文件路径无效')
  })

  it('encodes public URLs by path segment', () => {
    expect(publicObjectUrl('https://cdn.example.com/', '中文/a b.png'))
      .toBe('https://cdn.example.com/%E4%B8%AD%E6%96%87/a%20b.png')
  })
})
