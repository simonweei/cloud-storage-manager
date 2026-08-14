# Cloud Shelf

部署在 Cloudflare Workers 上的多连接 S3 对象存储管理器。所有对象存储统一通过 S3 兼容 API 访问，支持在页面中添加、编辑和删除连接。

## 功能

- Cloudflare R2、七牛云 Kodo、又拍云及其他 S3 兼容存储
- 保存多个 Endpoint、Region、Bucket 和访问凭证
- 文件/目录列举、分页、上传、删除、图片预览和直链复制
- 浏览器使用 10 分钟有效的预签名 PUT 地址直传
- 连接凭证以明文保存到 D1，并可在编辑页面直接查看
- 密码登录保护管理页面和所有管理 API，登录会话使用 HttpOnly Cookie

## 安全模型

Access Key ID、Secret Access Key 和 Session Token 以明文 JSON 写入 D1，并通过登录后的连接列表接口返回，以便在编辑页面直接查看和修改。请严格限制 Cloudflare 账户、D1 数据库和管理页面的访问权限。

管理页面使用 `APP_PASSWORD` 登录。登录成功后，Worker 会签发由 `SESSION_SECRET` 签名、有效期 12 小时的 HttpOnly、SameSite=Strict Cookie；连续输错 5 次会暂时锁定 15 分钟。生产环境请使用高强度密码。若要立即让所有已有会话失效，请轮换 `SESSION_SECRET`。

## 本地运行

要求 Node.js 20+ 和 pnpm。

```powershell
pnpm install
Copy-Item .dev.vars.example .dev.vars
```

在 `.dev.vars` 中设置 `APP_PASSWORD`，并生成一个 32 字节随机值写入 `SESSION_SECRET`：

```powershell
$keyBytes = New-Object byte[] 32
$keyGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$keyGenerator.GetBytes($keyBytes)
$keyGenerator.Dispose()
[Convert]::ToBase64String($keyBytes)
```

初始化本地 D1 并启动：

```powershell
pnpm wrangler d1 migrations apply cloud-storage-manager --local
pnpm dev
```

打开 `http://127.0.0.1:5173`，输入 `.dev.vars` 中的 `APP_PASSWORD` 登录，然后在页面中添加 S3 连接。本地 D1 数据保存在 `.wrangler/`，重启后仍会保留。

## 连接参数

| 参数 | 说明 |
| --- | --- |
| 平台 | 用于界面标识和默认参数，不限制实际 S3 服务商 |
| Endpoint | S3 API 根地址，生产环境必须使用 HTTPS |
| Region | 签名使用的区域；R2 通常为 `auto` |
| Bucket | S3 存储桶名称 |
| 公开访问域名 | 可选，用于预览、打开和复制文件直链 |
| Path-style | 兼容平台通常建议开启；若服务商要求虚拟主机寻址可关闭 |
| Access Key ID / Secret Access Key | S3 访问凭证，以明文保存并在编辑页面回显 |
| Session Token | 使用临时凭证时填写 |

常用 Endpoint：

- R2：`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`，Region 为 `auto`
- 七牛云：按区域填写，例如 `https://s3.cn-east-1.qiniucs.com`
- 又拍云：`https://s3.api.upyun.com`

## CORS

文件由浏览器直接上传到对象存储，因此每个 Bucket 都需要允许管理站点域名发起 `PUT` 请求，并允许 `Content-Type` 等签名请求头。生产环境不要使用不受限制的 `*` Origin，建议只允许 Cloud Shelf 的实际域名。

## 部署到 Cloudflare

创建 D1：

```powershell
pnpm wrangler login
pnpm wrangler d1 create cloud-storage-manager
```

将返回的 `database_id` 写入 `wrangler.jsonc`，然后设置 Secrets：

```powershell
pnpm wrangler secret put APP_PASSWORD
pnpm wrangler secret put SESSION_SECRET
```

应用远程迁移并部署：

```powershell
pnpm wrangler d1 migrations apply cloud-storage-manager --remote
pnpm deploy
```

建议同时使用 Cloudflare Access 保护站点域名，并为每个 S3 凭证限制到必需的 Bucket 和读写权限。

## 验证

```powershell
pnpm test
pnpm typecheck
pnpm build
```

当前上传方式为单次预签名 PUT，单文件限制为 5 GB；超大文件的 S3 Multipart Upload 尚未加入页面流程。
