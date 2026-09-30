import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento, `npm run dev:web` serve a interface com HMR e encaminha /api para o Worker local (porta 8787).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 700 },
});
