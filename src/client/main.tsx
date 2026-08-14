import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

const cloudOssIconUrl = new URL('../../cloudoss.png', import.meta.url).href
const favicon = document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/png'
favicon.href = cloudOssIconUrl
document.head.append(favicon)

const root = document.getElementById('root')
if (!root) throw new Error('Root element is missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
