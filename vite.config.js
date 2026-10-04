import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Замените 'ВАШ_GITHUB_НИКНЕЙМ' и 'ИМЯ_РЕПОЗИТОРИЯ' на ваши данные
export default defineConfig({
  plugins: [react()],
  base: '/zns_mgssk_bot/', 
})