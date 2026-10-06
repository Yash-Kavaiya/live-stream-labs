import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

// The web origin proxies the API, so the browser only ever talks to one origin (cookies, assets).
// Production does the same with a reverse proxy; see infra/Caddyfile.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': api, '/assets': api },
  },
  build: { target: 'es2022', sourcemap: true },
});
