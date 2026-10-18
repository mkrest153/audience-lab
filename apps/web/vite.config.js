// The FastAPI service serves dist/ as it is: index.html plus hashed files in
// assets/. Its Content-Security-Policy allows same-origin scripts, styles and
// fonts only, so nothing is inlined (fonts included) and nothing loads from a CDN.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    assetsInlineLimit: 0,
    target: ['es2020', 'safari15'],
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8765', '/health': 'http://127.0.0.1:8765' },
  },
});
