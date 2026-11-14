import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// The phone page. `pnpm dev` serves it over https on the LAN (a self-signed certificate, accepted once on the
// phone): motion sensors, wake lock and vibration need a secure context. /ws goes to the audience server
// (pnpm server, port 5191), so the phone's websocket is same-origin wss. `pnpm build` writes dist/ for the SWA.
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    port: 5192,
    proxy: { '/ws': { target: 'ws://127.0.0.1:5191', ws: true } },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
