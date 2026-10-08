import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Окружения — файлы .env.<режим>: production (рабочее), test (тестовое), development (npm run dev).
// В них адрес Apps Script, путь на GitHub Pages и метка окружения
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react()],
    base: env.VITE_BASE || '/zns_mgssk_bot/',
    build: {
      // Совместимость со старыми WebView на телефонах (Android System WebView, iOS Safari)
      target: ['es2019', 'safari13', 'chrome80'],
    },
    define: {
      // Время сборки — показывается в приложении, чтобы видеть, какая версия открыта
      __BUILD_TIME__: JSON.stringify(new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })),
    },
  }
})
