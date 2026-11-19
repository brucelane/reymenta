// The two languages of the phone page. The first choice follows the phone (navigator.language), then the
// FR | EN switch; the choice is kept on the phone.

export type Lang = 'fr' | 'en';

const TEXTS = {
  fr: {
    tagline: 'Jouez avec le set depuis votre téléphone',
    join: 'Rejoindre le show',
    workshop: 'Atelier : setlists, tablatures, fretboard (hors ligne)',
    server: 'Serveur (adresse du PC du show)',
    search: { searching: 'Recherche du serveur sur le Wi-Fi…', found: 'Serveur trouvé', notfound: 'Pas de serveur sur ce Wi-Fi : connexion par internet (ou tapez son adresse)' },
    joining: 'Connexion…',
    waiting: 'Connecté : en attente du show (il n\'a pas encore commencé).',
    youAre: 'Vous êtes',
    place: (slot: number, count: number) => `cercle ${slot + 1} sur ${count}`,
    reconnecting: 'Reconnexion…',
    gateClosed: 'La salle est fermée pour le moment : elle ouvre pendant le show.',
    gateOpensAt: (time: string) => `La salle ouvre à ${time}.`,
    gateCode: 'Entrez le code affiché sur l\'écran (sous le QR code) :',
    codeOk: 'Entrer',
    gateCaptcha: 'Vérification anti-robot en cours ou refusée : nouvel essai dans un instant.',
    full: 'La salle est pleine pour le moment, réessayez dans un instant.',
    sensorsOff: 'Capteurs de mouvement non disponibles : touchez l\'écran pour jouer.',
    hint: 'Inclinez, secouez, touchez l\'écran : votre cercle bouge sur l\'écran géant.',
    privacy: 'Seuls des nombres quittent votre téléphone (inclinaison, toucher). Rien n\'est gardé après la soirée.',
    privacyLink: 'Confidentialité',
    googlePlay: 'Application Android',
    tab: 'Tab basse',
    tabWaiting: "Pas de morceau en cours : la tablature apparaît dès qu'un morceau joue (Cinder ou la WebApp).",
    tabNone: "Ce morceau n'a pas de tablature de basse.",
    tabStopped: "à l'arrêt",
  },
  en: {
    tagline: 'Play along with the set from your phone',
    join: 'Join the show',
    workshop: 'Workshop: setlists, tabs, fretboard (offline)',
    server: 'Server (the show PC\'s address)',
    search: { searching: 'Looking for the server on the Wi-Fi…', found: 'Server found', notfound: 'No server on this Wi-Fi: connecting over the internet (or type its address)' },
    joining: 'Connecting…',
    waiting: 'Connected: waiting for the show (it hasn\'t started yet).',
    youAre: 'You are',
    place: (slot: number, count: number) => `circle ${slot + 1} of ${count}`,
    reconnecting: 'Reconnecting…',
    gateClosed: 'The room is closed for now: it opens during the show.',
    gateOpensAt: (time: string) => `The room opens at ${time}.`,
    gateCode: 'Type the code shown on the screen (under the QR code):',
    codeOk: 'Enter',
    gateCaptcha: 'Robot check in progress or refused: trying again in a moment.',
    full: 'The room is full right now, try again in a moment.',
    sensorsOff: 'Motion sensors unavailable: touch the screen to play.',
    hint: 'Tilt, shake, touch the screen: your circle moves on the big screen.',
    privacy: 'Only numbers leave your phone (tilt, touch). Nothing is kept after the evening.',
    privacyLink: 'Privacy',
    googlePlay: 'Android app',
    tab: 'Bass tab',
    tabWaiting: 'No track playing: the tab shows up as soon as a track plays (Cinder or the WebApp).',
    tabNone: 'This track has no bass tab.',
    tabStopped: 'stopped',
  },
};

export type Texts = (typeof TEXTS)['fr'];

export function texts(lang: Lang): Texts { return TEXTS[lang]; }

export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('reymenta:lang');
    if (saved === 'fr' || saved === 'en') return saved;
  } catch { /* storage blocked */ }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function saveLang(lang: Lang) {
  try { localStorage.setItem('reymenta:lang', lang); } catch { /* storage blocked */ }
}
