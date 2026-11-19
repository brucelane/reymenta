// Artists and About, from the public library's index (else the bundled artists.json): logo, tagline, bio in the
// page's language, members, platform links as buttons.
import type { Lang } from '../i18n';
import type { About, Artist } from './catalogue';
import type { WTexts } from './texts';

const Links = ({ links }: { links: { platform: string; url: string }[] }) => (
  <div className="ws-links">
    {links.map((l) => <a key={l.url} className="ws-linkbtn" href={l.url} target="_blank" rel="noreferrer noopener">{l.platform}</a>)}
  </div>
);

// a logo only from the library's own folder (validated path); the bundled copy has no folder to load it from
const Logo = ({ base, path, alt }: { base: string; path?: string; alt: string }) =>
  base && path ? <img className="ws-logo" src={`${base}${path}`} alt={alt} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null;

export function ArtistsScreen({ t, lang, artists, base }: { t: WTexts; lang: Lang; artists: Artist[]; base: string }) {
  if (!artists.length) return <p className="ws-dim">{t.empty}</p>;
  return (
    <section className="ws-list">
      {artists.map((a) => (
        <article key={a.id} className="ws-artist">
          <Logo base={base} path={a.logo} alt={a.name} />
          <h2>{a.name}</h2>
          {a.tagline[lang] && <p className="ws-tagline">{a.tagline[lang]}</p>}
          {a.bio[lang] && <p className="ws-bio">{a.bio[lang]}</p>}
          {a.members.length > 0 && <>
            <h3>{t.members}</h3>
            <ul>{a.members.map((m) => <li key={m.name}><b>{m.name}</b>{m.role[lang] ? ` · ${m.role[lang]}` : ''}</li>)}</ul>
          </>}
          {a.links.length > 0 && <><h3>{t.listen}</h3><Links links={a.links} /></>}
        </article>
      ))}
    </section>
  );
}

export function AboutScreen({ t, lang, about, base }: { t: WTexts; lang: Lang; about?: About; base: string }) {
  return (
    <section className="ws-list">
      {about ? (
        <article className="ws-artist">
          <Logo base={base} path={about.logo} alt={about.title} />
          <h2>{about.title}</h2>
          {about.text[lang] && <p className="ws-bio">{about.text[lang]}</p>}
          {about.links.length > 0 && <Links links={about.links} />}
        </article>
      ) : <p className="ws-dim">{t.empty}</p>}
      <p className="ws-dim ws-small">Reymenta v{__APP_VERSION__} · AGPL-3.0</p>
    </section>
  );
}
