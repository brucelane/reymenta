// A Hydra sketch in the Workshop (studies/reymenta-workshop.md step 5): hydra-synth (1.4.0, AGPL, like Reymenta)
// drawing in a canvas that fills the section, a CodeMirror 6 editor over it (background opacity adjustable), Hydra's
// keys (Ctrl+Enter the line or selection, Alt+Enter the block, Ctrl+Shift+Enter all, Ctrl+Shift+H hide/show the code),
// Ctrl+Space = the user's own shortcuts (hydraShortcuts.ts) else the completion list (hydraComplete.ts, read from
// hydra-synth's own function list), a parameter hint inside a call, errors on their line.
// Lazy-loaded (TrackScreen, Workshop): hydra-synth and CodeMirror load only when a Hydra section opens.
// Code is JavaScript: nothing runs until the user presses Run (or one of the run keys), whatever its origin. Hydra and
// its WebGL context are created on the first run and destroyed when the section closes; the drawing loop pauses
// while the canvas is off screen or the page hidden. The microphone (Hydra's `a`) only after the Mic button.
// On a phone (no Ctrl+Enter): a sticky toolbar (▶ All, ▶ Block, Hide, Live), the Live switch (the sketch re-run
// ~500 ms after the last edit, the last working version kept on an error; only after a first explicit Run), and an
// extra-keys row above the keyboard (brackets, quotes, digits, a ± stepper on the number under the cursor).
// The logic of these is in hydraTouch.ts.
import { useEffect, useRef, useState } from 'react';
import { autocompletion, closeBrackets, closeBracketsKeymap, snippetCompletion, startCompletion, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { EditorSelection, EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration, EditorView, highlightActiveLine, keymap, lineNumbers, showTooltip, type DecorationSet, type Tooltip } from '@codemirror/view';
import Hydra from 'hydra-synth';
import { hydraFileName, starterSketch, validateHydra } from './hydra';
import { hintAt, hydraOptions } from './hydraComplete';
import { blockAt, compile, errorLine, run } from './hydraEval';
import { expand } from './hydraShortcuts';
import { EXTRA_KEYS, LIVE_NUDGE_MS, LiveRunner, nudge, numberAt } from './hydraTouch';
import { download } from './storage';
import type { WTexts } from './texts';

const SAVE_MS = 600;
const OPACITY_KEY = 'reymenta:hydra:opacity';
const LIVE_KEY = 'reymenta:hydra:live';
/** a phone or a tablet: the toolbar and the extra keys matter there */
const TOUCH_QUERY = '(pointer: coarse), (hover: none)';
/** canvas pixels per CSS pixel, kept low for phones (Hydra's own editor uses 1) */
const MAX_DPR = 1.5;
const MAX_SIDE = 1920;

/** Hydra's `a` before the microphone is on: the same shape, all zero, so sketches using it run (silently). */
const silentAudio = () => ({
  fft: [0, 0, 0, 0], vol: 0, bins: [0, 0, 0, 0],
  setBins() {}, setSmooth() {}, setCutoff() {}, setScale() {}, setMax() {}, show() {}, hide() {}, onBeat() {}, tick() {},
});

const readLive = () => { try { return localStorage.getItem(LIVE_KEY) === '1'; } catch { return false; } };
const isTouch = () => typeof matchMedia === 'function' && matchMedia(TOUCH_QUERY).matches;

const readOpacity = () => { try { const v = Number(localStorage.getItem(OPACITY_KEY)); return v >= 0 && v <= 1 && localStorage.getItem(OPACITY_KEY) !== null ? v : 0.45; } catch { return 0.45; } };

export default function HydraSection({ t, name, title, bpm, code, save }: {
  t: WTexts; name: string; title: string; bpm?: number; code: string | undefined; save: (code: string) => void;
}) {
  const [text, setText] = useState(code ?? '');
  const [error, setError] = useState<{ msg: string; line?: number; kept?: boolean } | undefined>();
  const [msg, setMsg] = useState('');
  const [ran, setRan] = useState(false);
  const [shown, setShown] = useState(true);
  const [opacity, setOpacity] = useState(readOpacity);
  const [mic, setMic] = useState<'off' | 'asking' | 'on'>('off');
  const [noGl, setNoGl] = useState(false);
  const [live, setLive] = useState(readLive);
  const [touch, setTouch] = useState(isTouch);
  const [focused, setFocused] = useState(false);
  const [onNumber, setOnNumber] = useState(false);
  /** the next edit is a ± step: Live runs it sooner, like a knob */
  const nudging = useRef(false);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hydra = useRef<Hydra | null>(null);
  const loop = useRef({ raf: 0, last: 0, visible: true });
  const editor = useRef<EditorView | null>(null);

  // edits saved a moment after typing stops (and when the section closes)
  const pending = useRef<string | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  const flush = () => {
    const v = pending.current;
    if (v === undefined) return;
    pending.current = undefined;
    saveRef.current(v);
  };
  useEffect(() => {
    if (pending.current === undefined) return;
    const timer = window.setTimeout(flush, SAVE_MS);
    return () => window.clearTimeout(timer);
  });
  useEffect(() => {
    // new code from outside (the catalogue, another tab): it waits for an explicit Run, Live included
    if (code !== undefined && code !== text && pending.current === undefined) { liveRunner().disarm(); setRan(false); setText(code); }
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (v: string) => {
    setText(v);
    pending.current = v;
    setError(undefined);
    liveRunner().edit(v, nudging.current ? LIVE_NUDGE_MS : undefined);
  };

  useEffect(() => { try { localStorage.setItem(LIVE_KEY, live ? '1' : '0'); } catch { /* fine */ } liveRunner().setEnabled(live); }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(TOUCH_QUERY);
    const on = () => setTouch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => { try { localStorage.setItem(OPACITY_KEY, String(opacity)); } catch { /* fine */ } }, [opacity]);

  // ------------------------------------------------------------ Hydra and its loop
  const size = () => {
    const el = stage.current;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(16, Math.min(MAX_SIDE, Math.round((el?.clientWidth ?? 640) * dpr)));
    const h = Math.max(16, Math.min(MAX_SIDE, Math.round((el?.clientHeight ?? 360) * dpr)));
    return [w, h] as const;
  };
  const frame = (now: number) => {
    const l = loop.current;
    const h = hydra.current;
    if (!h || !l.visible || document.hidden) { l.raf = 0; return; }
    const dt = l.last ? Math.min(100, now - l.last) : 16;
    l.last = now;
    h.tick(dt);
    l.raf = requestAnimationFrame(frame);
  };
  const start = () => {
    const l = loop.current;
    if (l.raf || !hydra.current) return;
    l.last = 0;
    l.raf = requestAnimationFrame(frame);
  };
  const ensure = (): Hydra | null => {
    if (hydra.current) return hydra.current;
    const c = canvas.current;
    if (!c) return null;
    const [w, h] = size();
    c.width = w;
    c.height = h;
    try {
      const hy = new Hydra({ canvas: c, width: w, height: h, makeGlobal: false, autoLoop: false, detectAudio: false, enableStreamCapture: false });
      hy.synth.a = silentAudio();
      hydra.current = hy;
      start();
      return hy;
    } catch (e) {
      setNoGl(true);
      setError({ msg: t.hydraNoWebgl((e as Error)?.message ?? String(e)) });
      return null;
    }
  };

  // paused off screen and when the page is hidden; resized with the section
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { loop.current.visible = !!e?.isIntersecting; if (e?.isIntersecting) start(); });
    io.observe(el);
    const ro = new ResizeObserver(() => {
      const h = hydra.current;
      if (!h) return;
      const [w, hh] = size();
      if (w !== h.canvas.width || hh !== h.canvas.height) h.setResolution(w, hh);
    });
    ro.observe(el);
    const vis = () => { if (!document.hidden) start(); };
    document.addEventListener('visibilitychange', vis);
    return () => { io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', vis); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // closing the section: save, stop the loop, the microphone, the camera, and give the GPU back
  useEffect(() => () => {
    flush();
    cancelAnimationFrame(loop.current.raf);
    loop.current.raf = 0;
    const h = hydra.current;
    hydra.current = null;
    if (!h) return;
    stopMic(h);
    try { h.s.forEach((s) => s.clear()); } catch { /* fine */ }
    try { h.regl.destroy(); } catch { /* fine */ }
    try { (h.canvas.getContext('webgl') as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* fine */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ running code
  const showError = async (e: unknown, codePart: string, fromLine: number, kept?: boolean) => {
    const l = await errorLine(e, codePart.split('\n').length);
    const line = l !== undefined ? fromLine + l : undefined;
    setError({ msg: (e as Error)?.message ?? String(e), line, kept });
    markError(editor.current, line ?? null);
  };
  /** runs `code` (lines from..to of the editor, 0-based); `all` = the whole sketch */
  const evaluate = async (codePart: string, fromLine: number, all = false) => {
    const h = ensure();
    if (!h) return;
    liveRunner().cancel();
    setRan(true);
    setMsg('');
    try {
      await run(codePart, h.synth);
      liveRunner().arm(all ? codePart : undefined);
      setError(undefined);
      markError(editor.current, null);
      start();
    } catch (e) {
      liveRunner().arm();
      await showError(e, codePart, fromLine);
    }
  };

  // Live: the whole sketch again a moment after the last edit (hydraTouch.ts), only once the sketch was run by hand
  const liveRef = useRef<LiveRunner | null>(null);
  function liveRunner(): LiveRunner {
    liveRef.current ??= new LiveRunner({
      parse: (c) => { compile(c); },
      run: async (c) => { const h = hydra.current; if (!h) throw new Error('Hydra'); await run(c, h.synth); },
      onOk: () => { setError(undefined); markError(editor.current, null); start(); },
      onError: (e, c, kept) => { void showError(e, c, 0, kept); },
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => window.clearTimeout(id as number),
    });
    return liveRef.current;
  }
  useEffect(() => () => liveRef.current?.disarm(), []);

  const runAll = () => { const v = editor.current; const all = v ? v.state.doc.toString() : text; flashLines(v, 1, v?.state.doc.lines ?? 1); void evaluate(all, 0, true); };
  const runLine = (v: EditorView) => {
    const sel = v.state.selection.main;
    if (!sel.empty) {
      const a = v.state.doc.lineAt(sel.from).number;
      flashLines(v, a, v.state.doc.lineAt(sel.to).number);
      void evaluate(v.state.sliceDoc(sel.from, sel.to), a - 1);
    } else {
      const line = v.state.doc.lineAt(sel.head);
      flashLines(v, line.number, line.number);
      void evaluate(line.text, line.number - 1);
    }
    return true;
  };
  const runBlock = (v: EditorView) => {
    const lines = v.state.doc.toString().split('\n');
    const b = blockAt(lines, v.state.doc.lineAt(v.state.selection.main.head).number - 1);
    flashLines(v, b.from + 1, b.to + 1);
    void evaluate(lines.slice(b.from, b.to + 1).join('\n'), b.from);
    return true;
  };
  /** ± on the number under the cursor (by its last decimal place) */
  const step = (dir: 1 | -1) => {
    const v = editor.current;
    if (!v) return;
    const sel = v.state.selection.main;
    const line = v.state.doc.lineAt(sel.head);
    const c = nudge(line.text, sel.head - line.from, dir);
    if (!c) return;
    const from = line.from + c.from;
    nudging.current = true;
    try {
      v.dispatch({ changes: { from, to: line.from + c.to, insert: c.insert }, selection: { anchor: from + c.insert.length }, scrollIntoView: true, userEvent: 'input.nudge' });
    } finally { nudging.current = false; }
  };
  const insertKey = (k: string) => {
    const v = editor.current;
    if (!v) return;
    v.dispatch({ ...v.state.replaceSelection(k), scrollIntoView: true, userEvent: 'input.type' });
  };

  const hush = () => { hydra.current?.hush(); setError(undefined); markError(editor.current, null); };

  // Ctrl+Shift+H anywhere while the section is open (the editor may be hidden)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'H' || e.key === 'h')) { e.preventDefault(); setShown((s) => !s); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ------------------------------------------------------------ microphone
  function stopMic(h: Hydra) {
    const a = h.synth.a as { stream?: MediaStream; context?: AudioContext; canvas?: HTMLCanvasElement } | undefined;
    try { a?.stream?.getTracks().forEach((tr) => tr.stop()); } catch { /* fine */ }
    try { void a?.context?.close(); } catch { /* fine */ }
    try { a?.canvas?.remove(); } catch { /* fine */ }
    h.detectAudio = false;
    h.synth.a = silentAudio();
  }
  const toggleMic = async () => {
    if (mic === 'on') { if (hydra.current) stopMic(hydra.current); setMic('off'); return; }
    const h = ensure();
    if (!h) return;
    setMic('asking');
    try {
      // the permission prompt, here (Hydra's own request swallows a refusal); then Hydra opens it again, granted
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      probe.getTracks().forEach((tr) => tr.stop());
    } catch (e) {
      setMic('off');
      setMsg(t.hydraMicDenied((e as Error)?.message ?? String(e)));
      return;
    }
    h.detectAudio = true;
    h._initAudio();
    const a = h.synth.a as { canvas?: HTMLCanvasElement; context?: AudioContext; hide?: () => void };
    a.hide?.();
    // Hydra creates its AudioContext once the stream comes: resume it if the browser started it suspended
    window.setTimeout(() => { void a.context?.resume?.(); }, 1500);
    setMic('on');
    setMsg(t.hydraMicOn);
  };

  // ------------------------------------------------------------ files
  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const v = validateHydra(await file.text());
    if (typeof v !== 'string') return setMsg(t.patchRefused(v.error));
    pending.current = undefined;
    liveRunner().disarm();
    setText(v);
    save(v);
    setRan(false);
    setMsg(t.hydraImported);
  };

  if (code === undefined && !text) {
    return (
      <div className="ws-hydra">
        <p className="ws-dim">{t.hydraNone}</p>
        <div className="ws-actions">
          <button onClick={() => { const v = starterSketch({ title, bpm }); setText(v); save(v); }}>{t.hydraMake}</button>
          <HydraImport t={t} onFile={onImport} />
        </div>
        {msg && <p className="ws-msg">{msg}</p>}
      </div>
    );
  }

  const errorText = error && `${error.line ? t.hydraErrorLine(error.line, error.msg) : t.evalError(error.msg)}${error.kept ? ` ${t.hydraLiveKept}` : ''}`;
  return (
    <div className="ws-hydra">
      <div className="ws-hydra-bar" onMouseDown={keepFocus}>
        <button className="ws-play" onClick={runAll} disabled={noGl}>{t.hydraRunAll}</button>
        <button className="ws-play" onClick={() => { if (editor.current) runBlock(editor.current); }} disabled={noGl || !shown}>{t.hydraRunBlock}</button>
        <button onClick={() => setShown((s) => !s)} aria-pressed={!shown}>{shown ? t.hydraHide : t.hydraShow}</button>
        <button role="switch" aria-checked={live} className={live ? 'on ws-hydra-live' : 'ws-hydra-live'} disabled={noGl || !ran}
          title={ran ? t.hydraLiveTip : t.hydraLiveNeedsRun} onClick={() => setLive((l) => !l)}>
          <span className="ws-hydra-dot" aria-hidden />{t.hydraLive}
        </button>
        <button onClick={() => void toggleMic()} disabled={noGl || mic === 'asking'} aria-pressed={mic === 'on'} className={mic === 'on' ? 'on' : ''}>
          {mic === 'on' ? t.hydraMicStop : t.hydraMic}
        </button>
        <button onClick={hush} disabled={!hydra.current}>{t.hydraHush}</button>
      </div>
      <div className="ws-hydra-stage" ref={stage}>
        <canvas ref={canvas} className="ws-hydra-canvas" />
        <div className="ws-hydra-code" style={{ display: shown ? undefined : 'none', ['--code-bg' as string]: `rgba(0, 0, 0, ${opacity})` }}>
          <CodeEditor value={text} onChange={edit} viewRef={editor} onRunAll={runAll} onRunLine={runLine} onRunBlock={runBlock}
            onFocus={setFocused} onCursor={setOnNumber} touch={touch} />
        </div>
        {errorText && <p className="ws-hydra-error">{errorText}</p>}
      </div>
      {touch && focused && shown && <ExtraKeys t={t} onKey={insertKey} onStep={step} canStep={onNumber} error={errorText} />}
      <label className="ws-hydra-opacity">{t.hydraOpacity}
        <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
      </label>
      {!ran && <p className="ws-dim ws-small">{t.hydraNotRun}</p>}
      {msg && <p className="ws-msg">{msg}</p>}
      <p className="ws-dim ws-small">{touch ? t.hydraKeysTouch : t.hydraKeys}</p>
      <div className="ws-actions">
        <button onClick={() => download(hydraFileName(name), text, 'text/javascript')}>{t.download} {hydraFileName(name)}</button>
        <HydraImport t={t} onFile={onImport} />
      </div>
    </div>
  );
}

/** keeps the editor focused (and the phone keyboard up) when a toolbar or extra key is tapped */
const keepFocus = (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); };

/** how far the phone keyboard pushes up the bottom of the page (visual viewport), in CSS pixels */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    on();
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => { vv.removeEventListener('resize', on); vv.removeEventListener('scroll', on); };
  }, []);
  return inset;
}

/** − / + with a long press that repeats (first step at once, then after 400 ms every 70 ms) */
function StepButton({ label, title, disabled, onStep }: { label: string; title: string; disabled: boolean; onStep: () => void }) {
  const timer = useRef<{ t: number; i: number }>({ t: 0, i: 0 });
  const stop = () => { window.clearTimeout(timer.current.t); window.clearInterval(timer.current.i); timer.current = { t: 0, i: 0 }; };
  useEffect(() => stop, []);
  useEffect(() => { if (disabled) stop(); }, [disabled]);
  return (
    <button className="ws-hydra-step" title={title} aria-label={title} disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
        stop();
        onStep();
        timer.current.t = window.setTimeout(() => { timer.current.i = window.setInterval(onStep, 70); }, 400);
      }}
      onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
      onClick={(e) => { if (e.detail === 0) onStep(); /* keyboard; a tap already stepped on pointerdown */ }}
      onContextMenu={(e) => e.preventDefault()}>
      {label}
    </button>
  );
}

