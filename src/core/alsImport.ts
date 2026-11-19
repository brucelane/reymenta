// Reads an Ableton Live set (.als = gzipped XML) and returns the notes of its
// arrangement MIDI clips, track by track, in absolute beats.
// Only tracks whose name contains "tab" are kept (tabbass, tabbd, tabsynth, tabgtr, taborgan...).
import { renderClip, AlsClip, AlsNote, AlsSong } from "./songGrid";

const child = (el: Element | null | undefined, name: string): Element | null => {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.tagName === name) return c;
  return null;
};
const path = (el: Element | null | undefined, ...names: string[]): Element | null => {
  let cur: Element | null | undefined = el;
  for (const n of names) cur = child(cur, n);
  return cur ?? null;
};
const val = (el: Element | null | undefined, ...names: string[]): string =>
  path(el, ...names)?.getAttribute("Value") ?? "";
const num = (el: Element | null | undefined, ...names: string[]): number =>
  parseFloat(val(el, ...names)) || 0;

/** "1 tabbass" -> "tabbass" (Live prefixes track names with their number). */
const trackKey = (name: string) => {
  const m = name.toLowerCase().match(/tab[a-z0-9]*/);
  return m ? m[0] : "";
};

async function gunzip(data: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(data);
  // A .als is gzip (1f 8b); an already-extracted XML is accepted too.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

export async function parseAls(data: ArrayBuffer, source: string): Promise<AlsSong> {
  const xml = await gunzip(data);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not a valid Ableton Live set");
  const liveSet = path(doc.documentElement, "LiveSet");
  if (!liveSet) throw new Error("No LiveSet in this file");

  const main = child(liveSet, "MainTrack") ?? child(liveSet, "MasterTrack");
  const tempoEl = main?.getElementsByTagName("Tempo")[0];
  const tempo = num(tempoEl, "Manual") || 120;

  const locators = Array.from(path(liveSet, "Locators", "Locators")?.children ?? [])
    .map((l) => ({ beat: num(l, "Time"), name: val(l, "Name") }))
    .sort((a, b) => a.beat - b.beat);

  const tracks: Record<string, AlsNote[]> = {};
  const clipStarts: number[] = [];
  let audioFile = "";
  let audioStart = 0;
  const audioClips: { file: string; start: number }[] = [];

  for (const tr of Array.from(child(liveSet, "Tracks")?.children ?? [])) {
    const name = val(tr, "Name", "EffectiveName");
    const seq = path(tr, "DeviceChain", "MainSequencer");
    const events = path(seq, "ClipTimeable", "ArrangerAutomation", "Events");
    if (tr.tagName === "AudioTrack") {
      // arrangement clips only (take lanes hold other takes); the first one of the first audio
      // track is the default song to play along with
      for (const clip of Array.from(path(tr, "DeviceChain", "MainSequencer", "Sample", "ArrangerAutomation", "Events")?.children ?? [])) {
        if (clip.tagName !== "AudioClip" || val(clip, "Disabled") === "true") continue;
        const file = val(clip, "SampleRef", "FileRef", "Path").split(/[\\/]/).pop() ?? "";
        if (!file) continue;
        const start = parseFloat(clip.getAttribute("Time") ?? "0") || 0;
        audioClips.push({ file, start });
        if (!audioFile) {
          audioFile = file;
          audioStart = start;
        }
      }
      continue;
    }
    if (tr.tagName !== "MidiTrack") continue;
    const key = trackKey(name);
    if (!key) continue;
    const notes: AlsNote[] = tracks[key] ?? [];
    for (const c of Array.from(events?.children ?? [])) {
      if (c.tagName !== "MidiClip" || val(c, "Disabled") === "true") continue;
      const loop = child(c, "Loop");
      const clip: AlsClip = {
        start: num(c, "CurrentStart"),
        end: num(c, "CurrentEnd"),
        loopOn: val(loop, "LoopOn") === "true",
        loopStart: num(loop, "LoopStart"),
        loopEnd: num(loop, "LoopEnd"),
        startRelative: num(loop, "StartRelative"),
        events: [],
      };
      for (const kt of Array.from(c.getElementsByTagName("KeyTrack"))) {
        const midiKey = num(kt, "MidiKey");
        for (const n of Array.from(kt.getElementsByTagName("MidiNoteEvent"))) {
          if (n.getAttribute("IsEnabled") === "false") continue;
          clip.events.push({
            time: parseFloat(n.getAttribute("Time") ?? "0"),
            dur: parseFloat(n.getAttribute("Duration") ?? "0"),
            vel: parseFloat(n.getAttribute("Velocity") ?? "100"),
            key: midiKey,
          });
        }
      }
      clipStarts.push(clip.start);
      notes.push(...renderClip(clip));
    }
    notes.sort((a, b) => a.beat - b.beat || a.key - b.key);
    tracks[key] = notes;
  }
  if (!Object.keys(tracks).length) throw new Error('No MIDI track named "tab..." in this set');
  return { source, tempo, locators, tracks, clipStarts, audioFile, audioStart, audioClips };
}
