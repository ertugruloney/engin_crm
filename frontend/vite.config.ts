import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    allowedHosts: [
      '.ngrok-free.app',
      ...(process.env.NGROK_HOST ? [process.env.NGROK_HOST] : []),
    ],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
      },
      '/media': {
        target: 'http://127.0.0.1:8000',
      },
    },
  },
})
