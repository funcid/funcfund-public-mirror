import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local hybrid mode: infra in Docker, app services via Gradle bootRun.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5179,
    strictPort: true,
    proxy: {
      '/gateway/auth': {
        target: 'http://localhost:8081',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gateway\/auth/, '/api/v1/auth'),
      },
      '/gateway/portfolios': {
        target: 'http://localhost:8091',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gateway\/portfolios/, '/api/v1/portfolios'),
      },
      '/gateway/billing': {
        target: 'http://localhost:8086',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gateway\/billing/, '/api/v1/billing'),
      },
      '/gateway/ws': {
        target: 'http://localhost:8083',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/gateway\/ws/, '/ws'),
      },
      '/gateway/assets': {
        target: 'http://localhost:8085',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gateway\/assets/, '/api/v1/assets'),
      },
      '/gateway/currencies': {
        target: 'http://localhost:8085',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gateway\/currencies/, '/api/v1/currencies'),
      },
    },
  },
})