/** The row above the phone keyboard: ± on the number under the cursor, then characters that are far on a phone. */
function ExtraKeys({ t, onKey, onStep, canStep, error }: { t: WTexts; onKey: (k: string) => void; onStep: (dir: 1 | -1) => void; canStep: boolean; error?: string }) {
  const inset = useKeyboardInset();
  return (
    <div className="ws-hydra-keys" style={{ bottom: inset }} onMouseDown={keepFocus} role="toolbar" aria-label={t.hydraExtraKeys}>
      {/* the stage's error bar is under the keyboard: the message again, one line, above the keys */}
      {error && <p className="ws-hydra-keys-error" role="status">{error}</p>}
      <StepButton label="−" title={t.hydraStepDown} disabled={!canStep} onStep={() => onStep(-1)} />
      <StepButton label="+" title={t.hydraStepUp} disabled={!canStep} onStep={() => onStep(1)} />
      <div className="ws-hydra-keys-scroll">
        {EXTRA_KEYS.map((k) => <button key={k} onClick={() => onKey(k)}>{k}</button>)}
      </div>
    </div>
  );
}

function HydraImport({ t, onFile }: { t: WTexts; onFile: (f: File | undefined) => void }) {
  return (
    <label className="ws-filebtn">
      {t.hydraImport}
      <input type="file" accept=".js,.mjs,.txt,text/javascript,text/plain" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
    </label>
  );
}

