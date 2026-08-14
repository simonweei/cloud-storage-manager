export const S3Providers = ['r2', 'qiniu', 'upyun', 's3'] as const

export type S3Provider = (typeof S3Providers)[number]

export interface S3ConnectionInfo {
  id: string
  name: string
  provider: S3Provider
  endpoint: string
  region: string
  bucket: string
  publicBaseUrl: string
  forcePathStyle: boolean
  hasCredentials: boolean
  createdAt: string
  updatedAt: string
}

export interface S3ConnectionInput {
  name: string
  provider: S3Provider
  endpoint: string
  region: string
  bucket: string
  publicBaseUrl: string
  forcePathStyle: boolean
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
}

export interface StorageObject {
  connectionId: string
  key: string
  name: string
  size: number
  contentType: string
  lastModified: string | null
  etag: string | null
  url: string
  isDirectory: boolean
}

export interface ListObjectsResult {
  objects: StorageObject[]
  cursor: string | null
  hasMore: boolean
}

export interface UploadInitInput {
  connectionId: string
  key: string
  size: number
  contentType: string
}

export interface UploadSession {
  connectionId: string
  key: string
  directUrl: string
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
}

export interface ApiErrorBody {
  error: string
  code: string
}
