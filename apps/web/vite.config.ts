import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/** Dev-server equivalent of the Hosting rewrite `/app{,/**}` → `/app/index.html`. */
function workspaceDeepLinks(): Plugin {
  return {
    name: 'shelf2kumo-workspace-deep-links',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if ((path === '/app' || path.startsWith('/app/')) && !path.includes('.')) req.url = '/app/index.html';
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), workspaceDeepLinks()],
  // One .env.local at the repo root; Vite exposes only VITE_* variables to the client.
  envDir: `${root}../..`,
  build: {
    // The storefront function reads the manifest to link the fingerprinted storefront stylesheet.
    manifest: true,
    rollupOptions: {
      input: {
        landing: `${root}index.html`,
        app: `${root}app/index.html`,
        storefront: `${root}src/storefront/storefront.css`,
      },
    },
  },
});
