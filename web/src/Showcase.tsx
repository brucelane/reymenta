// Join-screen showcase: an automatic carousel that replaces the static logo.
// Slide 1 is the logo; the others show the project. Each slide's media sits in web/public/showcase/:
//   <id>.mp4 (muted loop clip, preferably short and < 2 MB) and/or <id>.jpg (poster or still image).
// A slide plays its video if there is one, else shows its image, else a text card with its caption,
// so a missing file never breaks the carousel. To add a slide, add an entry to SLIDES and drop the files.
import { useEffect, useRef, useState } from 'react';
import type { Lang } from './i18n';

// fit 'contain' keeps a whole portrait image (a phone screenshot) inside the 16:9 frame instead of cropping it
interface Slide { id: string; caption: Record<Lang, string>; fit?: 'contain'; still?: boolean }

const SLIDES: Slide[] = [
  { id: 'logo', caption: { fr: 'Reymenta', en: 'Reymenta' } },
  // eyes + circles: scripts/showcase-clips.mjs (10 simulated phones)
  { id: 'eyes', caption: { fr: 'Un œil par téléphone, qui regarde où vous penchez', en: 'One eye per phone, looking where you tilt' } },
  { id: 'circles', caption: { fr: 'VJ participatif : votre cercle sur l’écran', en: 'Participative VJ: your circle on the screen' } },
  { id: 'phone', caption: { fr: 'Inclinez, secouez, touchez', en: 'Tilt, shake, touch' }, fit: 'contain', still: true },
  { id: 'vj', caption: { fr: 'Visuels en direct (Cinder)', en: 'Live visuals (Cinder)' } },
  // music + strudel: scripts/showcase-app-clips.mjs (the running app)
  { id: 'music', caption: { fr: 'Musique participative : jouez avec le groupe, sur le temps', en: 'Participative music: play with the band, in time' } },
  { id: 'ableton', caption: { fr: 'Ableton Meeting', en: 'Ableton Meeting' } },
  { id: 'strudel', caption: { fr: 'Strudel : codez la musique en direct', en: 'Strudel: live-code the music' } },
];

const IMAGE_MS = 4000; // how long an image or text slide stays up
const VIDEO_MAX_MS = 9000; // a long clip moves on after this, even before it ends
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Media = 'video' | 'image' | 'text';

export function Showcase({ lang }: { lang: Lang }) {
  const [index, setIndex] = useState(0);
  // what each slide can show, downgraded on load errors (video → image → text)
  const [media, setMedia] = useState<Record<string, Media>>(() =>
    Object.fromEntries(SLIDES.map((s) => [s.id, s.id === 'logo' || s.still || reducedMotion ? 'image' : 'video'])));
  const videoRef = useRef<HTMLVideoElement>(null);
  const slide = SLIDES[index];
  const kind = media[slide.id];
  const next = () => setIndex((i) => (i + 1) % SLIDES.length);
  const downgrade = (id: string, from: Media) =>
    setMedia((m) => (m[id] === from ? { ...m, [id]: from === 'video' ? 'image' : 'text' } : m));

  // auto-advance: a fixed time for images and text, end of clip (or a cap) for videos
  useEffect(() => {
    const timer = setTimeout(next, kind === 'video' ? VIDEO_MAX_MS : IMAGE_MS);
    return () => clearTimeout(timer);
  }, [index, kind]);

  // start the current clip from the beginning each time its slide comes back
  useEffect(() => {
    const v = videoRef.current;
    if (v && kind === 'video') { v.currentTime = 0; void v.play().catch(() => downgrade(slide.id, 'video')); }
  }, [index, kind]);

  const src = slide.id === 'logo' ? './logo.png' : `./showcase/${slide.id}.jpg`;
  // fullscreen (2026-11-22): the whole carousel, where the browser allows it on an element (not iPhones)
  const boxRef = useRef<HTMLDivElement>(null);
  const canFull = typeof document !== 'undefined' && document.fullscreenEnabled;
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void boxRef.current?.requestFullscreen().catch(() => {});
  };
  return (
    <div className="showcase" ref={boxRef} aria-roledescription="carousel" aria-label="Reymenta">
      {canFull && (
        <button className="showcase-full" onClick={toggleFull} aria-label={lang === 'fr' ? 'Plein écran' : 'Fullscreen'}
          title={lang === 'fr' ? 'Plein écran' : 'Fullscreen'}>⛶</button>
      )}
      <div className="showcase-frame" key={slide.id}>
        {kind === 'video' && (
          <video ref={videoRef} className="showcase-media" src={`./showcase/${slide.id}.mp4`} poster={`./showcase/${slide.id}.jpg`}
            muted playsInline autoPlay preload="auto" onEnded={next} onError={() => downgrade(slide.id, 'video')} />
        )}
        {kind === 'image' && (
          <img className={slide.id === 'logo' ? 'logo' : `showcase-media${slide.fit ? ' contain' : ''}`} src={src} alt={slide.caption[lang]}
            onError={() => downgrade(slide.id, 'image')} />
        )}
        {kind === 'text' && <div className="showcase-text">{slide.caption[lang]}</div>}
        {slide.id !== 'logo' && kind !== 'text' && <span className="showcase-caption">{slide.caption[lang]}</span>}
      </div>
      <div className="showcase-dots">
        {SLIDES.map((s, i) => (
          <button key={s.id} className={i === index ? 'on' : ''} aria-label={s.caption[lang]} aria-current={i === index}
            onClick={() => setIndex(i)} />
        ))}
      </div>
    </div>
  );
}
