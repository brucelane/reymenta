// What the Visuals and Strudel roles of the online Jam start from (2026-11-26): short, commented, in the player's
// language, and in tune with the room (A minor pentatonic, the room's tempo is set by the page).
import type { Lang } from '../../i18n';

export function hydraStarter(lang: Lang): string {
  return lang === 'fr'
    ? `// Les visuels de la salle : tout le monde les voit derrière les pads.
// room.kick, room.snare, room.hat, room.bass, room.keys, room.lead, room.any :
// 0 à 1, ils sautent à chaque note jouée dans la salle puis retombent.
osc(8, 0.05, 1.2)
  .color(0.5, 0.2, 0.9)                              // violet
  .modulate(noise(3, 0.1), () => 0.1 + room.bass * 0.4) // la basse tord l'image
  .kaleid(() => 4 + Math.round(room.keys * 4))       // les claviers ajoutent des facettes
  .scale(() => 1 + room.kick * 0.3)                  // la grosse caisse fait pulser
  .brightness(() => -0.35 + room.any * 0.3)
  .out(o0)
`
    : `// The room's visuals: everyone sees them behind the pads.
// room.kick, room.snare, room.hat, room.bass, room.keys, room.lead, room.any:
// 0 to 1, they jump on each note played in the room, then fall back.
osc(8, 0.05, 1.2)
  .color(0.5, 0.2, 0.9)                              // violet
  .modulate(noise(3, 0.1), () => 0.1 + room.bass * 0.4) // the bass bends the picture
  .kaleid(() => 4 + Math.round(room.keys * 4))       // the keys add facets
  .scale(() => 1 + room.kick * 0.3)                  // the kick pulses
  .brightness(() => -0.35 + room.any * 0.3)
  .out(o0)
`;
}

export function strudelStarter(lang: Lang): string {
  return lang === 'fr'
    ? `// Votre partie Strudel : une ligne $: par motif. Le tempo est celui de la salle
// (un cycle = une mesure), la gamme : la mineur pentatonique (a c d e g).
$: s("bd*2, [~ sd]*2, hh*8").bank("RolandTR909").gain(0.8)
$: note("<a1 [~ a1] c2 [e2 g1]>*2").s("sawtooth").lpf(700).gain(0.45)
`
    : `// Your Strudel part: one $: line per pattern. The tempo is the room's
// (one cycle = one bar), the scale: A minor pentatonic (a c d e g).
$: s("bd*2, [~ sd]*2, hh*8").bank("RolandTR909").gain(0.8)
$: note("<a1 [~ a1] c2 [e2 g1]>*2").s("sawtooth").lpf(700).gain(0.45)
`;
}

/** strudel-flow's own tempo line goes: the room sets the tempo */
export const stripTempo = (code: string) => code.split('\n').filter((l) => !/^\s*set(cps|cpm)\s*\(/.test(l)).join('\n').trim();
