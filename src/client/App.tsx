import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { S3ConnectionInfo, S3ConnectionInput, S3Provider, StorageObject } from '../shared/types'
import { api } from './api'
import { ArrowIcon, CloudIcon, CopyIcon, ExternalIcon, FileIcon, FolderIcon, GridIcon, ListIcon, RefreshIcon, TrashIcon, UploadIcon } from './icons'
import { uploadFile } from './upload'

interface UploadItem {
  id: string
  name: string
  progress: number
  state: 'uploading' | 'done' | 'error'
  error?: string
  url?: string
}

interface ConnectionForm extends S3ConnectionInput {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
}

const ProviderNames: Record<S3Provider, string> = {
  r2: 'Cloudflare R2',
  qiniu: '七牛云 Kodo',
  upyun: '又拍云',
  s3: 'S3 兼容存储'
}

const EmptyForm: ConnectionForm = {
  name: '',
  provider: 'r2',
  endpoint: '',
  region: 'auto',
  bucket: '',
  publicBaseUrl: '',
  forcePathStyle: true,
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: ''
}

function providerDefaults (provider: S3Provider): Pick<ConnectionForm, 'endpoint' | 'region' | 'forcePathStyle'> {
  if (provider === 'qiniu') return { endpoint: 'https://s3.cn-east-1.qiniucs.com', region: 'cn-east-1', forcePathStyle: true }
  if (provider === 'upyun') return { endpoint: 'https://s3.api.upyun.com', region: 'us-east-1', forcePathStyle: true }
  if (provider === 'r2') return { endpoint: '', region: 'auto', forcePathStyle: true }
  return { endpoint: '', region: 'us-east-1', forcePathStyle: true }
}

function formatBytes (bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

function cleanPrefix (value: string): string {
  const prefix = value.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  return prefix ? `${prefix}/` : ''
}

function fileKey (prefix: string, name: string): string {
  const safeName = name.replaceAll('\\', '-').replaceAll('/', '-').trim()
  return `${cleanPrefix(prefix)}${safeName}`
}

function isPreviewableImage (item: StorageObject): boolean {
  return item.contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif)$/iu.test(item.key)
}

type AuthState = 'checking' | 'authenticated' | 'unauthenticated'
type FileView = 'list' | 'grid'

function LoginScreen ({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!password || submitting) return
    try {
      setSubmitting(true)
      setError('')
      await api.login(password)
      setPassword('')
      onLogin()
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败，请稍后再试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand-mark"><CloudIcon /></div>
        <p className="auth-eyebrow">CLOUD SHELF</p>
        <h1>欢迎回来</h1>
        <p className="auth-description">输入访问密码后，才能查看和管理你的 S3 存储空间。</p>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="app-password">访问密码</label>
          <input
            id="app-password"
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder="请输入访问密码"
            autoComplete="current-password"
            autoFocus
            required
          />
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button type="submit" disabled={!password || submitting}>
            {submitting ? '正在验证…' : '进入管理系统'}
          </button>
        </form>
        <p className="auth-foot">会话凭证仅保存在安全 Cookie 中</p>
      </section>
    </main>
  )
}

export function App () {
  const [authState, setAuthState] = useState<AuthState>('checking')

  useEffect(() => {
    let active = true
    api.session()
      .then(authenticated => { if (active) setAuthState(authenticated ? 'authenticated' : 'unauthenticated') })
      .catch(() => { if (active) setAuthState('unauthenticated') })
    const handleUnauthorized = () => setAuthState('unauthenticated')
    window.addEventListener('cloud-shelf-unauthorized', handleUnauthorized)
    return () => {
      active = false
      window.removeEventListener('cloud-shelf-unauthorized', handleUnauthorized)
    }
  }, [])

  if (authState === 'checking') {
    return <main className="auth-page"><div className="auth-checking"><div className="spinner" /><span>正在验证会话…</span></div></main>
  }
  if (authState === 'unauthenticated') {
    return <LoginScreen onLogin={() => setAuthState('authenticated')} />
  }
  return <StorageManager onLogout={() => setAuthState('unauthenticated')} />
}

