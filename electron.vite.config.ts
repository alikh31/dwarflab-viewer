import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['@abandonware/noble'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    worker: { format: 'es' },
    // libde265's Emscripten build breaks under the dev-server dependency optimizer
    optimizeDeps: { exclude: ['@yume-chan/libde265'] },
    build: {
      rollupOptions: {
        input: './src/renderer/index.html',
      },
    },
  },
});
