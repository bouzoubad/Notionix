import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Web client: the app's interface, talking to a Notionix server; served by that server. */
export default defineConfig({
  root: resolve('src/web'),
  base: '/',
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react()],
  build: {
    outDir: resolve('out/server/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096
  },
  server: {
    // `npm run dev:web` next to a server started on port 8080.
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/collab': { target: 'ws://127.0.0.1:8080', ws: true }
    }
  }
})