// ------------------------------------------------------------ CodeMirror pieces

/** the line of the last error (1-based), or none */
const setErrorLine = StateEffect.define<number | null>();
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue;
      if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none;
      return Decoration.set([Decoration.line({ class: 'cm-hydra-error' }).range(tr.state.doc.line(e.value).from)]);
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
function markError(v: EditorView | null, line: number | null) { v?.dispatch({ effects: setErrorLine.of(line) }); }

/** the lines just run, lit for a moment (as Hydra's editor does) */
const setFlash = StateEffect.define<{ from: number; to: number } | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setFlash)) continue;
      if (!e.value) return Decoration.none;
      const marks = [];
      for (let l = Math.max(1, e.value.from); l <= Math.min(tr.state.doc.lines, e.value.to); l++) marks.push(Decoration.line({ class: 'cm-hydra-flash' }).range(tr.state.doc.line(l).from));
      return Decoration.set(marks);
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});
function flashLines(v: EditorView | null, from: number, to: number) {
  if (!v) return;
  v.dispatch({ effects: setFlash.of({ from, to }) });
  window.setTimeout(() => { if (v.dom.isConnected) v.dispatch({ effects: setFlash.of(null) }); }, 300);
}

/** Hydra's functions as snippets: `osc(frequency = 60, ...)`, the first default selected, Tab to the next. */
function hydraSource(ctx: CompletionContext) {
  const word = ctx.matchBefore(/[\w$]*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  const afterDot = ctx.state.sliceDoc(word.from - 1, word.from) === '.';
  return {
    from: word.from,
    options: hydraOptions(afterDot).map((o) => snippetCompletion(o.snippet, { label: o.label, detail: o.detail, info: o.info, type: 'function', boost: o.boost })),
    validFor: /^[\w$]*$/,
  };
}

/** Ctrl+Space: the user's two-letter (or one-character) shortcut before the cursor, else the completion list. */
function shortcutOrComplete(v: EditorView): boolean {
  const sel = v.state.selection.main;
  if (!sel.empty) return startCompletion(v);
  const line = v.state.doc.lineAt(sel.head);
  const x = expand(line.text.slice(0, sel.head - line.from));
  if (!x) return startCompletion(v);
  const at = sel.head - x.length;
  v.dispatch({ changes: { from: at, to: sel.head, insert: x.insert }, selection: EditorSelection.single(at + x.from, at + x.to), scrollIntoView: true, userEvent: 'input.complete' });
  return true;
}

/** The signature of the Hydra call around the cursor, the current argument in bold. */
const hintField = StateField.define<readonly Tooltip[]>({
  create: (s) => hint(s),
  update: (tips, tr) => (tr.docChanged || tr.selection ? hint(tr.state) : tips),
  provide: (f) => showTooltip.computeN([f], (s) => s.field(f)),
});
function hint(state: EditorState): readonly Tooltip[] {
  // a selected snippet field counts as the cursor at its start
  const at = state.selection.main.from;
  const h = hintAt(state.sliceDoc(Math.max(0, at - 2000), at));
  if (!h) return [];
  return [{
    pos: at, above: true, strictSide: false, arrow: false,
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'cm-hydra-hint';
      dom.append(`${h.fn.name}(`);
      h.fn.params.forEach((p, i) => {
        if (i) dom.append(', ');
        const s = document.createElement(i === h.arg ? 'b' : 'span');
        s.textContent = `${p.name} = ${p.value}`;
        dom.append(s);
      });
      dom.append(')');
      return { dom };
    },
  }];
}

