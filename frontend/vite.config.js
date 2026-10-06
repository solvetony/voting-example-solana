import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: { '/voting-api': 'http://127.0.0.1:3101' }
  }
})
