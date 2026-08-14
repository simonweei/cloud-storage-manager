import { describe, expect, it } from 'vitest'
import { parseConnectionInput } from '../src/worker/connections'
import { decryptJson, encryptJson } from '../src/worker/utils/encryption'
import { normalizeObjectKey, normalizePrefix, publicObjectUrl } from '../src/worker/utils/keys'

const TestKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

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
  })

  it('rejects insecure external endpoints', () => {
    expect(() => parseConnectionInput({
      name: 'Unsafe', provider: 's3', endpoint: 'http://example.com', region: 'us-east-1',
      bucket: 'files', publicBaseUrl: '', forcePathStyle: true,
      accessKeyId: 'access', secretAccessKey: 'secret'
    }, true)).toThrow('必须使用 HTTPS')
  })
})

describe('credential encryption', () => {
  it('round-trips credentials and binds them to the connection id', async () => {
    const encrypted = await encryptJson({ accessKeyId: 'ak', secretAccessKey: 'sk' }, TestKey, 'connection-a')
    expect(encrypted).not.toContain('"secretAccessKey":"sk"')
    await expect(decryptJson(encrypted, TestKey, 'connection-a')).resolves.toEqual({ accessKeyId: 'ak', secretAccessKey: 'sk' })
    await expect(decryptJson(encrypted, TestKey, 'connection-b')).rejects.toThrow('无法解密')
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
