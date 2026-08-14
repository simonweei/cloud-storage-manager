import type { UploadSession } from '../shared/types'

export function uploadFile (
  session: UploadSession,
  file: File,
  onProgress: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(session.method, session.uploadUrl)
    for (const [key, value] of Object.entries(session.headers)) xhr.setRequestHeader(key, value)
    xhr.upload.addEventListener('progress', event => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100)
        resolve()
      } else {
        reject(new Error(`上传失败（${xhr.status}）：${xhr.responseText.slice(0, 300)}`))
      }
    })
    xhr.addEventListener('error', () => reject(new Error('网络错误或存储桶 CORS 未允许当前站点')))
    xhr.addEventListener('abort', () => reject(new Error('上传已取消')))
    xhr.send(file)
  })
}
