import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './', // funciona tanto na raiz (servidor local) quanto no GitHub Pages
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  build: { chunkSizeWarningLimit: 2000 },
  test: { globals: true, environment: 'node' },
});
