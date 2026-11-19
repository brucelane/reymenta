// hydra-synth (1.4.0, AGPL) ships no type declarations: what the Workshop's Hydra section uses.
declare module 'hydra-synth' {
  export interface HydraInput { name: string; type: string; default?: unknown }
  export default class Hydra {
    constructor(options?: {
      canvas?: HTMLCanvasElement; width?: number; height?: number; makeGlobal?: boolean; autoLoop?: boolean;
      detectAudio?: boolean; enableStreamCapture?: boolean; precision?: 'lowp' | 'mediump' | 'highp'; numSources?: number; numOutputs?: number;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    synth: Record<string, any>;
    detectAudio: boolean;
    canvas: HTMLCanvasElement;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    regl: { destroy(): void; [k: string]: any };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s: Array<{ clear(): void; [k: string]: any }>;
    tick(dt: number): void;
    hush(): void;
    setResolution(width: number, height: number): void;
    _initAudio(): void;
  }
}
declare module 'hydra-synth/src/glsl/glsl-functions.js' {
  /** hydra-synth's own function list: every Hydra function it generates (name, type, inputs with defaults) */
  const list: () => Array<{ name: string; type: string; inputs: Array<{ name: string; type: string; default?: unknown }>; glsl: string }>;
  export default list;
}
