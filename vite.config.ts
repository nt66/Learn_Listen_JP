import { defineConfig, loadEnv, type Plugin, type ViteDevServer, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import { geminiMiddleware } from './server/gemini.mjs';

function geminiApi(): Plugin {
  let env: Record<string, string> = {};
  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(geminiMiddleware(env));
  };
  return {
    name: 'kotoba-gemini-api',
    configResolved(config) { env = loadEnv(config.mode, process.cwd(), ''); },
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default defineConfig({
  plugins: [react(), geminiApi()],
  server: { port: 5173, proxy: { '/api/books': 'http://127.0.0.1:8787' } },
  preview: { port: 4173 },
});
