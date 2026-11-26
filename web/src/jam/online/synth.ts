// The online Jam's sound (2026-11-26): every page plays the whole room on this small Web Audio synth, so nothing is
// downloaded and nothing waits for samples. By MIDI channel, as in onlineRoom.ts's config:
//   10 drums (kick, snare, clap, hats, rim: synthesized), 1 bass (saw, low-pass, drive), 2 keys (two detuned
//   triangles), 3 lead (square with vibrato), 16 the room's effects (echo, reverb sends).
// CCs: 74 cutoff, 21 drive, 72 release, 1 vibrato, 20 the drums' filter, 91 echo, 93 reverb (0-127).
// Times are AudioContext seconds; onlineJam turns the shared clock into them.
import type { MidiMsg } from '../../../../src/jam/jam';

const mtof = (n: number) => 440 * 2 ** ((n - 69) / 12);
const cc01 = (v: number) => Math.min(1, Math.max(0, v / 127));

interface Voice { stop: (t: number) => void; start: number }

export class JamSynth {
  readonly ctx: AudioContext;
  private master: GainNode;
  private drumFilter: BiquadFilterNode;
  private echoSend: GainNode;
  private reverbSend: GainNode;
  private echo: DelayNode;
  private noise: AudioBuffer;
  private voices = new Map<string, Voice>();
  /** cc values by channel: controller -> 0..1 */
  private ccs = new Map<number, Map<number, number>>();

  constructor(bpm: number) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(c.destination);
    this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(comp);
    this.drumFilter = c.createBiquadFilter(); this.drumFilter.type = 'lowpass'; this.drumFilter.frequency.value = 18000;
    this.drumFilter.connect(this.master);
    // echo: three sixteenths, fed back
    this.echo = c.createDelay(2); this.echo.delayTime.value = (60 / bpm) * 0.75;
    const fb = c.createGain(); fb.gain.value = 0.38;
    const echoTone = c.createBiquadFilter(); echoTone.type = 'lowpass'; echoTone.frequency.value = 3500;
    this.echoSend = c.createGain(); this.echoSend.gain.value = 0.25;
    this.echoSend.connect(this.echo); this.echo.connect(echoTone); echoTone.connect(fb); fb.connect(this.echo); echoTone.connect(comp);
    // reverb: a convolver on decaying noise
    const rev = c.createConvolver();
    const len = Math.floor(c.sampleRate * 2.2);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    rev.buffer = ir;
    this.reverbSend = c.createGain(); this.reverbSend.gain.value = 0.3;
    this.reverbSend.connect(rev); rev.connect(comp);
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  /** inside a tap (browsers start audio only then) */
  resume(): Promise<void> { return this.ctx.state === 'suspended' ? this.ctx.resume() : Promise.resolve(); }
  close(): void { void this.ctx.close(); }

  private cc(channel: number, controller: number, def: number): number {
    return this.ccs.get(channel)?.get(controller) ?? def;
  }

  /** messages at AudioContext time `t` (late ones play at once) */
  play(msgs: MidiMsg[], t: number): void {
    const at = Math.max(t, this.ctx.currentTime + 0.005);
    for (const m of msgs) {
      if (m.type === 'cc' && m.controller !== undefined && m.value !== undefined) this.setCc(m.channel, m.controller, cc01(m.value), at);
      else if (m.type === 'noteon' && m.note !== undefined) this.noteOn(m.channel, m.note, (m.velocity ?? 100) / 127, at);
      else if (m.type === 'noteoff' && m.note !== undefined) this.noteOff(m.channel, m.note, at);
    }
  }

  private setCc(channel: number, controller: number, v: number, at: number): void {
    if (!this.ccs.has(channel)) this.ccs.set(channel, new Map());
    this.ccs.get(channel)!.set(controller, v);
    if (channel === 10 && controller === 20) this.drumFilter.frequency.setTargetAtTime(200 * 90 ** v, at, 0.03);
    if (channel === 16 && controller === 91) this.echoSend.gain.setTargetAtTime(v * 0.8, at, 0.05);
    if (channel === 16 && controller === 93) this.reverbSend.gain.setTargetAtTime(v * 0.9, at, 0.05);
  }

  private noteOn(channel: number, note: number, vel: number, t: number): void {
    if (channel === 10) { this.drum(note, vel, t); return; }
    const key = `${channel}:${note}`;
    this.voices.get(key)?.stop(t);
    const v = channel === 1 ? this.bass(note, vel, t) : channel === 2 ? this.keys(note, vel, t) : this.lead(channel, note, vel, t);
    this.voices.set(key, v);
  }

