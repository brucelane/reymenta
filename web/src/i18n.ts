// The two languages of the phone page. The first choice follows the phone (navigator.language), then the
// FR | EN switch; the choice is kept on the phone.

export type Lang = 'fr' | 'en';

const TEXTS = {
  fr: {
    tagline: 'Jouez avec le set depuis votre téléphone',
    join: 'Rejoindre le show',
    server: 'Serveur (adresse du PC du show)',
    search: { searching: 'Recherche du serveur sur le Wi-Fi…', found: 'Serveur trouvé', notfound: 'Pas de serveur sur ce Wi-Fi : connexion par internet (ou tapez son adresse)' },
    joining: 'Connexion…',
    youAre: 'Vous êtes',
    place: (slot: number, count: number) => `cercle ${slot + 1} sur ${count}`,
    reconnecting: 'Reconnexion…',
    full: 'La salle est pleine pour le moment, réessayez dans un instant.',
    sensorsOff: 'Capteurs de mouvement non disponibles : touchez l\'écran pour jouer.',
    hint: 'Inclinez, secouez, touchez l\'écran : votre cercle bouge sur l\'écran géant.',
    privacy: 'Seuls des nombres quittent votre téléphone (inclinaison, toucher). Rien n\'est gardé après la soirée.',
    privacyLink: 'Confidentialité',
  },
  en: {
    tagline: 'Play along with the set from your phone',
    join: 'Join the show',
    server: 'Server (the show PC\'s address)',
    search: { searching: 'Looking for the server on the Wi-Fi…', found: 'Server found', notfound: 'No server on this Wi-Fi: connecting over the internet (or type its address)' },
    joining: 'Connecting…',
    youAre: 'You are',
    place: (slot: number, count: number) => `circle ${slot + 1} of ${count}`,
    reconnecting: 'Reconnecting…',
    full: 'The room is full right now, try again in a moment.',
    sensorsOff: 'Motion sensors unavailable: touch the screen to play.',
    hint: 'Tilt, shake, touch the screen: your circle moves on the big screen.',
    privacy: 'Only numbers leave your phone (tilt, touch). Nothing is kept after the evening.',
    privacyLink: 'Privacy',
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
