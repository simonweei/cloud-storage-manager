import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ListObjectsResult, StorageObject, UploadInitInput, UploadSession } from '../../shared/types'
import type { S3ConnectionConfig } from '../connections'
import { HttpError } from '../utils/http'
import { objectName, publicObjectUrl } from '../utils/keys'
import type { ListOptions, StorageDriver } from './driver'

function contentTypeFromKey (key: string): string {
  const extension = key.split('.').at(-1)?.toLowerCase()
  const types: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
    json: 'application/json', pdf: 'application/pdf', txt: 'text/plain',
    html: 'text/html', css: 'text/css', js: 'text/javascript'
  }
  return extension ? types[extension] ?? 'application/octet-stream' : 'application/octet-stream'
}

function s3Error (error: unknown): HttpError {
  if (error instanceof S3ServiceException) {
    const status = error.$metadata.httpStatusCode ?? 502
    return new HttpError(
      status >= 400 && status < 500 ? 400 : 502,
      `S3_${error.name.toUpperCase()}`,
      `S3 请求失败：${error.name}${error.message ? `（${error.message}）` : ''}`
    )
  }
  return new HttpError(502, 'S3_REQUEST_FAILED', error instanceof Error ? `S3 请求失败：${error.message}` : 'S3 请求失败')
}

export class S3CompatibleDriver implements StorageDriver {
  private readonly client: S3Client

  constructor (private readonly connection: S3ConnectionConfig) {
    this.client = new S3Client({
      endpoint: connection.endpoint,
      region: connection.region,
      forcePathStyle: connection.forcePathStyle,
      credentials: connection.credentials,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED'
    })
  }

  async list ({ prefix, cursor, limit }: ListOptions): Promise<ListObjectsResult> {
    try {
      const result = await this.client.send(new ListObjectsV2Command({
        Bucket: this.connection.bucket,
        Prefix: prefix || undefined,
        Delimiter: '/',
        ContinuationToken: cursor ?? undefined,
        MaxKeys: limit
      }))
      const files: StorageObject[] = (result.Contents ?? []).filter(item => item.Key && item.Key !== prefix).map(item => ({
        connectionId: this.connection.id,
        key: item.Key ?? '',
        name: objectName(item.Key ?? ''),
        size: item.Size ?? 0,
        contentType: contentTypeFromKey(item.Key ?? ''),
        lastModified: item.LastModified?.toISOString() ?? null,
        etag: item.ETag?.replace(/^"|"$/g, '') ?? null,
        url: publicObjectUrl(this.connection.publicBaseUrl, item.Key ?? ''),
        isDirectory: false
      }))
      const directories: StorageObject[] = (result.CommonPrefixes ?? []).filter(item => item.Prefix).map(item => ({
        connectionId: this.connection.id,
        key: item.Prefix ?? '',
        name: objectName(item.Prefix ?? ''),
        size: 0,
        contentType: 'application/x-directory',
        lastModified: null,
        etag: null,
        url: '',
        isDirectory: true
      }))
      return {
        objects: [...directories, ...files],
        cursor: result.IsTruncated ? result.NextContinuationToken ?? null : null,
        hasMore: Boolean(result.IsTruncated && result.NextContinuationToken)
      }
    } catch (error) {
      throw s3Error(error)
    }
  }

  async delete (keys: string[]): Promise<void> {
    try {
      await Promise.all(keys.map(key => this.client.send(new DeleteObjectCommand({
        Bucket: this.connection.bucket,
        Key: key
      }))))
    } catch (error) {
      throw s3Error(error)
    }
  }

  async createUpload (input: UploadInitInput): Promise<UploadSession> {
    try {
      const uploadUrl = await getSignedUrl(this.client, new PutObjectCommand({
        Bucket: this.connection.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.size
      }), { expiresIn: 10 * 60 })
      return {
        connectionId: this.connection.id,
        key: input.key,
        directUrl: publicObjectUrl(this.connection.publicBaseUrl, input.key),
        uploadUrl,
        method: 'PUT',
        headers: { 'content-type': input.contentType }
      }
    } catch (error) {
      throw s3Error(error)
    }
  }
}