  private noteOff(channel: number, note: number, t: number): void {
    const key = `${channel}:${note}`;
    const v = this.voices.get(key);
    if (!v) return;
    this.voices.delete(key);
    // a note off that arrives before its note on's time still ends after it
    v.stop(Math.max(t, v.start + 0.03));
  }

  /** a gain envelope: attack to `peak`, held, released on stop */
  private env(t: number, peak: number, attack: number, release: () => number): { g: GainNode; stop: (s: number) => void } {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    return {
      g,
      // from wherever the attack is at `s`, down to silence
      stop: (s: number) => { g.gain.setTargetAtTime(0, Math.max(s, t + attack), release() / 4); },
    };
  }

  private send(node: AudioNode, echo = 1, reverb = 1): void {
    node.connect(this.master);
    if (echo) node.connect(this.echoSend);
    if (reverb) node.connect(this.reverbSend);
  }

  private bass(note: number, vel: number, t: number): Voice {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(note);
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = mtof(note - 12);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
    const cut = 120 * 40 ** this.cc(1, 74, 0.5);
    f.frequency.setValueAtTime(cut * 3, t); f.frequency.setTargetAtTime(cut, t, 0.08);
    const drive = c.createWaveShaper();
    const k = this.cc(1, 21, 0.3) * 30;
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    drive.curve = curve;
    const e = this.env(t, 0.5 * vel, 0.005, () => 0.12);
    o.connect(f); sub.connect(f); f.connect(drive); drive.connect(e.g); this.send(e.g, 0, 0);
    o.start(t); sub.start(t);
    return { start: t, stop: (s) => { e.stop(s); o.stop(s + 0.6); sub.stop(s + 0.6); } };
  }

  private keys(note: number, vel: number, t: number): Voice {
    const c = this.ctx;
    const a = c.createOscillator(); a.type = 'triangle'; a.frequency.value = mtof(note); a.detune.value = -6;
    const b = c.createOscillator(); b.type = 'triangle'; b.frequency.value = mtof(note); b.detune.value = 6;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300 * 30 ** this.cc(2, 74, 0.6);
    const rel = () => 0.05 + this.cc(2, 72, 0.4) * 2.5;
    const e = this.env(t, 0.22 * vel, 0.01, rel);
    a.connect(f); b.connect(f); f.connect(e.g); this.send(e.g);
    a.start(t); b.start(t);
    return { start: t, stop: (s) => { e.stop(s); const end = s + rel() * 1.5 + 0.1; a.stop(end); b.stop(end); } };
  }

  private lead(channel: number, note: number, vel: number, t: number): Voice {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = mtof(note);
    const lfo = c.createOscillator(); lfo.frequency.value = 5.5;
    const depth = c.createGain(); depth.gain.value = this.cc(channel, 1, 0.2) * 40; // cents
    lfo.connect(depth); depth.connect(o.detune);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3; f.frequency.value = 400 * 20 ** this.cc(channel, 74, 0.7);
    const e = this.env(t, 0.13 * vel, 0.01, () => 0.25);
    o.connect(f); f.connect(e.g); this.send(e.g);
    o.start(t); lfo.start(t);
    return { start: t, stop: (s) => { e.stop(s); o.stop(s + 0.5); lfo.stop(s + 0.5); } };
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number, out: AudioNode): void {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    n.connect(f); f.connect(g); g.connect(out);
    n.start(t); n.stop(t + decay + 0.05);
  }

  private drum(note: number, vel: number, t: number): void {
    const c = this.ctx;
    const out = c.createGain(); out.gain.value = vel;
    out.connect(this.drumFilter);
    out.connect(this.reverbSend);
    if (note === 36) { // kick
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = c.createGain(); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.5);
      // keep the kick out of the reverb
      out.disconnect(this.reverbSend);
    } else if (note === 38) { // snare
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
      const g = c.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.15);
      this.noiseHit(t, 'bandpass', 1800, 0.8, 0.7, 0.18, out);
    } else if (note === 39) { // clap: three quick bursts and a tail
      for (const d of [0, 0.011, 0.023]) this.noiseHit(t + d, 'bandpass', 1200, 1.5, 0.6, 0.03, out);
      this.noiseHit(t + 0.03, 'bandpass', 1200, 1.2, 0.5, 0.2, out);
    } else if (note === 42) { // closed hat
      this.noiseHit(t, 'highpass', 7500, 0.7, 0.35, 0.05, out);
    } else if (note === 46) { // open hat
      this.noiseHit(t, 'highpass', 7000, 0.7, 0.3, 0.35, out);
    } else { // rim
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 820;
      const g = c.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.06);
    }
  }
}
