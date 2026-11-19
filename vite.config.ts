import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// The phone page.
// - `pnpm dev`: http://localhost:5192, for the PC (http://localhost is a secure context, no certificate needed).
// - `pnpm dev:phone`: https on the LAN with a self-signed certificate, accepted once on each phone: motion
//   sensors, wake lock and vibration need a secure context, and a LAN address over http isn't one.
// /ws and /api/library (the Workshop's public library) go to the audience server (pnpm server, port 5191), so the
// phone's websocket and library are same-origin.
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
    proxy: { '/ws': { target: 'ws://127.0.0.1:5191', ws: true }, '/api/library': { target: 'http://127.0.0.1:5191' } },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // the Workshop's Strudel chunk (engine + CodeMirror, ~1.1 MB, loaded only when a Strudel section opens): known
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // Strudel's own packages (as in the WebApp's config): @strudel/web re-exports "logger"/"errorLogger" from two
      // packages (the duplicate is ignored), @strudel/soundfonts uses eval. Only those two, only from @strudel
      onwarn(warning, warn) {
        const where = `${warning.id ?? ''} ${warning.message ?? ''}`;
        if ((warning.code === 'NAMESPACE_CONFLICT' || warning.code === 'EVAL') && where.includes('@strudel')) return;
        warn(warning);
      },
    },
  },
}));