function StorageManager ({ onLogout }: { onLogout: () => void }) {
  const [connections, setConnections] = useState<S3ConnectionInfo[]>([])
  const [connectionId, setConnectionId] = useState('')
  const [prefix, setPrefix] = useState('')
  const [objects, setObjects] = useState<StorageObject[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorError, setEditorError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ConnectionForm>(EmptyForm)
  const [saving, setSaving] = useState(false)
  const [fileView, setFileView] = useState<FileView>('list')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeConnection = connections.find(item => item.id === connectionId)

  const loadConnections = useCallback(async () => {
    try {
      setError('')
      const result = await api.connections()
      setConnections(result)
      setConnectionId(current => result.some(item => item.id === current) ? current : result[0]?.id ?? '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取连接配置')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadObjects = useCallback(async (append = false) => {
    if (!connectionId) return
    try {
      setLoading(true)
      setError('')
      const result = await api.list(connectionId, prefix, append ? cursor ?? undefined : undefined)
      setObjects(current => append ? [...current, ...result.objects] : result.objects)
      setCursor(result.cursor)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '文件列表加载失败')
      if (!append) setObjects([])
    } finally {
      setLoading(false)
    }
  }, [connectionId, cursor, prefix])

  useEffect(() => {
    loadConnections().catch(console.error)
  }, [loadConnections])

  useEffect(() => {
    setObjects([])
    setCursor(null)
    if (connectionId) loadObjects().catch(console.error)
  }, [connectionId, prefix])

  const breadcrumbs = useMemo(() => {
    const segments = cleanPrefix(prefix).split('/').filter(Boolean)
    return segments.map((segment, index) => ({
      name: segment,
      prefix: `${segments.slice(0, index + 1).join('/')}/`
    }))
  }, [prefix])

  const openCreate = () => {
    setSuccessMessage('')
    setEditorError('')
    setEditingId(null)
    setForm({ ...EmptyForm })
    setEditorOpen(true)
  }

  const openEdit = (connection: S3ConnectionInfo) => {
    setSuccessMessage('')
    setEditorError('')
    setEditingId(connection.id)
    setForm({
      name: connection.name,
      provider: connection.provider,
      endpoint: connection.endpoint,
      region: connection.region,
      bucket: connection.bucket,
      publicBaseUrl: connection.publicBaseUrl,
      forcePathStyle: connection.forcePathStyle,
      accessKeyId: connection.accessKeyId,
      secretAccessKey: connection.secretAccessKey,
      sessionToken: connection.sessionToken
    })
    setEditorOpen(true)
  }

  const saveConnection = async () => {
    try {
      setSaving(true)
      setSuccessMessage('')
      setEditorError('')
      const saved = editingId
        ? await api.updateConnection(editingId, form)
        : await api.createConnection(form)
      await loadConnections()
      setConnectionId(saved.id)
      setEditorOpen(false)
      setSuccessMessage(editingId ? '连接修改成功' : '连接添加成功')
    } catch (saveError) {
      setEditorError(saveError instanceof Error ? saveError.message : '连接保存失败')
    } finally {
      setSaving(false)
    }
  }

  const removeConnection = async (connection: S3ConnectionInfo) => {
    if (!window.confirm(`确定删除连接“${connection.name}”吗？云端文件不会被删除。`)) return
    try {
      setEditorError('')
      await api.deleteConnection(connection.id)
      await loadConnections()
      setEditorOpen(false)
    } catch (deleteError) {
      setEditorError(deleteError instanceof Error ? deleteError.message : '连接删除失败')
    }
  }

  const updateUpload = (id: string, patch: Partial<UploadItem>) => {
    setUploadQueue(queue => queue.map(item => item.id === id ? { ...item, ...patch } : item))
  }

  const uploadFiles = async (files: File[]) => {
    if (!connectionId || files.length === 0) return
    const queue = files.map(file => ({ id: crypto.randomUUID(), name: file.name, progress: 0, state: 'uploading' as const }))
    setUploadQueue(current => [...queue, ...current].slice(0, 12))
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const item = queue[index]
      try {
        const session = await api.createUpload({
          connectionId,
          key: fileKey(prefix, file.name),
          size: file.size,
          contentType: file.type || 'application/octet-stream'
        })
        await uploadFile(session, file, progress => updateUpload(item.id, { progress }))
        updateUpload(item.id, { state: 'done', progress: 100, url: session.directUrl })
      } catch (uploadError) {
        updateUpload(item.id, { state: 'error', error: uploadError instanceof Error ? uploadError.message : '上传失败' })
      }
    }
    await loadObjects()
  }

  const copyUrl = async (url: string) => navigator.clipboard.writeText(url)

  const openObject = (item: StorageObject) => {
    if (item.isDirectory) {
      setPrefix(item.key)
    } else if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer')
    }
  }

  const deleteObject = async (item: StorageObject) => {
    if (item.isDirectory || !window.confirm(`确定删除 ${item.name} 吗？此操作无法撤销。`)) return
    try {
      await api.delete(connectionId, [item.key])
      setObjects(current => current.filter(object => object.key !== item.key))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除失败')
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><CloudIcon /></div>
          <div><strong>Cloud Shelf</strong><span>S3 对象存储管理器</span></div>
        </div>
        <div className="sidebar-heading"><p className="eyebrow">存储连接</p><button onClick={openCreate}>＋ 添加</button></div>
        <nav className="providers">
          {connections.map(item => (
            <div className={item.id === connectionId ? 'connection-row active' : 'connection-row'} key={item.id}>
              <button className="provider" onClick={() => { setConnectionId(item.id); setPrefix('') }}>
                <span className={`provider-dot ${item.provider}`} />
                <span><b>{item.name}</b><small>{item.bucket}</small></span>
              </button>
              <button className="connection-edit" title="编辑连接" onClick={() => openEdit(item)}>•••</button>
            </div>
          ))}
          {!connections.length && !loading && <button className="empty-connection" onClick={openCreate}>添加第一个 S3 连接</button>}
        </nav>
        <div className="sidebar-note"><span>密码保护</span>连接凭证以明文保存，仅登录管理页面后可查看和修改。</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><p className="eyebrow">S3 对象存储</p><h1>{activeConnection?.name ?? '连接你的存储空间'}</h1></div>
          <button className="logout-button" onClick={() => { api.logout().finally(onLogout).catch(console.error) }}>退出登录</button>
        </header>

        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}>关闭</button></div>}
        {successMessage && <div className="success-banner" role="status"><span>{successMessage}</span><button onClick={() => setSuccessMessage('')}>关闭</button></div>}

        {!activeConnection ? (
          <section className="welcome-panel">
            <div className="upload-icon"><CloudIcon /></div>
            <h2>添加一个 S3 连接</h2>
            <p>支持 Cloudflare R2、七牛云 Kodo、又拍云及其他 S3 兼容存储。</p>
            <button className="primary" onClick={openCreate}>配置连接</button>
          </section>
        ) : (
          <>
            <section className={dragging ? 'upload-zone dragging' : 'upload-zone'} onDragEnter={event => { event.preventDefault(); setDragging(true) }} onDragOver={event => event.preventDefault()} onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false) }} onDrop={event => { event.preventDefault(); setDragging(false); uploadFiles(Array.from(event.dataTransfer.files)).catch(console.error) }}>
              <div className="upload-icon"><UploadIcon /></div>
              <div className="upload-copy"><h2>把文件放到云端</h2><p>拖拽文件到这里，或从电脑选择文件；浏览器使用短期预签名地址直传。</p></div>
              <div className="upload-actions">
                <label><span>上传目录</span><input value={prefix} onChange={event => setPrefix(event.target.value)} placeholder="例如 assets/images/" /></label>
                <button className="primary" onClick={() => fileInputRef.current?.click()}>选择文件</button>
                <input ref={fileInputRef} type="file" multiple hidden onChange={event => { if (event.target.files) uploadFiles(Array.from(event.target.files)).catch(console.error); event.target.value = '' }} />
              </div>
            </section>

            {uploadQueue.length > 0 && (
              <section className="uploads-panel">
                <div className="section-title"><h2>最近上传</h2><button onClick={() => setUploadQueue([])}>清空</button></div>
                <div className="upload-list">{uploadQueue.map(item => (
                  <div className="upload-item" key={item.id}><FileIcon /><div className="upload-status"><div><b>{item.name}</b><span>{item.state === 'error' ? item.error : item.state === 'done' ? '完成' : `${item.progress}%`}</span></div><div className={`progress ${item.state}`}><i style={{ width: `${item.progress}%` }} /></div></div>{item.url && <button className="icon-button" title="复制直链" onClick={() => copyUrl(item.url ?? '').catch(console.error)}><CopyIcon /></button>}</div>
                ))}</div>
              </section>
            )}

            <section className="files-panel">
              <div className="files-header">
                <div className="breadcrumbs">
                  {prefix && <button className="icon-button" onClick={() => setPrefix(breadcrumbs.at(-2)?.prefix ?? '')}><ArrowIcon /></button>}
                  <button onClick={() => setPrefix('')}>{activeConnection.bucket}</button>
                  {breadcrumbs.map(crumb => <span key={crumb.prefix}>/<button onClick={() => setPrefix(crumb.prefix)}>{crumb.name}</button></span>)}
                </div>
                <div className="files-tools">
                  <span>{objects.length} 项</span>
                  <div className="view-toggle" role="group" aria-label="文件显示方式">
                    <button className={fileView === 'list' ? 'active' : ''} title="列表视图" aria-pressed={fileView === 'list'} onClick={() => setFileView('list')}><ListIcon /><span>列表</span></button>
                    <button className={fileView === 'grid' ? 'active' : ''} title="平铺视图" aria-pressed={fileView === 'grid'} onClick={() => setFileView('grid')}><GridIcon /><span>平铺</span></button>
                  </div>
                  <button className="icon-button" title="刷新" onClick={() => loadObjects().catch(console.error)}><RefreshIcon /></button>
                </div>
              </div>
              {loading && objects.length === 0 ? <div className="empty"><div className="spinner" /><p>正在读取云端文件…</p></div> : objects.length === 0 ? <div className="empty"><FolderIcon /><h3>这里还没有文件</h3><p>上传第一个文件，或确认连接参数和列表权限。</p></div> : (
                <div className={`file-grid ${fileView}-view`}>{objects.map(item => (
                  <article className={item.isDirectory ? 'file-card directory' : 'file-card'} key={item.key}>
                    <button className="file-preview" title={item.isDirectory ? '进入目录' : '打开文件'} onClick={() => openObject(item)}>
                      {item.isDirectory ? <FolderIcon /> : isPreviewableImage(item) && item.url ? <img src={item.url} alt="" loading="lazy" /> : <FileIcon />}
                    </button>
                    <div className="file-meta"><button className="file-name" title={item.isDirectory ? `进入 ${item.name}` : `打开 ${item.name}`} onClick={() => openObject(item)}>{item.name}</button><span>{item.isDirectory ? '目录' : `${formatBytes(item.size)} · ${item.lastModified ? new Date(item.lastModified).toLocaleDateString('zh-CN') : '未知日期'}`}</span></div>
                    {!item.isDirectory && <div className="file-actions">{item.url && <><button title="复制直链" onClick={() => copyUrl(item.url).catch(console.error)}><CopyIcon /></button><a title="打开直链" href={item.url} target="_blank" rel="noreferrer"><ExternalIcon /></a></>}<button className="danger" title="删除" onClick={() => deleteObject(item).catch(console.error)}><TrashIcon /></button></div>}
                  </article>
                ))}</div>
              )}
              {cursor && <button className="load-more" disabled={loading} onClick={() => loadObjects(true).catch(console.error)}>{loading ? '加载中…' : '加载更多'}</button>}
            </section>
          </>
        )}
      </main>

      {editorOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setEditorOpen(false) }}>
          <section className="connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title">
            <div className="modal-header"><div><p className="eyebrow">S3 CONNECTION</p><h2 id="connection-title">{editingId ? '编辑连接' : '添加连接'}</h2></div><button className="modal-close" onClick={() => setEditorOpen(false)}>×</button></div>
            <div className="connection-form">
              {editorError && <div className="connection-error wide" role="alert"><span>{editorError}</span><button type="button" onClick={() => setEditorError('')} aria-label="关闭错误提示">×</button></div>}
              <label><span>平台</span><select value={form.provider} onChange={event => { const provider = event.target.value as S3Provider; setForm(current => ({ ...current, provider, ...providerDefaults(provider), name: current.name || ProviderNames[provider] })) }}>{Object.entries(ProviderNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>连接名称</span><input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="例如：生产环境 R2" /></label>
              <label className="wide"><span>Endpoint</span><input value={form.endpoint} onChange={event => setForm(current => ({ ...current, endpoint: event.target.value }))} placeholder={form.provider === 'r2' ? 'https://<ACCOUNT_ID>.r2.cloudflarestorage.com' : 'https://s3.example.com'} /></label>
              <label><span>Region</span><input value={form.region} onChange={event => setForm(current => ({ ...current, region: event.target.value }))} placeholder="auto" /></label>
              <label><span>Bucket</span><input value={form.bucket} onChange={event => setForm(current => ({ ...current, bucket: event.target.value }))} /></label>
              <label className="wide"><span>公开访问域名（可选）</span><input value={form.publicBaseUrl} onChange={event => setForm(current => ({ ...current, publicBaseUrl: event.target.value }))} placeholder="https://files.example.com" /></label>
              <label><span>Access Key ID</span><input autoComplete="off" value={form.accessKeyId} onChange={event => setForm(current => ({ ...current, accessKeyId: event.target.value }))} /></label>
              <label><span>Secret Access Key</span><input autoComplete="off" value={form.secretAccessKey} onChange={event => setForm(current => ({ ...current, secretAccessKey: event.target.value }))} /></label>
              <label className="wide"><span>Session Token（可选）</span><input autoComplete="off" value={form.sessionToken} onChange={event => setForm(current => ({ ...current, sessionToken: event.target.value }))} /></label>
              <label className="checkbox wide"><input type="checkbox" checked={form.forcePathStyle} onChange={event => setForm(current => ({ ...current, forcePathStyle: event.target.checked }))} /><span>使用 Path-style 寻址（多数兼容平台建议开启）</span></label>
            </div>
            <div className="modal-actions">{editingId && <button className="danger-button" onClick={() => { const current = connections.find(item => item.id === editingId); if (current) removeConnection(current).catch(console.error) }}>删除连接</button>}<span /><button className="secondary" onClick={() => setEditorOpen(false)}>取消</button><button className="primary" disabled={saving} onClick={() => saveConnection().catch(console.error)}>{saving ? '保存中…' : '保存连接'}</button></div>
          </section>
        </div>
      )}
    </div>
  )
}
