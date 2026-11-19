// Grooves (studies/reymenta-workshop.md step 6): strudel-flow (the user's fork, app.videodromm.com by default, address
// changeable) in an iframe when online, and its generated code brought back into a track's patch (grooves.ts).
// Lazy-loaded by Workshop.tsx; Strudel loads only when the groove is played.
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_FLOW_URL, flowPatchInfo, grooveAsPatch, grooveExpression, parseGroove, validFlowUrl } from './grooves';
import { addTrack, setPatch, type Library } from './library';
import { addToPatch } from './patch';
import type { WTexts } from './texts';

const URL_KEY = 'reymenta:flowUrl';
const readUrl = () => { try { return validFlowUrl(localStorage.getItem(URL_KEY) ?? '') ?? DEFAULT_FLOW_URL; } catch { return DEFAULT_FLOW_URL; } };
const writeUrl = (u: string) => { try { if (u === DEFAULT_FLOW_URL) localStorage.removeItem(URL_KEY); else localStorage.setItem(URL_KEY, u); } catch { /* private mode */ } };

export default function GroovesScreen({ t, lib, setLib, openTrack }: {
  t: WTexts; lib: Library; setLib: (l: Library) => void; openTrack: (folder: string) => void;
}) {
  const [url, setUrl] = useState(readUrl);
  const [draftUrl, setDraftUrl] = useState(url);
  const [frame, setFrame] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [playing, setPlaying] = useState(false);
  const groove = useMemo(() => (code.trim() ? parseGroove(code) : undefined), [code]);
  const ok = groove && !('error' in groove) ? groove : undefined;

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  // leaving: stop the preview
  useEffect(() => () => { void import('./strudelEngine').then((e) => { if (e.engineState().owner === 'groove') e.stop(); }); }, []);

  const saveUrl = () => {
    const v = validFlowUrl(draftUrl);
    if (!v) return setMsg(t.flowUrlBad);
    setMsg('');
    setUrl(v);
    writeUrl(v);
  };
  const onFile = async (file: File | undefined) => {
    setMsg('');
    if (!file) return;
    if (file.size > 256 * 1024) return setMsg(t.grooveError('> 256 KB'));
    const text = await file.text();
    const info = flowPatchInfo(text);
    if (info) return setMsg(t.grooveJson(info.name, info.nodes, info.cpm));
    setCode(text.replace(/\r\n/g, '\n'));
  };
  const play = async () => {
    if (!ok) return;
    const e = await import('./strudelEngine');
    if (playing) { e.stop(); setPlaying(false); return; }
    try {
      await e.play(grooveAsPatch(ok, 'groove'), 0, 'groove');
      setPlaying(true);
      const off = e.subscribe((s) => { if (!s.playing || s.owner !== 'groove') { setPlaying(false); off(); } });
    } catch (err) {
      setMsg(t.evalError((err as Error)?.message ?? String(err)));
    }
  };
  const addTo = (folder: string, title: string) => {
    if (!ok) return;
    const patch = lib.patches[folder];
    const next = patch ? addToPatch(patch, grooveExpression(ok), 'groove') : grooveAsPatch(ok, title);
    if (!next) return setMsg(t.copyFailed);
    setLib(setPatch(lib, folder, next));
    setMsg(t.grooveAdded(title));
  };
  const newTrack = () => {
    if (!ok) return;
    const title = `Groove ${new Date().toISOString().slice(0, 10)}`;
    const bpm = Number(ok.cpm?.split('/')[0]);
    const r = addTrack(lib, title, bpm > 0 && bpm < 1000 ? { bpm } : {});
    setLib(setPatch(r.library, r.track.folder, grooveAsPatch(ok, title)));
    openTrack(r.track.folder);
  };

  return (
    <section className="ws-list ws-grooves">
      <p className="ws-dim">{t.groovesIntro}</p>
      {online ? (
        <div className="ws-actions">
          <button onClick={() => setFrame((f) => !f)}>{frame ? t.flowClose : t.flowOpen}</button>
          <a className="ws-filebtn" href={url} target="_blank" rel="noopener noreferrer">{t.flowNewTab}</a>
        </div>
      ) : <p className="ws-warn ws-small">{t.flowOffline}</p>}
      {frame && online && (
        <iframe className="ws-flow" src={url} title="strudel-flow" allow="autoplay; clipboard-read; clipboard-write; fullscreen"
          referrerPolicy="no-referrer" />
      )}
      <details>
        <summary className="ws-small">{t.flowUrl}</summary>
        <form className="ws-add" onSubmit={(e) => { e.preventDefault(); saveUrl(); }}>
          <input value={draftUrl} inputMode="url" maxLength={500} onChange={(e) => setDraftUrl(e.target.value)} />
          <button type="submit">{t.ok}</button>
          <button type="button" onClick={() => { setDraftUrl(DEFAULT_FLOW_URL); setUrl(DEFAULT_FLOW_URL); writeUrl(DEFAULT_FLOW_URL); }}>{t.flowReset}</button>
        </form>
      </details>

      <label className="ws-small">{t.groovePaste}
        <textarea className="ws-groove-code" value={code} rows={8} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          onChange={(e) => { setCode(e.target.value); setMsg(''); }} />
      </label>
      <label className="ws-file">
        {t.grooveFile}
        <input type="file" accept=".js,.mjs,.txt,.json,text/javascript,text/plain,application/json" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {groove && 'error' in groove && <p className="ws-error">{t.grooveError(groove.error)}</p>}
      {ok && <>
        <p className="ws-dim ws-small">{t.grooveParsed(ok.parts.length, ok.cpm ?? '')}</p>
        <div className="ws-actions">
          <button onClick={() => void play()}>{playing ? t.stop : t.play}</button>
          <button onClick={newTrack}>{t.grooveNewTrack}</button>
        </div>
        <h3>{t.grooveTo}</h3>
        {lib.tracks.length ? lib.tracks.map((x) => (
          <button key={x.folder} className="ws-row" onClick={() => addTo(x.folder, x.title)}>
            <span>{x.title}</span><span className="ws-dim ws-small">{lib.patches[x.folder] ? '{ }' : ''}</span>
          </button>
        )) : <p className="ws-dim">{t.empty}</p>}
        <p className="ws-dim ws-small">{t.grooveTempo}</p>
      </>}
      {msg && <p className="ws-msg">{msg}</p>}
    </section>
  );
}
