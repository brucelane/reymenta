// An Ableton set as a bass tab (2026-11-20, web/src/workshop/alsTab.ts): the set's MIDI tracks listed, the bass
// guessed, the chosen track read by src/core/alsImport.ts (DOMParser from @xmldom/xmldom here).
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { alsMidiTracks, alsToTab, guessBass, markBass } from '../web/src/workshop/alsTab';
import { writeAlsXml } from '../web/src/workshop/alsWrite';

// parseAls needs a browser DOMParser: xmldom's, with the querySelector("parsererror") it asks for
(globalThis as Record<string, unknown>).DOMParser = class {
  parseFromString(xml: string, type: string) {
    const doc = new XmlDomParser().parseFromString(xml, type as 'text/xml') as unknown as Record<string, unknown>;
    doc.querySelector = () => null;
    return doc;
  }
};

const TEMPLATE = join(import.meta.dirname, '..', 'web', 'src', 'workshop', 'als', 'empty.als');
const set = () => writeAlsXml(gunzipSync(readFileSync(TEMPLATE)).toString('utf8'), {
  title: 'x', bpm: 96, beatsPerBar: 4, beats: 8, locators: [{ beat: 4, name: '#Verse' }],
  parts: [
    { name: 'Lead', drum: false, notes: [{ beat: 0, dur: 1, key: 72, vel: 100 }, { beat: 1, dur: 1, key: 74, vel: 100 }] },
    { name: 'Synth 2', drum: false, notes: [{ beat: 0, dur: 1, key: 31, vel: 100 }, { beat: 2, dur: 0.5, key: 33, vel: 100 }, { beat: 4, dur: 1, key: 38, vel: 90 }] },
    { name: 'tab drums', drum: true, notes: [{ beat: 0, dur: 0.25, key: 36, vel: 100 }] },
  ],
});

test('als tab: MIDI tracks listed with their notes, the bass guessed (lowest)', () => {
  const xml = set();
  const tracks = alsMidiTracks(xml);
  assert.deepEqual(tracks.map((t) => [t.name, t.notes]), [['Lead', 2], ['Synth 2', 3], ['tab drums', 1]]);
  assert.equal(guessBass(tracks), 1); // Synth 2: average key 34, under the drums' 36
});

test('als tab: the guess prefers a bass name, then the lowest notes', () => {
  const t = (name: string, avgKey: number, notes = 4) => ({ index: 0, name, notes, avgKey });
  const list = [t('Lead', 70), t('Pad', 40), t('Basse', 45), t('Empty', 20, 0)].map((x, index) => ({ ...x, index }));
  assert.equal(guessBass(list), 2);
  assert.equal(guessBass(list.filter((x) => x.name !== 'Basse')), 1);
  assert.equal(guessBass([]), undefined);
});

test('als tab: the chosen track becomes the tab, other "tab" tracks ignored', async () => {
  const xml = set();
  const marked = markBass(xml, 1);
  assert.deepEqual(alsMidiTracks(marked).map((t) => t.name), ['Lead', 'tabbass', 't-b drums']);
  const tab = await alsToTab(xml, 1, 'song.als');
  assert.equal(tab.song.tempo, 96);
  assert.deepEqual(tab.song.tracks.tabbass!.map((n) => [n.beat, n.key]), [[0, 31], [2, 33], [4, 38]]);
  assert.deepEqual(Object.keys(tab.song.tracks), ['tabbass']);
  assert.deepEqual(tab.song.locators.map((l) => l.name), ['#Verse']);
  assert.equal(tab.tab.length, 3);
  assert.equal(tab.tuning, 'EADG');
  await assert.rejects(alsToTab(xml.replace(/<MidiNoteEvent [^>]*\/>/g, ''), 1, 'empty.als'), /no notes|tab/);
});
