import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  server: {
    // In production this path is served by `api/overpass.ts` (Vercel
    // edge function). In dev, forward to the public Overpass mirror so
    // the same client code works without spinning up `vercel dev`.
    proxy: {
      '/api/overpass': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: () => '/api/interpreter',
      },
    },
  },
})
