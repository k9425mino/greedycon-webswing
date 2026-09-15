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
        models: resolve(__dirname, 'client/models/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
    },
  },
});
