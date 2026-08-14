import { HttpError } from './http'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface EncryptedValue {
  v: 1
  iv: string
  data: string
}

function bytesToBase64 (bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes (value: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    throw new HttpError(503, 'ENCRYPTION_KEY_INVALID', 'CONFIG_ENCRYPTION_KEY 必须是 Base64 编码的 32 字节密钥')
  }
}

async function importEncryptionKey (encodedKey: string): Promise<CryptoKey> {
  const keyBytes = base64ToBytes(encodedKey.trim())
  if (keyBytes.byteLength !== 32) {
    throw new HttpError(503, 'ENCRYPTION_KEY_INVALID', 'CONFIG_ENCRYPTION_KEY 必须是 Base64 编码的 32 字节密钥')
  }
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptJson (value: object, encodedKey: string, context: string): Promise<string> {
  const key = await importEncryptionKey(encodedKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    key,
    encoder.encode(JSON.stringify(value))
  )

  return JSON.stringify({
    v: 1,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted))
  } satisfies EncryptedValue)
}

export async function decryptJson<T> (value: string, encodedKey: string, context: string): Promise<T> {
  try {
    const payload = JSON.parse(value) as EncryptedValue
    if (payload.v !== 1 || typeof payload.iv !== 'string' || typeof payload.data !== 'string') throw new Error('Invalid payload')
    const key = await importEncryptionKey(encodedKey)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(payload.iv), additionalData: encoder.encode(context) },
      key,
      base64ToBytes(payload.data)
    )
    return JSON.parse(decoder.decode(decrypted)) as T
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(500, 'CREDENTIALS_DECRYPT_FAILED', '已保存的连接凭证无法解密，请检查 CONFIG_ENCRYPTION_KEY 是否发生变化')
  }
}
