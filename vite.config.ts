import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// The phone page.
// - `pnpm dev`: http://localhost:5192, for the PC (http://localhost is a secure context, no certificate needed).
// - `pnpm dev:phone`: https on the LAN with a self-signed certificate, accepted once on each phone: motion
//   sensors, wake lock and vibration need a secure context, and a LAN address over http isn't one.
// /ws goes to the audience server (pnpm server, port 5191), so the phone's websocket is same-origin.
// `pnpm build` writes dist/ for the SWA.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig(({ mode }) => ({
  root: 'web',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  plugins: mode === 'phone' ? [react(), basicSsl()] : [react()],
  server: {
    host: true,
    port: 5192,
    proxy: { '/ws': { target: 'ws://127.0.0.1:5191', ws: true } },
  },
  build: { outDir: '../dist', emptyOutDir: true },
}));
