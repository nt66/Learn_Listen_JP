import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api/books': 'http://127.0.0.1:8787', '/api/admin': 'http://127.0.0.1:8787' } },
  preview: { port: 4173 },
});
