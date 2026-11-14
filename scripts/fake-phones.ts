// Simulated phones for rehearsing without an audience: `pnpm bots [count] [url]`
// (default 30 phones on ws://127.0.0.1:5191/ws). Each one joins, tilts in slow waves, shakes now and then,
// touches, sends emojis, and leaves/rejoins at random. Ctrl+C stops them.

import WebSocket from 'ws';

const count = Number(process.argv[2] ?? 30);
const url = process.argv[3] ?? 'ws://127.0.0.1:5191/ws';

function bot(i: number) {
  const id = `bot-${i.toString().padStart(3, '0')}-${Math.random().toString(36).slice(2, 8)}`;
  const phase = Math.random() * Math.PI * 2;
  const speed = 0.2 + Math.random() * 0.4;
  let ws: WebSocket;
  let timer: NodeJS.Timeout | undefined;
  const connect = () => {
    ws = new WebSocket(url);
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', id, lang: Math.random() < 0.5 ? 'fr' : 'en' }));
      timer = setInterval(() => {
        const t = Date.now() / 1000;
        const shaking = Math.sin(t * 0.3 + phase) > 0.85;
        const touching = Math.sin(t * 0.5 + phase * 2) > 0.7;
        ws.send(JSON.stringify({
          t: 'in',
          tx: Math.round(Math.sin(t * speed + phase) * 100) / 100,
          ty: Math.round(Math.cos(t * speed * 0.7 + phase) * 100) / 100,
          sh: shaking ? Math.round(Math.random() * 100) / 100 : 0,
          to: touching ? 1 : 0,
          ...(touching ? { px: Math.round(Math.random() * 100) / 100, py: Math.round(Math.random() * 100) / 100 } : {}),
        }));
        if (Math.random() < 0.02) ws.send(JSON.stringify({ t: 'emo', e: Math.random() < 0.4 ? 0 : Math.floor(Math.random() * 8) }));
        if (Math.random() < 0.0005) ws.close(); // leaves, comes back
      }, 200);
    });
    ws.on('close', () => { if (timer) clearInterval(timer); setTimeout(connect, 2000 + Math.random() * 3000); });
    ws.on('error', () => { /* 'close' follows */ });
  };
  setTimeout(connect, i * 100);
}

for (let i = 0; i < count; i++) bot(i);
console.log(`${count} fake phones -> ${url} (Ctrl+C to stop)`);
