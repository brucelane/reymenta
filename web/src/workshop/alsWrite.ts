// A Workshop track as an Ableton Live set, written in the browser (studies/reymenta-workshop.md step 6). A port of
// TSWebsocketServer's server/services/alsExport.ts (writeStrudelSet) without fs or zlib: it edits the XML text of the
// template assets/als/empty Project/empty.als (saved by Live 12.4.16: one MIDI track, one audio track, two returns;
// copied to ./als/empty.als), cloning its MIDI track per part with fresh pointee ids, so everything else stays as
// Live wrote it. MIDI tracks only (no stems: nothing is rendered offline here), no instrument on them; the tempo and
// the locators. 4/4 as in the template (the clips' grid; an odd meter's bars still fall where the notes say).
// Pure string functions (writeAlsXml) + gzip through the platform's CompressionStream (gzip/gunzip below), so Node's
// tests use the same code with node:zlib instead.
import type { ExportNote, ExportPart, ExportSong } from './songExport';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number) => String(Math.round(v * 1e6) / 1e6);

// tags that hold a pointee id (unique across the set, below NextPointeeId): *Target, Pointee and a MIDI track's
// ControllerTargets.<n> (alsExport.ts: Live reported non-unique pointee ids without the last ones)
export const POINTEE = /<([\w]*(?:Target|Pointee)|ControllerTargets\.\d+)(\s+)Id="(\d+)"/g;

