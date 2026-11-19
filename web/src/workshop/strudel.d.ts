// @strudel/* ship no type declarations: what the Workshop's engine uses (copied from the WebApp's src/lib/strudel.d.ts).
declare module '@strudel/web/web.mjs' {
  export function initStrudel(options?: { prebake?: () => Promise<unknown> | void; [key: string]: unknown }): Promise<unknown>;
  export function evaluate(code: string, autoplay?: boolean): Promise<unknown>;
  export function hush(): void;
  export function samples(source: string | Record<string, unknown>, baseUrl?: string): Promise<unknown>;
  export function aliasBank(...args: unknown[]): Promise<unknown>;
  export function getTime(): number;
  export function getAudioContext(): AudioContext;
  export function noteToMidi(note: string, defaultOctave?: number): number;
  /** Strudel's pattern class (@strudel/core), for src/core/bassist.mjs */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Pattern: { prototype: Record<string, any> };
  export const Hap: unknown;
  export const TimeSpan: unknown;
}
declare module '@strudel/soundfonts' {
  export function registerSoundfonts(): void;
  export function setSoundfontUrl(url: string): void;
}
// Node tests only (test/strudel.test.ts): the same packages @strudel/web 1.3.0 bundles, untyped
declare module '@strudel/core';
declare module '@strudel/mini';
declare module '@strudel/transpiler';
