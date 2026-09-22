import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { presetUno, presetAttributify, presetIcons } from 'unocss'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(fileURLToPath(import.meta.url))
export default defineConfig({
  envPrefix: [], // Credentials are read by the local backend, never injected into browser JS.
  root,
  build: {
    outDir: path.resolve(root, '../web-dist'),
    emptyOutDir: true,
    rollupOptions: { input: path.join(root, 'desktop.html') }
  },
  plugins: [vue(), UnoCSS({ presets: [presetUno(), presetAttributify(), presetIcons()] })],
  server: { host: '127.0.0.1', port: 5179, strictPort: true, cors: false },
  resolve: {
    alias: { '@renderer': path.resolve(root, '../src/renderer/src') },
    dedupe: ['vue', 'vue-router', 'pinia']
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') }
})
