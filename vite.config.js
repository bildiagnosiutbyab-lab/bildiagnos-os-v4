import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: true },
  base: process.env.VITE_BASE || '/bildiagnos-os-v4/',
})
