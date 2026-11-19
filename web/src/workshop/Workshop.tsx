// The Workshop (studies/reymenta-workshop.md step 3): the app between shows, offline. The user's setlists, tracks and
// bass tabs (kept on the phone: storage.ts), the public catalogue (catalogue.ts), a fretboard, the artists.
// Lazy-loaded by App.tsx, so the Show page doesn't carry it.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { isNativeApp, savedServer } from '../connection';
import type { Lang } from '../i18n';
import { ArtistsScreen, AboutScreen } from './Artists';
import artistsJson from './artists.json';
import { librarySources, loadCatalogue, loadPublicPatch, loadPublicTab, toIndexTrack, toLibraryTrack, validateArtists, validateIndex, type Catalogue, type PublicTrack } from './catalogue';
import { FretboardScreen } from './Fretboard';
import {
  addSetlist, addSketch, addToSetlist, addTrack, conflicts, deleteSketch, updateSketch, deleteSetlist, detectImport, exportLibrary, exportSetlist, merge,
  moveInSetlist, removeFromSetlist, renameSetlist, setOriginal, setPatch, setTab, validateLibrary, type Detected, type Library, type MergeChoice, type Setlist,
} from './library';
import { starterSketch, validateHydra } from './hydra';
import { download, loadLibrary, loadText, saveLibrary, saveText } from './storage';
import { wtexts, type WTexts } from './texts';
import { TrackScreen } from './TrackScreen';
import './workshop.css';

// hydra-synth and its editor: only when a sketch opens (step 5)
const HydraSection = lazy(() => import('./HydraSection'));
// strudel-flow and pasted grooves (step 6)
const GroovesScreen = lazy(() => import('./GroovesScreen'));

type Screen =
  | { s: 'home' } | { s: 'setlists' } | { s: 'setlist'; name: string; pub?: boolean } | { s: 'tracks' }
  | { s: 'track'; folder: string } | { s: 'fretboard'; folder?: string } | { s: 'artists' } | { s: 'about' } | { s: 'data' }
  | { s: 'sketches' } | { s: 'sketch'; id: string } | { s: 'grooves' };

const LAN_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const bundled = validateArtists(artistsJson);

