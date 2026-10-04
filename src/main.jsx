import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// SDK Telegram входит в сборку: telegram.org может быть заблокирован у пользователя
import WebApp from '@twa-dev/sdk'
import './index.css'
import App from './App.jsx'

// Явное обращение к WebApp, чтобы сборщик не выкинул SDK при tree-shaking
window.Telegram ??= { WebApp }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
