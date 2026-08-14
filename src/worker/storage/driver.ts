import type { ListObjectsResult, UploadInitInput, UploadSession } from '../../shared/types'

export interface ListOptions {
  prefix: string
  cursor: string | null
  limit: number
}

export interface StorageDriver {
  list(options: ListOptions): Promise<ListObjectsResult>
  delete(keys: string[]): Promise<void>
  createUpload(input: UploadInitInput): Promise<UploadSession>
}
