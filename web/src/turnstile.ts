// Cloudflare Turnstile before joining over the internet (studies/show-access.md): most phones see nothing (a few
// seconds of browser checks); a checkbox appears in #cf-turnstile-slot only when Cloudflare is unsure (not id="turnstile": an element's id becomes
// a global of that name, and window.turnstile would then be the div, not Cloudflare's API: the bug of 2026-11-17). The site key comes
// from /api/config (the Static Web App's TURNSTILE_SITEKEY): empty = no Turnstile, nothing loaded.

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(id: string): void;
  reset(id: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

let siteKey: Promise<string> | undefined;
let widget: string | undefined;
let waiting: ((token: string) => void) | undefined;

function config(base: string): Promise<string> {
  siteKey ??= fetch(`${base}/api/config`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((c: { turnstile?: string }) => c.turnstile ?? '')
    .catch(() => '');
  return siteKey;
}

function loadScript(): Promise<TurnstileApi> {
  if (typeof window.turnstile?.render === 'function') return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (typeof window.turnstile?.render === 'function' ? resolve(window.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => reject(new Error('turnstile'));
    document.head.appendChild(s);
  });
}

/** A fresh Turnstile token for /api/join, '' when Turnstile isn't configured or can't load. */
export async function turnstileToken(base: string): Promise<string> {
  const key = await config(base);
  if (!key) return '';
  let api: TurnstileApi;
  try { api = await loadScript(); } catch { return ''; }
  const el = document.getElementById('cf-turnstile-slot');
  if (!el) return '';
  return new Promise<string>((resolve) => {
    const timer = window.setTimeout(() => { waiting = undefined; resolve(''); }, 60000);
    waiting = (token) => { window.clearTimeout(timer); waiting = undefined; resolve(token); };
    try {
      if (widget === undefined) {
        widget = api.render(el, {
          sitekey: key,
          appearance: 'interaction-only',
          execution: 'execute',
          theme: 'dark',
          callback: (token: string) => waiting?.(token),
          'error-callback': () => waiting?.(''),
          'expired-callback': () => { /* a new one is asked for each join */ },
        });
      } else {
        api.reset(widget);
      }
      api.execute(widget);
    } catch {
      // no token: /api/join refuses (captcha), the page says so and tries again
      waiting?.('');
    }
  });
}
