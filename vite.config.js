import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/zns_mgssk_bot/',
  build: {
    // Совместимость со старыми WebView на телефонах (Android System WebView, iOS Safari)
    target: ['es2019', 'safari13', 'chrome80'],
  },
  define: {
    // Время сборки — показывается в приложении, чтобы видеть, какая версия открыта
    __BUILD_TIME__: JSON.stringify(new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })),
  },
})
