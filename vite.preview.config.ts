import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
export default defineConfig({
  resolve: { alias: { '@': resolve('src/renderer/src') } },
  root: 'src/renderer',
  plugins: [react(), tailwind()],
  server: { host: '127.0.0.1' },
})