export default function Workshop({ lang, langSwitch, onShow }: { lang: Lang; langSwitch: React.ReactNode; onShow: () => void }) {
  const t = wtexts(lang);
  const [lib, setLib] = useState<Library | undefined>();
  const [saveFailed, setSaveFailed] = useState(false);
  const [cat, setCat] = useState<Catalogue | undefined>();
  const [catDone, setCatDone] = useState(false);
  const [stack, setStack] = useState<Screen[]>([{ s: 'home' }]);
  const screen = stack[stack.length - 1];
  const go = (s: Screen) => { setStack((st) => [...st, s]); window.scrollTo(0, 0); };
  const back = () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));

  // the library: loaded once, saved a moment after each change
  useEffect(() => { void loadLibrary().then(setLib); }, []);
  const first = useRef(true);
  useEffect(() => {
    if (!lib) return;
    if (first.current) { first.current = false; return; }
    const timer = window.setTimeout(() => { void saveLibrary(lib).then((ok) => setSaveFailed(!ok)); }, 400);
    return () => window.clearTimeout(timer);
  }, [lib]);

  // the public catalogue: the last one seen first (offline), then the network
  useEffect(() => {
    let alive = true;
    void loadText('catalogue').then((text) => {
      if (!alive || !text) return;
      try {
        const c = JSON.parse(text) as { base?: unknown; index?: unknown };
        const v = validateIndex(c.index, typeof c.base === 'string' ? c.base : '');
        if (v) setCat((cur) => cur ?? v);
      } catch { /* ignore */ }
    });
    const sources = librarySources({ nativeServer: isNativeApp ? savedServer() : '', pageIsLan: !isNativeApp && LAN_HOST.test(location.hostname) });
    void (async () => {
      for (const base of sources) {
        const c = await loadCatalogue([base]);
        if (!c || !alive) continue;
        setCat(c);
        // keep the raw-but-validated index for offline (rebuilt the same way on load)
        void saveText('catalogue', JSON.stringify({ base: c.base, index: { app: 'videodromm-library', version: 1, artists: c.artists, about: c.about, setlists: c.setlists, tracks: c.tracks.map(toIndexTrack) } }));
        break;
      }
      if (alive) setCatDone(true);
    })();
    return () => { alive = false; };
  }, []);

  const update = (f: (l: Library) => Library) => setLib((l) => (l ? f(l) : l));

  /** A public track: into my library (with its tab and patch: the patch isn't run) the first time, then opened. */
  const openPublic = async (p: PublicTrack) => {
    if (!lib) return;
    if (!lib.tracks.some((x) => x.folder === p.folder)) {
      const [tab, patch] = cat ? await Promise.all([loadPublicTab(cat, p), loadPublicPatch(cat, p)]) : [undefined, undefined];
      update((l) => {
        if (l.tracks.some((x) => x.folder === p.folder)) return l;
        let next = { ...l, tracks: [...l.tracks, toLibraryTrack(p, tab)] };
        if (tab) next = setTab(next, p.folder, tab);
        if (patch) next = setOriginal(setPatch(next, p.folder, patch), p.folder, patch);
        return next;
      });
    }
    go({ s: 'track', folder: p.folder });
  };

  /** A folder in a setlist: mine, else the catalogue's, else a new track named after the entry. */
  const openFolder = (folder: string, title: string) => {
    if (!lib) return;
    if (lib.tracks.some((x) => x.folder === folder)) return go({ s: 'track', folder });
    const p = cat?.tracks.find((x) => x.folder === folder);
    if (p) return void openPublic(p);
    const r = addTrack(lib, title);
    // keep the setlist's folder name, so the entry finds it
    const track = { ...r.track, id: folder, folder, tabFile: `${folder}.tab.json` };
    const tabs = { ...r.library.tabs, [folder]: r.library.tabs[r.track.folder] };
    delete tabs[r.track.folder];
    setLib({ ...r.library, tracks: [...lib.tracks, track], tabs });
    go({ s: 'track', folder });
  };

  const header = (
    <header className="ws-head">
      {stack.length > 1 ? <button onClick={back} aria-label={t.back}>‹</button> : <span className="ws-brand">{t.title}</span>}
      <span className="ws-head-title">{stack.length > 1 ? screenTitle(screen, t, lib) : ''}</span>
      <button onClick={onShow}>{t.show}</button>
      {langSwitch}
    </header>
  );

  if (!lib) return <main className="ws">{header}<p className="ws-dim">{t.loading}</p></main>;

  let body: React.ReactNode;
  switch (screen.s) {
    case 'home':
      body = (
        <nav className="ws-menu">
          <button onClick={() => go({ s: 'setlists' })}>{t.setlists}</button>
          <button onClick={() => go({ s: 'tracks' })}>{t.tracks}</button>
          <button onClick={() => go({ s: 'fretboard' })}>{t.fretboard}</button>
          <button onClick={() => go({ s: 'sketches' })}>{t.sketches}</button>
          <button onClick={() => go({ s: 'grooves' })}>{t.grooves}</button>
          <button onClick={() => go({ s: 'artists' })}>{t.artists}</button>
          <button onClick={() => go({ s: 'about' })}>{t.about}</button>
          <button onClick={() => go({ s: 'data' })}>{t.data}</button>
          <p className="ws-dim">{t.counts(lib.setlists.length, lib.tracks.length, Object.keys(lib.tabs).length)}</p>
          <p className="ws-dim">{cat ? t.publicFrom(cat.base.replace(/^https?:\/\//, '')) : catDone ? t.offline : t.loading}</p>
        </nav>
      );
      break;
    case 'setlists':
      body = <SetlistsScreen t={t} lib={lib} cat={cat} update={update} open={(name, pub) => go({ s: 'setlist', name, pub })} />;
      break;
    case 'setlist': {
      const s = screen.pub ? cat?.setlists.find((x) => x.name === screen.name) : lib.setlists.find((x) => x.name === screen.name);
      body = s ? (
        <SetlistScreen t={t} lib={lib} cat={cat} setlist={s} pub={!!screen.pub} update={update} openFolder={openFolder}
          copy={() => { const r = merge(lib, { setlists: [s] }, 'keep'); setLib(r.library); back(); }}
          remove={() => { if (confirm(t.confirmDelete(s.title))) { update((l) => deleteSetlist(l, s.name)); back(); } }} />
      ) : <p className="ws-dim">{t.empty}</p>;
      break;
    }
    case 'tracks':
      body = <TracksScreen t={t} lib={lib} cat={cat} openMine={(folder) => go({ s: 'track', folder })} openPublic={openPublic}
        create={(title) => { const r = addTrack(lib, title); setLib(r.library); go({ s: 'track', folder: r.track.folder }); }} />;
      break;
    case 'track':
      body = <TrackScreen t={t} lang={lang} lib={lib} folder={screen.folder} cat={cat} setLib={setLib} update={update}
        fretboard={() => go({ s: 'fretboard', folder: screen.folder })} deleted={back} />;
      break;
    case 'fretboard':
      body = <FretboardScreen t={t} lang={lang} track={screen.folder ? lib.tracks.find((x) => x.folder === screen.folder) : undefined} />;
      break;
    case 'artists':
      body = <ArtistsScreen t={t} lang={lang} artists={cat?.artists.length ? cat.artists : bundled.artists} base={cat?.artists.length ? cat.base : ''} />;
      break;
    case 'about':
      body = <AboutScreen t={t} lang={lang} about={cat?.about ?? bundled.about} base={cat?.about ? cat.base : ''} />;
      break;
    case 'data':
      body = <DataScreen t={t} lib={lib} setLib={setLib} />;
      break;
    case 'grooves':
      body = (
        <Suspense fallback={<p className="ws-dim">{t.loading}</p>}>
          <GroovesScreen t={t} lib={lib} setLib={setLib} openTrack={(folder) => go({ s: 'track', folder })} />
        </Suspense>
      );
      break;
    case 'sketches':
      body = <SketchesScreen t={t} lib={lib} update={update} open={(id) => go({ s: 'sketch', id })} />;
      break;
    case 'sketch': {
      const k = lib.sketches.find((x) => x.id === screen.id);
      body = k ? (
        <section className="ws-track">
          <div className="ws-form">
            <label>{t.titlePh}<input value={k.title} maxLength={120} onChange={(e) => update((l) => updateSketch(l, k.id, { title: e.target.value }))} /></label>
          </div>
          <Suspense fallback={<p className="ws-dim">{t.loading}</p>}>
            <HydraSection key={k.id} t={t} name={k.id} title={k.title} code={k.code} save={(c) => update((l) => updateSketch(l, k.id, { code: c }))} />
          </Suspense>
          <div className="ws-actions">
            <button className="ws-danger" onClick={() => { if (confirm(t.confirmDelete(k.title))) { update((l) => deleteSketch(l, k.id)); back(); } }}>{t.delete}</button>
          </div>
        </section>
      ) : <p className="ws-dim">{t.empty}</p>;
      break;
    }
  }

  return (
    <main className="ws">
      {header}
      {saveFailed && <p className="warn">{t.storageFail}</p>}
      {body}
    </main>
  );
}

function screenTitle(s: Screen, t: WTexts, lib?: Library): string {
  switch (s.s) {
    case 'setlists': return t.setlists;
    case 'setlist': return s.name;
    case 'tracks': return t.tracks;
    case 'track': return lib?.tracks.find((x) => x.folder === s.folder)?.title ?? s.folder;
    case 'fretboard': return t.fretboard;
    case 'artists': return t.artists;
    case 'about': return t.about;
    case 'data': return t.data;
    case 'sketches': return t.sketches;
    case 'grooves': return t.grooves;
    case 'sketch': return lib?.sketches.find((x) => x.id === s.id)?.title ?? s.id;
    default: return '';
  }
}

/** A one-line text field with a button (new setlist, new track, rename). */
function AddField({ placeholder, label, onAdd, initial = '' }: { placeholder: string; label: string; onAdd: (v: string) => void; initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <form className="ws-add" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(''); } }}>
      <input value={v} placeholder={placeholder} maxLength={120} onChange={(e) => setV(e.target.value)} />
      <button type="submit" disabled={!v.trim()}>{label}</button>
    </form>
  );
}

