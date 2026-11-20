// The microphone for the tuner and the practice modes (2026-11-20): a stream without the voice processing phones
// apply by default (echo cancelling, noise suppression and auto gain flatten a bass note), an AnalyserNode, and a
// poll of its samples. Its own AudioContext, so it doesn't touch Strudel's (practice plays and listens at once).
// open() must be called from a tap (the permission prompt and the AudioContext both need the user's gesture).
import { detectPitch, type Pitch } from './pitch';

export interface Mic {
  /** the latest reading (undefined: silence or no clear pitch) */
  read(): Pitch | undefined;
  /** the context's clock, in seconds (for the practice timing) */
  now(): number;
  /** play a reference tone (MIDI frequency) for `seconds` */
  tone(freq: number, seconds?: number): void;
  close(): void;
}

const WINDOW = 4096;

export async function openMic(): Promise<Mic> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no microphone access in this browser (https needed)');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = WINDOW;
  source.connect(analyser);
  const buf = new Float32Array(WINDOW);
  return {
    read() {
      analyser.getFloatTimeDomainData(buf);
      return detectPitch(buf, ctx.sampleRate);
    },
    now: () => ctx.currentTime,
    tone(freq, seconds = 2) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
      gain.gain.setValueAtTime(0.3, t + seconds - 0.3);
      gain.gain.linearRampToValueAtTime(0, t + seconds);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + seconds + 0.05);
    },
    close() {
      stream.getTracks().forEach((tr) => tr.stop());
      void ctx.close().catch(() => undefined);
    },
  };
}
