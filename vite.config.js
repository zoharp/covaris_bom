import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the Covaris BOM Viewer.
//
// - Dev server runs on port 5173.
// - The `/api/orcanos/` path is proxied to the upstream Orcanos REST API
//   in dev only — this lets us avoid browser CORS issues during local dev
//   without changing app code. In production on Vercel, the same path is
//   handled by `vercel.json` rewrites (see that file).
// - All settings (base URL, version, filter IDs) come from `public/settings.xml`
//   at runtime, NOT from build-time env vars.

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api/orcanos': {
        target: 'https://us.orcanos.com',
        changeOrigin: true,
        secure: true,
        // Strip the local prefix and prepend the Orcanos path:
        //   /api/orcanos/QW_Login → /covaris/api/v2/Json/QW_Login
        rewrite: (path) =>
          path.replace(/^\/api\/orcanos/, '/covaris/api/v2/Json'),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
