import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  // FortuneSheet 0.13 still references Node's `global` in its browser bundle.
  // Map it to the standards-based browser global without shipping a Node polyfill.
  define: {
    global: 'globalThis',
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          icons: ['lucide-react'],
          state: ['zustand'],
        },
      },
    },
  },
  server: {
    watch: {
      // 数据库、备份和上传文件由后端管理；Windows 下监听锁定的 DB 文件会导致 Vite 退出。
      ignored: ['**/data/**', '**/demo-data*/**', '**/logs/**'],
    },
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/tools-host': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react({
      babel: {
        plugins: process.env.NODE_ENV === 'development' ? ['react-dev-locator'] : [],
      },
    }),
    tsconfigPaths()
  ],
})
