import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => ({
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.SINERGI_API_TARGET
          ?? loadEnv(mode, process.cwd(), 'SINERGI_').SINERGI_API_TARGET
          ?? 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
}))
