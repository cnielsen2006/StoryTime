import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@storytime/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: Number(process.env.WEB_PORT) || 5173,
    // Fail rather than drift to 5174, so a second copy cannot run unnoticed.
    // scripts/free-ports.mjs stops the earlier copy before this starts.
    strictPort: true,
    // HOST=0.0.0.0 exposes the dev server to other devices on the network.
    host: process.env.HOST || '127.0.0.1',
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${Number(process.env.PORT) || 3001}`,
        changeOrigin: true,
      },
    },
  },
});
