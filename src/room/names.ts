// Random player names, the same one in both languages ("Renard bleu" / "Blue fox"): nobody types a name,
// so nothing offensive can reach the screen. Picked from the phone's id, so a reconnect keeps the name.

const ANIMALS: Array<[fr: string, en: string, feminine: boolean]> = [
  ['Renard', 'fox', false], ['Poulpe', 'octopus', false], ['Loutre', 'otter', true], ['Hibou', 'owl', false],
  ['Baleine', 'whale', true], ['Lynx', 'lynx', false], ['Méduse', 'jellyfish', true], ['Panda', 'panda', false],
  ['Gecko', 'gecko', false], ['Tortue', 'turtle', true], ['Corbeau', 'raven', false], ['Abeille', 'bee', true],
  ['Dauphin', 'dolphin', false], ['Libellule', 'dragonfly', true], ['Yak', 'yak', false], ['Mouette', 'gull', true],
];

const COLOURS: Array<[frM: string, frF: string, en: string, hue: number]> = [
  ['rouge', 'rouge', 'Red', 0], ['orange', 'orange', 'Orange', 30], ['doré', 'dorée', 'Golden', 50],
  ['vert', 'verte', 'Green', 120], ['turquoise', 'turquoise', 'Teal', 170], ['bleu', 'bleue', 'Blue', 220],
  ['violet', 'violette', 'Purple', 275], ['rose', 'rose', 'Pink', 320],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function nameFor(id: string): { fr: string; en: string; hue: number } {
  const h = hash(id);
  const [frA, enA, fem] = ANIMALS[h % ANIMALS.length];
  const [frM, frF, enC, hue] = COLOURS[Math.floor(h / ANIMALS.length) % COLOURS.length];
  return { fr: `${frA} ${fem ? frF : frM}`, en: `${enC} ${enA}`, hue };
}