/** CodeMirror 6 without the React wrapper (as StrudelSection): transparent over the canvas, Hydra's keys. */
function CodeEditor({ value, onChange, viewRef, onRunAll, onRunLine, onRunBlock, onFocus, onCursor, touch }: {
  value: string; onChange: (v: string) => void; viewRef: React.MutableRefObject<EditorView | null>;
  onRunAll: () => void; onRunLine: (v: EditorView) => boolean; onRunBlock: (v: EditorView) => boolean;
  onFocus: (focused: boolean) => void; onCursor: (onNumber: boolean) => void; touch: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onChange, onRunAll, onRunLine, onRunBlock, onFocus, onCursor });
  handlers.current = { onChange, onRunAll, onRunLine, onRunBlock, onFocus, onCursor };
  const blurTimer = useRef(0);
  useEffect(() => {
    const extensions: Extension[] = [
      lineNumbers(), history(), closeBrackets(), highlightActiveLine(), javascript(), oneDark,
      // before autocompletion(): its own Prec.highest keymap binds Ctrl-Space too, and the first one listed wins
      Prec.highest(keymap.of([
        { key: 'Mod-Shift-Enter', run: () => { handlers.current.onRunAll(); return true; } },
        { key: 'Mod-Enter', run: (v) => handlers.current.onRunLine(v) },
        { key: 'Alt-Enter', run: (v) => handlers.current.onRunBlock(v) },
        { key: 'Ctrl-Space', run: shortcutOrComplete },
        { key: 'Mod-/', run: toggleComment },
      ])),
      autocompletion({ override: [hydraSource], icons: false }),
      errorField, flashField, hintField,
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
        if (u.docChanged || u.selectionSet) {
          const head = u.state.selection.main.head;
          const line = u.state.doc.lineAt(head);
          handlers.current.onCursor(!!numberAt(line.text, head - line.from));
        }
        if (u.focusChanged) {
          // a short delay on blur: a tap on the extra keys must not make them flicker away
          window.clearTimeout(blurTimer.current);
          if (u.view.hasFocus) handlers.current.onFocus(true);
          else blurTimer.current = window.setTimeout(() => { if (!u.view.hasFocus) handlers.current.onFocus(false); }, 150);
        }
      }),
      // the extra-keys row covers the bottom of the editor on a phone: keep the cursor above it
      ...(touch ? [EditorView.scrollMargins.of(() => ({ bottom: 64 }))] : []),
      EditorView.theme({
        '&': { fontSize: '14px', height: '100%', backgroundColor: 'transparent' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, Menlo, Consolas, monospace' },
        '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
        '.cm-content, .cm-gutters': { textShadow: '0 0 3px #000, 0 0 2px #000' },
        '.cm-hydra-error': { backgroundColor: 'rgba(220, 40, 40, 0.45)' },
        '.cm-hydra-flash': { backgroundColor: 'rgba(255, 255, 255, 0.25)' },
        '.cm-hydra-hint': { padding: '2px 6px', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '12px' },
        '.cm-hydra-hint b': { color: '#ffd166' },
      }, { dark: true }),
      EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
    ];
    const v = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions }) });
    viewRef.current = v;
    return () => { window.clearTimeout(blurTimer.current); v.destroy(); viewRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = viewRef.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value, viewRef]);
  return <div className="ws-code ws-hydra-cm" ref={host} />;
}