function SetlistsScreen({ t, lib, cat, update, open }: {
  t: WTexts; lib: Library; cat?: Catalogue; update: (f: (l: Library) => Library) => void; open: (name: string, pub?: boolean) => void;
}) {
  return (
    <section className="ws-list">
      <h2>{t.mine}</h2>
      {lib.setlists.length ? lib.setlists.map((s) => (
        <button key={s.name} className="ws-row" onClick={() => open(s.name)}>
          <span>{s.title}</span><span className="ws-dim">{s.tracks.length}</span>
        </button>
      )) : <p className="ws-dim">{t.empty}</p>}
      <AddField placeholder={t.titlePh} label={t.newSetlist} onAdd={(title) => {
        const r = addSetlist(lib, title);
        update(() => r.library);
        open(r.name);
      }} />
      {!!cat?.setlists.length && <>
        <h2>{t.publicTracks}</h2>
        {cat.setlists.map((s) => (
          <button key={s.name} className="ws-row" onClick={() => open(s.name, true)}>
            <span>{s.title} <span className="ws-badge">{t.public}</span></span><span className="ws-dim">{s.tracks.length}</span>
          </button>
        ))}
      </>}
    </section>
  );
}

function SetlistScreen({ t, lib, cat, setlist, pub, update, openFolder, copy, remove }: {
  t: WTexts; lib: Library; cat?: Catalogue; setlist: Setlist; pub: boolean; update: (f: (l: Library) => Library) => void;
  openFolder: (folder: string, title: string) => void; copy: () => void; remove: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const known = (folder: string) => lib.tracks.some((x) => x.folder === folder) || !!cat?.tracks.some((x) => x.folder === folder);
  const add = (title: string, folder: string) => { update((l) => addToSetlist(l, setlist.name, { title, folder })); setAdding(false); };
  return (
    <section className="ws-list">
      <h2>{setlist.title}{pub && <span className="ws-badge">{t.public}</span>}</h2>
      {setlist.tracks.length ? setlist.tracks.map((r, i) => (
        <div key={`${i}-${r.folder}`} className="ws-entry">
          <button className="ws-row" onClick={() => openFolder(r.folder, r.title)}>
            <span>{i + 1}. {r.title}</span>{!known(r.folder) && <span className="ws-dim ws-small">{t.missing}</span>}
          </button>
          {!pub && <span className="ws-tools">
            <button onClick={() => update((l) => moveInSetlist(l, setlist.name, i, -1))} disabled={i === 0} aria-label={t.up}>↑</button>
            <button onClick={() => update((l) => moveInSetlist(l, setlist.name, i, 1))} disabled={i === setlist.tracks.length - 1} aria-label={t.down}>↓</button>
            <button onClick={() => update((l) => removeFromSetlist(l, setlist.name, i))} aria-label={t.remove}>✕</button>
          </span>}
        </div>
      )) : <p className="ws-dim">{t.noTracks}</p>}
      {pub ? <button onClick={copy}>{t.copyToMine}</button> : <>
        {adding ? (
          <div className="ws-picker">
            <h3>{t.fromLibrary}</h3>
            {lib.tracks.length ? lib.tracks.map((x) => <button key={x.folder} className="ws-row" onClick={() => add(x.title, x.folder)}>{x.title}</button>) : <p className="ws-dim">{t.empty}</p>}
            {!!cat?.tracks.length && <>
              <h3>{t.fromPublic}</h3>
              {cat.tracks.filter((x) => !lib.tracks.some((m) => m.folder === x.folder)).map((x) => (
                <button key={x.folder} className="ws-row" onClick={() => add(x.title, x.folder)}>{x.title} <span className="ws-badge">{t.public}</span></button>
              ))}
            </>}
            <h3>{t.orNew}</h3>
            <AddField placeholder={t.titlePh} label={t.add} onAdd={(title) => {
              const r = addTrack(lib, title);
              update(() => addToSetlist(r.library, setlist.name, { title, folder: r.track.folder }));
              setAdding(false);
            }} />
            <button onClick={() => setAdding(false)}>{t.cancel}</button>
          </div>
        ) : <button onClick={() => setAdding(true)}>{t.addTrack}</button>}
        <div className="ws-actions">
          {renaming
            ? <AddField placeholder={t.titlePh} label={t.ok} initial={setlist.title} onAdd={(v) => { update((l) => renameSetlist(l, setlist.name, v)); setRenaming(false); }} />
            : <button onClick={() => setRenaming(true)}>{t.rename}</button>}
          <button onClick={() => download(`${setlist.name}.json`, exportSetlist(lib, setlist.name) ?? '')}>{t.download}</button>
          <button className="ws-danger" onClick={remove}>{t.delete}</button>
        </div>
      </>}
    </section>
  );
}

function TracksScreen({ t, lib, cat, openMine, openPublic, create }: {
  t: WTexts; lib: Library; cat?: Catalogue; openMine: (folder: string) => void; openPublic: (p: PublicTrack) => void; create: (title: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const match = (title: string) => title.toLowerCase().includes(filter.toLowerCase());
  const pub = useMemo(() => (cat?.tracks ?? []).filter((x) => !lib.tracks.some((m) => m.folder === x.folder)), [cat, lib.tracks]);
  return (
    <section className="ws-list">
      <AddField placeholder={t.titlePh} label={t.newTrack} onAdd={create} />
      {(lib.tracks.length > 8 || pub.length > 8) && <input className="ws-filter" value={filter} placeholder="…" onChange={(e) => setFilter(e.target.value)} />}
      <h2>{t.myTracks}</h2>
      {lib.tracks.length ? lib.tracks.filter((x) => match(x.title)).map((x) => (
        <button key={x.folder} className="ws-row" onClick={() => openMine(x.folder)}>
          <span>{x.title}</span><span className="ws-dim">{lib.tabs[x.folder] ? '𝄞' : ''} {x.bpm ?? ''}</span>
        </button>
      )) : <p className="ws-dim">{t.empty}</p>}
      {!!pub.length && <>
        <h2>{t.publicTracks}</h2>
        {pub.filter((x) => match(x.title)).map((x) => (
          <button key={x.folder} className="ws-row" onClick={() => openPublic(x)}>
            <span>{x.title} <span className="ws-badge">{t.public}</span></span><span className="ws-dim">{x.artist ?? ''}</span>
          </button>
        ))}
      </>}
    </section>
  );
}

/** Free Hydra sketches (not tied to a track): list, new (from the template), import a .hydra.js (not run). */
function SketchesScreen({ t, lib, update, open }: { t: WTexts; lib: Library; update: (f: (l: Library) => Library) => void; open: (id: string) => void }) {
  const [msg, setMsg] = useState('');
  const create = (title: string, code: string) => {
    const r = addSketch(lib, title, code);
    update(() => r.library);
    open(r.sketch.id);
  };
  const onFile = async (file: File | undefined) => {
    setMsg('');
    if (!file) return;
    const v = validateHydra(await file.text());
    if (typeof v !== 'string') return setMsg(t.patchRefused(v.error));
    create(file.name.replace(/\.(hydra\.)?(m?js|txt)$/i, '') || 'Sketch', v);
  };
  return (
    <section className="ws-list">
      <AddField placeholder={t.titlePh} label={t.newSketch} onAdd={(title) => create(title, starterSketch({ title }))} />
      {lib.sketches.length ? lib.sketches.map((k) => (
        <button key={k.id} className="ws-row" onClick={() => open(k.id)}><span>{k.title}</span><span className="ws-dim ws-small">{k.updatedAt?.slice(0, 10) ?? ''}</span></button>
      )) : <p className="ws-dim">{t.empty}</p>}
      <label className="ws-file">
        {t.hydraImport}
        <input type="file" accept=".js,.mjs,.txt,text/javascript,text/plain" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {msg && <p className="ws-msg">{msg}</p>}
    </section>
  );
}

function DataScreen({ t, lib, setLib }: { t: WTexts; lib: Library; setLib: (l: Library) => void }) {
  const [msg, setMsg] = useState('');
  const [pending, setPending] = useState<{ incoming: Partial<Library>; names: string[]; skipped: number } | undefined>();
  const [tabFor, setTabFor] = useState<Extract<Detected, { kind: 'tab' }> | undefined>();
  const apply = (incoming: Partial<Library>, choice: MergeChoice, skipped = 0) => {
    const r = merge(lib, incoming, choice);
    setLib(r.library);
    setMsg(t.imported(r.added, r.replaced, r.renamed) + (skipped ? ` ${t.importSkipped(skipped)}` : ''));
    setPending(undefined);
  };
  const offer = (incoming: Partial<Library>, skipped = 0) => {
    const c = conflicts(lib, incoming);
    const names = [...c.tracks, ...c.setlists, ...c.sketches];
    if (names.length) setPending({ incoming, names, skipped });
    else apply(incoming, 'keep', skipped);
  };
  const onFile = async (file: File | undefined) => {
    setMsg('');
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) return setMsg(t.importError('> 32 MB'));
    const d = detectImport(await file.text());
    if (d.kind === 'unknown') return setMsg(t.importError(d.error));
    if (d.kind === 'library') return offer(d.library, d.skipped);
    if (d.kind === 'track') return offer({ tracks: [d.track] });
    if (d.kind === 'setlist') return offer({ setlists: [d.setlist] });
    setTabFor(d);
  };
  const attachTab = (folder: string | undefined) => {
    if (!tabFor) return;
    if (folder) setLib(setTab(lib, folder, tabFor.tab));
    else {
      const title = tabFor.tab.source.replace(/\.(tab\.json|strudel\.js|als|workshop)$/i, '') || 'Track';
      const r = addTrack(lib, title, { bpm: tabFor.tab.song.tempo, tuning: tabFor.tab.tuning, beatsPerBar: tabFor.tab.song.cycleBeats });
      setLib(setTab(r.library, r.track.folder, tabFor.tab));
    }
    setTabFor(undefined);
    setMsg(t.imported(1, 0, 0));
  };
  // a library file exported here reads back as one (checked by validateLibrary)
  const exportAll = () => { const text = exportLibrary(lib); if (typeof validateLibrary(JSON.parse(text)) !== 'string') download(`videodromm-library-${new Date().toISOString().slice(0, 10)}.json`, text); };
  return (
    <section className="ws-list">
      <p className="ws-dim">{t.counts(lib.setlists.length, lib.tracks.length, Object.keys(lib.tabs).length)}</p>
      <button onClick={exportAll}>{t.exportAll}</button>
      {isNativeApp && <p className="ws-dim ws-small">{t.downloadNote}</p>}
      <label className="ws-file">
        {t.importFile}
        <input type="file" accept=".json,application/json" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      <p className="ws-dim ws-small">{t.importHelp}</p>
      {pending && (
        <div className="ws-picker">
          <p>{t.conflict(pending.names.join(', '))}</p>
          <div className="ws-actions">
            <button onClick={() => apply(pending.incoming, 'replace', pending.skipped)}>{t.replace}</button>
            <button onClick={() => apply(pending.incoming, 'keep', pending.skipped)}>{t.keepBoth}</button>
            <button onClick={() => setPending(undefined)}>{t.cancel}</button>
          </div>
        </div>
      )}
      {tabFor && (
        <div className="ws-picker">
          <p>{t.tabFor}</p>
          <button className="ws-row" onClick={() => attachTab(undefined)}>{t.tabNewTrack}</button>
          {lib.tracks.map((x) => <button key={x.folder} className="ws-row" onClick={() => attachTab(x.folder)}>{x.title}{lib.tabs[x.folder] ? ' (𝄞)' : ''}</button>)}
          <button onClick={() => setTabFor(undefined)}>{t.cancel}</button>
        </div>
      )}
      {msg && <p className="ws-msg">{msg}</p>}
    </section>
  );
}
