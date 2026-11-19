// The playing bass tab on the phone (2026-11-19, studies/reymenta-workshop.md step 1): the server sends the track's tab
// once ({t:"tab"}) and where the song is ({t:"clock"}, every second while it plays); the phone moves the playhead in
// between. Three bars, like the WebApp's Track pane: the current one (with the playhead) and the next two.
import { useEffect, useMemo, useState } from 'react';
import type { TabClockMsg, TabMsg } from '../../src/room/protocol';

export interface ClockAt { msg: TabClockMsg; at: number }

const ROWS = 3;
const LEFT = 18; // string names
const GAP = 18; // between strings
const TOP = 16; // room for the section name and the bar number
const ROW_H = TOP + 3 * GAP + 12;
const W = 400; // viewBox width of a bar

/** With `bar`, a still view from that bar (the Workshop: no clock, no playhead); `marks` = note indexes drawn as warnings. */
export function TabView({ tab, clock, texts, bar: fixedBar, marks }: {
  tab?: TabMsg; clock?: ClockAt; texts: { tabWaiting: string; tabNone: string; tabStopped: string }; bar?: number; marks?: Set<number>;
}) {
  const [now, setNow] = useState(() => performance.now());
  const playing = clock?.msg.p === 1;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 50) { last = t; setNow(t); } // 20 frames a second is plenty for a playhead
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // notes per bar (a cycle = a bar of `bb` beats)
  const bars = useMemo(() => {
    const out = new Map<number, Array<{ n: TabMsg['n'][number]; i: number }>>();
    if (!tab) return out;
    tab.n.forEach((n, i) => {
      const b = Math.floor(n[0] / tab.bb + 1e-6);
      const list = out.get(b) ?? [];
      list.push({ n, i });
      out.set(b, list);
    });
    return out;
  }, [tab]);

  if (fixedBar === undefined) {
    if (!clock) return <p className="tab-msg">{texts.tabWaiting}</p>;
    if (!tab || tab.f !== clock.msg.f) return <p className="tab-msg">{tab ? texts.tabWaiting : texts.tabNone}</p>;
  } else if (!tab) return <p className="tab-msg">{texts.tabNone}</p>;
  if (!tab) return null;

  const cycle = fixedBar ?? Math.max(0, clock!.msg.c + (playing ? ((now - clock!.at) / 1000) * clock!.msg.s : 0));
  const bar = Math.floor(cycle);
  const names = tab.tuning.length === 4 ? tab.tuning.split('') : ['E', 'A', 'D', 'G'];
  const sectionOf = (b: number) => {
    let name = '';
    for (const [beat, n] of tab.sec) if (beat <= b * tab.bb + 1e-6) name = n;
    return name;
  };
  const x = (beatInBar: number) => LEFT + (beatInBar / tab.bb) * (W - LEFT - 6);
  const y = (string: number) => TOP + (3 - string) * GAP;

  return (
    <div className="tab">
      <p className="tab-title">
        <b>{tab.title}</b>{sectionOf(bar) ? ` · ${sectionOf(bar)}` : ''} · {bar + 1}{playing || fixedBar !== undefined ? '' : ` (${texts.tabStopped})`}
      </p>
      {Array.from({ length: ROWS }, (_, r) => {
        const b = bar + r;
        const start = b * tab.bb;
        const startsSection = tab.sec.find(([beat]) => Math.abs(beat - start) < 1e-6);
        return (
          <svg key={b} className={`tab-row${r === 0 ? ' now' : ''}`} viewBox={`0 0 ${W} ${ROW_H}`}>
            <text x={LEFT} y={10} className="tab-bar">{b + 1}{startsSection ? `  ${startsSection[1]}` : ''}</text>
            {[0, 1, 2, 3].map((s) => (
              <g key={s}>
                <line x1={LEFT} x2={W - 4} y1={y(s)} y2={y(s)} className="tab-string" />
                <text x={4} y={y(s) + 4} className="tab-name">{names[s]}</text>
              </g>
            ))}
            {Array.from({ length: Math.floor(tab.bb) }, (_, k) => (
              <line key={k} x1={x(k)} x2={x(k)} y1={y(3) - 4} y2={y(0) + 4} className={k === 0 ? 'tab-barline' : 'tab-beat'} />
            ))}
            {(bars.get(b) ?? []).map(({ n: [beat, string, fret], i }) => (
              <g key={i}>
                <rect x={x(beat - start) - 6} y={y(string) - 7} width={12} height={14} className="tab-bg" />
                <text x={x(beat - start)} y={y(string) + 4} className={`tab-fret${marks?.has(i) ? ' tab-warn' : ''}`}>{fret}</text>
              </g>
            ))}
            {r === 0 && fixedBar === undefined && <line x1={x((cycle - b) * tab.bb)} x2={x((cycle - b) * tab.bb)} y1={4} y2={ROW_H - 4} className="tab-head" />}
          </svg>
        );
      })}
    </div>
  );
}
