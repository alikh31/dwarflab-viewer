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
    // The software H.265 decoder (libde265 → wasm) runs in a module worker so
    // its `import.meta.url` / wasm asset lookup work unchanged. The package's
    // Emscripten output breaks under the dev-server dependency optimizer, so
    // it is excluded there (per its README).
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['@yume-chan/libde265'] },
    build: {
      rollupOptions: {
        input: './src/renderer/index.html',
      },
    },
  },
});
