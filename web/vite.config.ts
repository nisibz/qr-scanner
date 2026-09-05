import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// The single source of truth for the app version.
const version = (require('./package.json') as { version: string }).version

// __APP_VERSION__ is statically replaced everywhere the bundler compiles
// (app code and the service worker) — no sync scripts, no generated files.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    rollupOptions: {
      input: {
        app: path.resolve(import.meta.dirname, 'index.html'),
        // Emit the service worker as its own bundle from src/sw.ts.
        'sw': path.resolve(import.meta.dirname, 'src/sw.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
      },
    },
  },
})
