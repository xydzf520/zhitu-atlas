import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { presetUno, presetAttributify, presetIcons } from 'unocss'
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: [/^node:/],
        input: { index: resolve('src/main/index.ts'), service: resolve('src/main/service.ts') }
      }
    }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    envPrefix: [],
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [vue(), UnoCSS({ presets: [presetUno(), presetAttributify(), presetIcons()] })]
  }
})
