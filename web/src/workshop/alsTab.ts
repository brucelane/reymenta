// An Ableton Live set as a bass tab (2026-11-20): any set, not only those with a "tabbass" track. The set's MIDI
// tracks are listed (name, notes, average key) so the user picks the bass; that track is renamed "tabbass" in the XML
// text and the set read by src/core/alsImport.ts's parseAls (a copy of the WebApp's, never edited here), which keeps
// the tracks named "tab…": the notes of its arrangement clips, the tempo, the locators (sections). Pure string work
// except parseAls (DOMParser: the browser, or @xmldom/xmldom in the tests).
import { parseAls } from '../../../src/core/alsImport';
import { gunzipText } from './alsWrite';
import { refresh, type WTab } from './tabEdit';

export interface AlsMidiTrack { index: number; name: string; notes: number; avgKey: number }

const TRACK = /<MidiTrack[\s>][\s\S]*?<\/MidiTrack>/g;
const nameOf = (track: string) => /<EffectiveName Value="([^"]*)"/.exec(track)?.[1] ?? '';
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The set's MIDI tracks with their arrangement notes (disabled notes too: a rough count to choose from). */
export function alsMidiTracks(xml: string): AlsMidiTrack[] {
  return [...xml.matchAll(TRACK)].map((m, index) => {
    const t = m[0];
    const seq = t.indexOf('<MainSequencer>');
    const arr = seq >= 0 ? t.indexOf('<ArrangerAutomation>', seq) : -1;
    const end = arr >= 0 ? t.indexOf('</ArrangerAutomation>', arr) : -1;
    const body = arr >= 0 && end > arr ? t.slice(arr, end) : '';
    let notes = 0, keys = 0;
    for (const kt of body.matchAll(/<KeyTrack [^>]*>([\s\S]*?)<\/KeyTrack>/g)) {
      const key = Number(/<MidiKey Value="(\d+)"/.exec(kt[1])?.[1] ?? NaN);
      const count = (kt[1].match(/<MidiNoteEvent /g) ?? []).length;
      if (!Number.isFinite(key)) continue;
      notes += count;
      keys += key * count;
    }
    return { index, name: unesc(nameOf(t)), notes, avgKey: notes ? keys / notes : 0 };
  });
}

/** The likely bass: a "tabbass" track, else a name with "bass"/"basse"/"bs", else the lowest track with notes. */
export function guessBass(tracks: AlsMidiTrack[]): number | undefined {
  const withNotes = tracks.filter((t) => t.notes > 0);
  if (!withNotes.length) return undefined;
  const byName = (re: RegExp) => withNotes.find((t) => re.test(t.name));
  return (byName(/tabbass/i) ?? byName(/bass|basse|\bbs\b/i) ?? [...withNotes].sort((a, b) => a.avgKey - b.avgKey)[0]).index;
}

/** The XML with track `index` named "tabbass" and every other "tab…" track renamed (so only the choice is read). */
export function markBass(xml: string, index: number): string {
  let i = 0;
  return xml.replace(TRACK, (t) => {
    const mine = i++ === index;
    const rename = (v: string) => (mine ? 'tabbass' : v.replace(/tab/gi, 't-b'));
    return t
      .replace(/(<EffectiveName Value=")([^"]*)(")/, (_m, a, v, b) => `${a}${rename(v)}${b}`)
      .replace(/(<UserName Value=")([^"]*)(")/, (_m, a, v, b) => `${a}${mine ? 'tabbass' : v.replace(/tab/gi, 't-b')}${b}`);
  });
}

/** The chosen track as a Workshop tab (EADG; frets worked out by fretBass, out-of-range notes moved by octaves). */
export async function alsToTab(xml: string, index: number, source: string, beatsPerBar = 4): Promise<WTab> {
  const marked = markBass(xml, index);
  const song = await parseAls(new TextEncoder().encode(marked).buffer as ArrayBuffer, source);
  const notes = song.tracks.tabbass ?? [];
  if (!notes.length) throw new Error('no notes in that track’s arrangement clips');
  return refresh({
    version: 1, source, tuning: 'EADG', overrides: {},
    song: { ...song, tracks: { tabbass: notes }, cycleBeats: beatsPerBar },
    tab: [],
  });
}

/** An .als file's text (gzipped or not). */
export const alsText = (bytes: Uint8Array) => gunzipText(bytes);