function renumber(xml: string, next: { id: number }): string {
  return xml.replace(POINTEE, (_m, tag, sp) => `<${tag}${sp}Id="${next.id++}"`);
}
function setName(track: string, name: string): string {
  return track
    .replace(/(<Name>\s*<EffectiveName Value=")[^"]*(")/, `$1${esc(name)}$2`)
    .replace(/(<UserName Value=")[^"]*(")/, `$1${esc(name)}$2`);
}
// the track's arrangement clips (the first ArrangerAutomation's Events after its MainSequencer)
function setArrangerEvents(track: string, events: string): string {
  const seq = track.search(/<(MainSequencer|Sample)>/);
  const at = track.indexOf('<ArrangerAutomation>', seq < 0 ? 0 : seq);
  if (at < 0) throw new Error('template track without ArrangerAutomation');
  const rest = track.slice(at);
  return track.slice(0, at) + rest.replace(/<Events\s*\/>|<Events>[\s\S]*?<\/Events>/, `<Events>${events}</Events>`);
}

const timeSig = `<TimeSignature><TimeSignatures><RemoteableTimeSignature Id="0"><Numerator Value="4" /><Denominator Value="4" /><Time Value="0" /></RemoteableTimeSignature></TimeSignatures></TimeSignature>`;
const clipCommon = (name: string, end: number, color: number, loop = false) => `
<LomId Value="0" /><LomIdView Value="0" />
<CurrentStart Value="0" /><CurrentEnd Value="${n(end)}" />
<Loop><LoopStart Value="0" /><LoopEnd Value="${n(end)}" /><StartRelative Value="0" /><LoopOn Value="${loop}" /><OutMarker Value="${n(end)}" /><HiddenLoopStart Value="0" /><HiddenLoopEnd Value="${n(end)}" /></Loop>
<Name Value="${esc(name)}" /><Annotation Value="" /><Color Value="${color}" />
<LaunchMode Value="0" /><LaunchQuantisation Value="0" />
${timeSig}
<Envelopes><Envelopes /></Envelopes>
<ScrollerTimePreserver><LeftTime Value="0" /><RightTime Value="${n(end)}" /></ScrollerTimePreserver>
<TimeSelection><AnchorTime Value="0" /><OtherTime Value="0" /></TimeSelection>
<Legato Value="false" /><Ram Value="false" />
<GrooveSettings><GrooveId Value="-1" /></GrooveSettings>
<Disabled Value="false" /><VelocityAmount Value="0" />
<FollowAction><FollowTime Value="4" /><IsLinked Value="true" /><LoopIterations Value="1" /><FollowActionA Value="4" /><FollowActionB Value="0" /><FollowChanceA Value="100" /><FollowChanceB Value="0" /><JumpIndexA Value="1" /><JumpIndexB Value="1" /><FollowActionEnabled Value="false" /></FollowAction>
<Grid><FixedNumerator Value="1" /><FixedDenominator Value="16" /><GridIntervalPixel Value="20" /><Ntoles Value="2" /><SnapToGrid Value="true" /><Fixed Value="false" /></Grid>
<FreezeStart Value="0" /><FreezeEnd Value="0" />
<IsWarped Value="true" /><TakeId Value="1" /><IsInKey Value="true" />
<ScaleInformation><Root Value="0" /><Name Value="0" /></ScaleInformation>
<AutomationEnvelopesListWrapper LomId="0" />`;

function midiClip(part: ExportPart, end: number, color: number, loop = false): string {
  const byKey = new Map<number, ExportNote[]>();
  for (const nt of part.notes) {
    const k = Math.max(0, Math.min(127, Math.round(nt.key)));
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(nt);
  }
  let noteId = 1;
  const keyTracks = [...byKey.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, notes], i) => {
      const events = [...notes]
        .sort((a, b) => a.beat - b.beat)
        .map((nt) => {
          const vel = Math.max(1, Math.min(127, Math.round(nt.vel)));
          return `<MidiNoteEvent Time="${n(nt.beat)}" Duration="${n(Math.max(1 / 64, nt.dur))}" Velocity="${vel}" OffVelocity="64" NoteId="${noteId++}" />`;
        })
        .join('');
      return `<KeyTrack Id="${i}"><Notes>${events}</Notes><MidiKey Value="${key}" /></KeyTrack>`;
    })
    .join('');
  return `<MidiClip Id="0" Time="0">${clipCommon(part.name, end, color, loop)}
<Notes><KeyTracks>${keyTracks}</KeyTracks><PerNoteEventStore><EventLists /></PerNoteEventStore><NoteProbabilityGroups /><ProbabilityGroupIdGenerator><NextId Value="1" /></ProbabilityGroupIdGenerator><NoteIdGenerator><NextId Value="${noteId}" /></NoteIdGenerator></Notes>
<BankSelectCoarse Value="-1" /><BankSelectFine Value="-1" /><ProgramChange Value="-1" />
<NoteEditorFoldInZoom Value="-1" /><NoteEditorFoldInScroll Value="0" /><NoteEditorFoldOutZoom Value="867" /><NoteEditorFoldOutScroll Value="-353" /><NoteEditorFoldScaleZoom Value="-1" /><NoteEditorFoldScaleScroll Value="0" />
<NoteSpellingPreference Value="0" /><AccidentalSpellingPreference Value="3" /><PreferFlatRootNote Value="false" />
<ExpressionGrid><FixedNumerator Value="1" /><FixedDenominator Value="16" /><GridIntervalPixel Value="20" /><Ntoles Value="2" /><SnapToGrid Value="false" /><Fixed Value="false" /></ExpressionGrid>
</MidiClip>`;
}

// ---------------------------------------------------------------- Session view (2026-11-20)

/** `count` empty clip slots, as the template writes them. */
const emptySlot = (i: number, value = '') =>
  `<ClipSlot Id="${i}"><LomId Value="0" /><ClipSlot>${value ? `<Value>${value}</Value>` : '<Value />'}</ClipSlot><HasStop Value="true" /></ClipSlot>`;
const slotList = (count: number, values: string[] = []) =>
  `<ClipSlotList>${Array.from({ length: count }, (_, i) => emptySlot(i, values[i])).join('')}</ClipSlotList>`;

/** The track's MainSequencer clip slots filled with `values` (one per scene). */
function setSessionClips(track: string, count: number, values: string[]): string {
  const seq = track.indexOf('<MainSequencer>');
  if (seq < 0) return track;
  const rest = track.slice(seq).replace(/<ClipSlotList>[\s\S]*?<\/ClipSlotList>|<ClipSlotList\s*\/>/, slotList(count, values));
  return track.slice(0, seq) + rest;
}

/** A part's notes inside [start, end) as a session clip starting at 0. */
function sessionClip(part: ExportPart, scene: { name: string; start: number; end: number }, color: number): string | undefined {
  const notes = part.notes
    .filter((x) => x.beat >= scene.start - 1e-6 && x.beat < scene.end - 1e-6)
    .map((x) => ({ ...x, beat: x.beat - scene.start, dur: Math.min(x.dur, scene.end - x.beat) }));
  if (!notes.length) return undefined;
  return midiClip({ ...part, name: `${part.name} ${scene.name}`, notes }, scene.end - scene.start, color, true);
}

/** The scenes, cloned from the template's first one (names set), at least `min` of them. */
function setScenes(xml: string, scenes: { name: string }[], min: number): string {
  const m = /<Scenes>([\s\S]*?)<\/Scenes>/.exec(xml);
  const first = m && /<Scene Id="\d+">[\s\S]*?<\/Scene>/.exec(m[1]);
  if (!m || !first) throw new Error('template without scenes');
  const count = Math.max(min, scenes.length);
  const list = Array.from({ length: count }, (_, i) => first[0]
    .replace(/<Scene Id="\d+">/, `<Scene Id="${i}">`)
    .replace(/<Name Value="[^"]*" \/>/, `<Name Value="${esc(scenes[i]?.name ?? '')}" />`)).join('');
  return xml.slice(0, m.index) + `<Scenes>${list}</Scenes>` + xml.slice(m.index + m[0].length);
}

/** The track's speaker (mixer on/off) off. */
const mute = (track: string) => track.replace(/(<Speaker>\s*<LomId Value="0" \/>\s*<Manual Value=")true(")/, '$1false$2');

/**
 * The set's XML: the template's MIDI and audio tracks replaced by one MIDI track per part (with notes) holding one
 * arrangement clip over the whole song, the tempo, the locators, NextPointeeId moved on. Throws on a template that
 * isn't the expected one, on nothing to export, or on a duplicate pointee id.
 */
export function writeAlsXml(template: string, song: ExportSong): string {
  let xml = template;
  if (!/<MidiTrack[\s>]/.test(xml) || !/<AudioTrack[\s>]/.test(xml)) throw new Error('template needs one MIDI track and one audio track');
  // Session view (2026-11-20): every clip slot list (tracks, returns, main) sized to the scenes, then filled per track
  const sceneCount = Math.max(8, song.scenes?.length ?? 0);
  if (song.scenes?.length) {
    xml = setScenes(xml, song.scenes, 8);
    xml = xml.replace(/<ClipSlotList>[\s\S]*?<\/ClipSlotList>/g, slotList(sceneCount));
  }
  const midiT = /<MidiTrack[\s>][\s\S]*?<\/MidiTrack>/.exec(xml);
  const audioT = /<AudioTrack[\s>][\s\S]*?<\/AudioTrack>/.exec(xml);
  if (!midiT || !audioT) throw new Error('template needs one MIDI track and one audio track');
  const next = { id: Number(/<NextPointeeId Value="(\d+)"/.exec(xml)?.[1] ?? 100000) };
  // track ids: above every track id in the template (returns keep theirs)
  let trackId = Math.max(...[...xml.matchAll(/<(?:MidiTrack|AudioTrack|ReturnTrack|GroupTrack) Id="(\d+)"/g)].map((m) => Number(m[1]))) + 1;

  const tracks: string[] = [];
  song.parts.forEach((part, i) => {
    if (!part.notes.length) return;
    const color = (i * 5 + 2) % 70;
    let t = renumber(midiT[0], next).replace(/<MidiTrack Id="\d+"/, `<MidiTrack Id="${trackId++}"`);
    t = setName(t, part.name);
    t = setArrangerEvents(t, midiClip(part, song.beats, color));
    if (song.scenes?.length) t = setSessionClips(t, sceneCount, song.scenes.map((sc) => sessionClip(part, sc, color) ?? ''));
    if (song.muted?.includes(part.name)) t = mute(t);
    tracks.push(t);
  });
  if (!tracks.length) throw new Error('nothing to export');

  const first = Math.min(midiT.index, audioT.index);
  const last = Math.max(midiT.index + midiT[0].length, audioT.index + audioT[0].length);
  xml = xml.slice(0, first) + tracks.join('\n') + xml.slice(last);

  // tempo: the main track's manual value and its tempo automation's first event
  const tempoAt = xml.indexOf('<Tempo>');
  if (tempoAt >= 0) {
    const tempoEnd = xml.indexOf('</Tempo>', tempoAt);
    xml = xml.slice(0, tempoAt) + xml.slice(tempoAt, tempoEnd).replace(/<Manual Value="[^"]*"/, `<Manual Value="${n(song.bpm)}"`) + xml.slice(tempoEnd);
    const tempoTarget = /<Tempo>[\s\S]*?<AutomationTarget Id="(\d+)"/.exec(xml.slice(tempoAt))?.[1];
    if (tempoTarget) {
      xml = xml.replace(new RegExp(`(<PointeeId Value="${tempoTarget}" />[\\s\\S]*?<FloatEvent [^>]*Value=")[^"]*(")`), `$1${n(song.bpm)}$2`);
    }
  }
  const locs = song.locators
    .filter((l) => l.beat >= 0 && l.beat <= song.beats)
    .map((l, i) => `<Locator Id="${i}"><LomId Value="0" /><Time Value="${n(l.beat)}" /><Name Value="${esc(l.name)}" /><Annotation Value="" /><IsSongStart Value="false" /></Locator>`)
    .join('');
  xml = xml.replace(/<Locators>\s*<Locators\s*\/>\s*<\/Locators>/, `<Locators><Locators>${locs}</Locators></Locators>`);
  // the arrangement loop (2026-11-20: the practice set)
  if (song.loop) {
    xml = xml.replace(/(<Transport>[\s\S]*?<LoopOn Value=")[^"]*("[\s\S]*?<LoopStart Value=")[^"]*("[\s\S]*?<LoopLength Value=")[^"]*(")/,
      `$1true$2${n(song.loop.start)}$3${n(song.loop.length)}$4`);
  }
  xml = xml.replace(/<NextPointeeId Value="\d+"/, `<NextPointeeId Value="${next.id}"`);
  const seen = new Set<string>();
  for (const m of xml.matchAll(POINTEE)) {
    if (seen.has(m[3])) throw new Error(`duplicate pointee id ${m[3]} (${m[1]})`);
    seen.add(m[3]);
  }
  return xml;
}

// ---------------------------------------------------------------- gzip (browser)

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
/** A text gzipped (an .als is gzipped XML). */
export const gzipText = (text: string) => pipe(new TextEncoder().encode(text), new CompressionStream('gzip'));
/** A gzipped file's text (an already plain XML is returned as it is). */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')));
}
