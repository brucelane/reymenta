// A track's Strudel patch in the Workshop (studies/reymenta-workshop.md step 4): CodeMirror editor, Play/Stop, the bar
// n/N, a scrub bar with the patch's sections, import/export, revert to the public original. Lazy-loaded with the
// engine (TrackScreen), so nothing of Strudel or CodeMirror loads before the section opens.
// A patch from a file or the catalogue is code: it runs only when the user presses Play (never on load or edit).
import { useEffect, useMemo, useRef, useState } from 'react';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { patchCycles, patchSections } from '../../../src/core/strudelLength';
import type { ClockAt } from '../TabView';
import { setPatch, type Library, type Track } from './library';
import { templatePatch, validatePatch } from './patch';
import { audioState, cycle, engineState, play, seek, stop, subscribe, update as updateCode, type EngineState } from './strudelEngine';
import { download } from './storage';
import type { WTexts } from './texts';

const SAVE_MS = 600;

/** The engine's state, as React state. */
export function useEngine(): EngineState {
  const [s, setS] = useState(engineState);
  useEffect(() => subscribe(setS), []);
  return s;
}

export default function StrudelSection({ t, folder, track, code, original, update, onClock }: {
  t: WTexts; folder: string; track: Track; code?: string; original?: string;
  update: (f: (l: Library) => Library) => void; onClock: (c: ClockAt | undefined) => void;
}) {
  const engine = useEngine();
  const mine = engine.playing && engine.owner === 'patch';
  const [text, setText] = useState(code ?? '');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [played, setPlayed] = useState(false);
  const [imported, setImported] = useState(false);
  const [bar, setBar] = useState(0);
  const [cue, setCue] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const total = useMemo(() => patchCycles(text), [text]);
  const sections = useMemo(() => patchSections(text), [text]);

  // edits saved a moment after typing stops (and when the section closes)
  const pending = useRef<string | undefined>(undefined);
  const flush = () => {
    const v = pending.current;
    if (v === undefined) return;
    pending.current = undefined;
    update((l) => setPatch(l, folder, v));
  };
  useEffect(() => {
    if (pending.current === undefined) return;
    const timer = window.setTimeout(flush, SAVE_MS);
    return () => window.clearTimeout(timer);
  });
  // leaving the track: save, stop what this section plays
  useEffect(() => () => { flush(); if (engineState().owner === 'patch') stop(); onClock(undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the patch changed outside the editor (revert, import, drums added): the editor follows
  useEffect(() => {
    if (code !== undefined && code !== text && pending.current === undefined) setText(code);
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (v: string) => { setText(v); pending.current = v; };

  // the bar counter while playing, and the clock the bass tab follows (each second and on every change)
  useEffect(() => {
    if (!mine) { setBar(0); onClock(undefined); return; }
    const clock = () => onClock({ msg: { t: 'clock', f: folder, p: 1, c: cycle(), s: engineState().cps }, at: performance.now() });
    clock();
    const a = window.setInterval(() => setBar(cycle()), 100);
    const b = window.setInterval(clock, 1000);
    return () => { window.clearInterval(a); window.clearInterval(b); };
  }, [mine, engine.cps, folder]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (f: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await f();
      setPlayed(true);
      if (audioState() === 'suspended') setMsg(t.audioBlocked);
      else setMsg('');
    } catch (e) {
      setError(t.evalError((e as Error)?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };
  // Play: from the cued bar; while playing: the edited code, the bar going on. Called in the click (audio resume).
  const onPlay = () => void run(() => (mine ? updateCode(text) : play(text, cue, 'patch')));
  const goTo = (b1: number) => {
    const to = Math.max(1, Math.min(total ?? 1, Math.round(b1))) - 1;
    setCue(to);
    if (mine) void run(() => seek(to));
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const v = validatePatch(await file.text());
    if (typeof v !== 'string') return setMsg(t.patchRefused(v.error));
    if (mine) stop();
    pending.current = undefined;
    setText(v);
    update((l) => setPatch(l, folder, v));
    setImported(true);
    setPlayed(false);
    setMsg(t.patchImported);
  };
  const replace = (v: string) => { pending.current = undefined; setText(v); update((l) => setPatch(l, folder, v)); };

  if (!text && code === undefined) {
    return (
      <div className="ws-strudel">
        <p className="ws-dim">{t.patchNone}</p>
        <div className="ws-actions">
          <button onClick={() => replace(templatePatch({ title: track.title, bpm: track.bpm, beatsPerBar: track.beatsPerBar, tonality: track.tonality, mode: track.mode }))}>{t.patchMake}</button>
          <ImportButton t={t} onFile={onImport} />
        </div>
        {msg && <p className="ws-msg">{msg}</p>}
      </div>
    );
  }

  const shown = drag ?? (mine ? Math.floor(bar) + 1 : cue + 1);
  const current = [...sections].reverse().find((s) => s.bar <= shown);
  const untrusted = !played && (imported || (original !== undefined && text === original));
  return (
    <div className="ws-strudel">
      <div className="ws-transport">
        <button onClick={onPlay} disabled={busy} className="ws-play">{mine ? t.playAgain : t.play}</button>
        <button onClick={() => stop()} disabled={!mine}>{t.stop}</button>
        <span className="ws-barcount">{t.bars(shown, total ? Math.ceil(total) : null)}</span>
      </div>
      {busy && <p className="ws-dim ws-small">{t.engineLoading}</p>}
      {untrusted && <p className="ws-dim ws-small">{t.patchNotRun}</p>}
      {total !== null && total > 1 && (
        <div className="ws-scrub">
          <input type="range" min={1} max={Math.ceil(total)} step={1} value={Math.min(Math.ceil(total), Math.max(1, shown))}
            onChange={(e) => setDrag(Number(e.target.value))}
            onPointerUp={() => { if (drag !== null) goTo(drag); setDrag(null); }}
            onKeyUp={() => { if (drag !== null) goTo(drag); setDrag(null); }} />
          {sections.length > 0 && (
            <div className="ws-seg">
              {sections.map((s) => (
                <button key={`${s.bar}-${s.name}`} className={s === current ? 'on' : ''} onClick={() => goTo(s.bar)}>{s.name}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="ws-error">{error}</p>}
      {engine.issues.length > 0 && <p className="ws-warn ws-small">{t.soundsMissing(engine.issues.join('; '))}</p>}
      {msg && <p className="ws-msg">{msg}</p>}
      <CodeEditor value={text} onChange={edit} onRun={onPlay} onStop={() => stop()} />
      <div className="ws-actions">
        <button onClick={() => download(`${folder}.strudel.js`, text, 'text/javascript')}>{t.download} {folder}.strudel.js</button>
        <ImportButton t={t} onFile={onImport} />
        {original !== undefined && text !== original && (
          <button onClick={() => { if (confirm(t.patchRevertConfirm)) { if (mine) stop(); replace(original); setPlayed(false); } }}>{t.patchRevert}</button>
        )}
      </div>
    </div>
  );
}

function ImportButton({ t, onFile }: { t: WTexts; onFile: (f: File | undefined) => void }) {
  return (
    <label className="ws-filebtn">
      {t.patchImport}
      <input type="file" accept=".js,.mjs,.txt,text/javascript,text/plain" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
    </label>
  );
}

/** CodeMirror 6 without the React wrapper: dark, phone-sized font, no line wrapping (scrolls sideways). */
function CodeEditor({ value, onChange, onRun, onStop }: { value: string; onChange: (v: string) => void; onRun: () => void; onStop: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onRun, onStop });
  handlers.current = { onChange, onRun, onStop };
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), closeBrackets(), highlightActiveLine(), javascript(), oneDark,
          keymap.of([
            { key: 'Mod-Enter', run: () => { handlers.current.onRun(); return true; } },
            { key: 'Mod-.', run: () => { handlers.current.onStop(); return true; } },
            ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab,
          ]),
          EditorView.updateListener.of((u) => { if (u.docChanged) handlers.current.onChange(u.state.doc.toString()); }),
          EditorView.theme({ '&': { fontSize: '14px', maxHeight: '55vh' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, Menlo, Consolas, monospace' } }),
          EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // a new text from outside (import, revert, drums added)
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);
  return <div className="ws-code" ref={host} />;
}
