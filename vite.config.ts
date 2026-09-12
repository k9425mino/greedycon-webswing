import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        host: resolve(__dirname, 'client/index.html'),
        controller: resolve(__dirname, 'client/controller/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
    },
  },
});
