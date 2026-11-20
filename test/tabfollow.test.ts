import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parsePhoneMessage } from '../src/room/protocol';
import { TabFollow } from '../src/server/tabFollow';

// a folder with track.json (bpm 120) and a tab: two notes in bar 1, one in bar 2, a section at bar 2
function assets(): string {
  const root = mkdtempSync(join(tmpdir(), 'tabfollow-'));
  mkdirSync(join(root, 'song'));
  writeFileSync(join(root, 'song', 'track.json'), JSON.stringify({ title: 'Song', bpm: 120, tabFile: 'song.tab.json' }));
  writeFileSync(join(root, 'song', 'song.tab.json'), JSON.stringify({
    tuning: 'EADG',
    song: { cycleBeats: 4, locators: [{ beat: 0, name: '#intro' }, { beat: 4, name: '#A' }] },
    tab: [{ beat: 0, dur: 1, string: 0, fret: 2 }, { beat: 2, dur: 1, string: 1, fret: 4 }, { beat: 4, dur: 2, string: 2, fret: 0 }],
  }));
  return root;
}
const state = (o: Record<string, unknown>) => JSON.stringify({ event: 'transport', message: 'state', ...o });

test('tab view message parsed, anything else in it refused', () => {
  assert.deepEqual(parsePhoneMessage('{"t":"tab","on":true}'), { t: 'tab', on: true });
  assert.equal(parsePhoneMessage('{"t":"tab","on":"yes"}'), undefined);
});

test('the tab is read compact, sections without their #', () => {
  const f = new TabFollow(assets());
  const tab = f.tab('song');
  assert.ok(tab);
  assert.equal(tab.title, 'Song');
  assert.equal(tab.bb, 4);
  assert.deepEqual(tab.n, [[0, 0, 2, 1], [2, 1, 4, 1], [4, 2, 0, 2]]);
  assert.deepEqual(tab.sec, [[0, 'intro'], [4, 'A']]);
  assert.equal(f.tab('../etc'), null);
  assert.equal(f.tab('nothere'), null);
});

test("Cinder's position becomes a bar from the track's bpm; a WebApp's cycle is taken as sent; Cinder wins", () => {
  let t = 1000;
  const f = new TabFollow(assets(), () => t);
  assert.equal(f.clock(), undefined);
  // a WebApp plays the Strudel pane at bar 3 (cycle 2), 0.5 cycle a second
  assert.equal(f.receive(state({ from: 'webapp', sender: 'a', playing: true, folder: 'song', cycle: 2, cps: 0.5 })), true);
  t += 1000;
  assert.deepEqual(f.clock(), { t: 'clock', f: 'song', p: 1, c: 2.5, s: 0.5 });
  // Cinder: 4 s into the song at 120 bpm = 8 beats = cycle 2; it wins over the WebApp
  assert.equal(f.receive(state({ from: 'cinder', playing: true, folder: 'song', position: 4 })), true);
  assert.deepEqual(f.clock(), { t: 'clock', f: 'song', p: 1, c: 2, s: 0.5 });
  // the same position a tick later is no change
  t += 100;
  assert.equal(f.receive(state({ from: 'cinder', playing: true, folder: 'song', position: 4.1 })), false);
  // stopped: a change
  assert.equal(f.receive(state({ from: 'cinder', playing: false, folder: 'song', position: 4.1 })), true);
  assert.equal(f.playing, false);
  // Cinder gone (no state for 8 s): back to nothing (the WebApp's state is old too)
  t += 9000;
  assert.equal(f.clock(), undefined);
});

test('messages that are not transport states, or carry a bad folder, are ignored', () => {
  const f = new TabFollow(assets());
  assert.equal(f.receive('{"params":[{"name":260,"value":1}]}'), false);
  assert.equal(f.receive(state({ from: 'webapp', playing: true, folder: '../x', cycle: 1, cps: 1 })), false);
  assert.equal(f.receive(state({ from: 'webapp', playing: true, folder: 'song', cycle: 1 })), false); // an older WebApp: no cps
  assert.equal(f.receive('not json {"transport"'), false);
});

test('Ableton Link (2026-11-20): the tab starts at bar 1 when Live starts, follows its tempo, Cinder still wins', () => {
  let t = 1000;
  const f = new TabFollow(assets(), () => t);
  // no folder named yet: Link alone can't choose a track
  assert.equal(f.receiveLink({ tempo: 120, beat: 10, playing: true, peers: 1 }), false);
  assert.equal(f.clock(), undefined);
  f.linkFolder = 'song';
  // Live stopped: nothing to follow yet (a stopped Link doesn't take over)
  assert.equal(f.receiveLink({ tempo: 120, beat: 10, playing: false, peers: 1 }), false);
  // Live starts on beat 17 (bar 5 of Link's timeline): the song's bar 1
  assert.equal(f.receiveLink({ tempo: 120, beat: 17, playing: true, peers: 1 }), true);
  assert.equal(f.source, 'link');
  assert.deepEqual(f.clock(), { t: 'clock', f: 'song', p: 1, c: 0.25, s: 0.5 }); // 120 bpm, 4/4: half a bar a second
  t += 1000;
  assert.equal(f.receiveLink({ tempo: 120, beat: 19, playing: true, peers: 1 }), false); // same tempo: no news
  assert.equal(f.clock()!.c, 0.75);
  assert.equal(f.receiveLink({ tempo: 90, beat: 19.5, playing: true, peers: 1 }), true); // tempo change
  assert.equal(f.clock()!.s, 0.375);
  // Cinder's state wins while fresh
  f.receive(state({ from: 'cinder', playing: true, folder: 'song', position: 4 }));
  assert.equal(f.source, 'cinder');
  // Live stops (and Cinder's state ages): back to nothing
  t += 9000;
  assert.equal(f.receiveLink({ tempo: 90, beat: 30, playing: false, peers: 1 }), false);
  assert.equal(f.clock(), undefined);
  // LINK_FROM_BAR: Live's start = bar 9; the folder named last by a WebApp is used without LINK_FOLDER
  const g = new TabFollow(assets(), () => t);
  g.linkFromBar = 9;
  g.receive(state({ from: 'webapp', playing: false, folder: 'song', cycle: 0, cps: 0.5 }));
  t += 9000;
  g.receiveLink({ tempo: 120, beat: 3, playing: true, peers: 1 });
  assert.equal(g.clock()!.c, 8.75);
});
