// SVG-иконки предметов (рисованные, в аниме-стиле).
export const ITEM_ICONS = {
  turbo: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <linearGradient id="gT1" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff3d2e"/><stop offset="0.6" stop-color="#ff8a1f"/><stop offset="1" stop-color="#ffd84a"/></linearGradient>
      <linearGradient id="gT2" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffe98a"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
    </defs>
    <path d="M50 6 C62 26 80 36 76 62 C73 82 60 94 50 94 C38 94 24 84 24 64 C24 50 32 44 36 34 C40 44 44 48 48 48 C44 34 44 20 50 6 Z" fill="url(#gT1)" stroke="#5a1320" stroke-width="5" stroke-linejoin="round"/>
    <path d="M50 44 C58 56 64 62 62 74 C60 84 55 88 50 88 C44 88 38 83 38 74 C38 66 44 62 46 56 C48 60 50 60 51 58 C50 54 49 50 50 44 Z" fill="url(#gT2)"/>
    <path d="M14 30 L30 34 M10 50 L24 50 M14 70 L28 66" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.9"/>
  </svg>`,
  orb: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <radialGradient id="gO1" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#ff9ff0"/><stop offset="1" stop-color="#c2189a"/></radialGradient>
    </defs>
    <circle cx="50" cy="52" r="34" fill="url(#gO1)" stroke="#4a0b3e" stroke-width="5"/>
    <path d="M50 30 L56 45 L72 46 L60 56 L64 72 L50 63 L36 72 L40 56 L28 46 L44 45 Z" fill="#fff38a" stroke="#8a4a00" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="38" cy="36" r="6" fill="#fff" opacity="0.9"/>
    <path d="M82 18 L85 26 L93 29 L85 32 L82 40 L79 32 L71 29 L79 26 Z" fill="#fff38a"/>
    <path d="M16 72 L18 77 L23 79 L18 81 L16 86 L14 81 L9 79 L14 77 Z" fill="#fff"/>
  </svg>`,
  shield: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <radialGradient id="gS1" cx="0.5" cy="0.45" r="0.6"><stop offset="0" stop-color="#e6fbff" stop-opacity="0.95"/><stop offset="0.7" stop-color="#6fe0ff"/><stop offset="1" stop-color="#1f8adf"/></radialGradient>
    </defs>
    <path d="M50 6 L88 28 L88 72 L50 94 L12 72 L12 28 Z" fill="url(#gS1)" stroke="#0e3a6a" stroke-width="5" stroke-linejoin="round"/>
    <path d="M50 22 L74 36 L74 64 L50 78 L26 64 L26 36 Z" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.8"/>
    <path d="M30 32 Q36 22 48 20" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M44 50 L50 44 L56 50 L50 62 Z" fill="#fff"/>
  </svg>`,
  ice: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <linearGradient id="gI1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#9fe8ff"/><stop offset="1" stop-color="#3aa8ff"/></linearGradient>
    </defs>
    <path d="M50 8 L62 40 L50 90 L38 40 Z" fill="url(#gI1)" stroke="#0e3a6a" stroke-width="4" stroke-linejoin="round"/>
    <path d="M26 30 L36 52 L30 86 L18 56 Z" fill="url(#gI1)" stroke="#0e3a6a" stroke-width="4" stroke-linejoin="round"/>
    <path d="M74 30 L82 56 L70 86 L64 52 Z" fill="url(#gI1)" stroke="#0e3a6a" stroke-width="4" stroke-linejoin="round"/>
    <path d="M50 16 L54 40 L50 60" stroke="#fff" stroke-width="3" fill="none" opacity="0.9"/>
    <path d="M86 12 L88 18 L94 20 L88 22 L86 28 L84 22 L78 20 L84 18 Z" fill="#fff"/>
  </svg>`,
};

export const ITEM_NAMES = {
  turbo: 'Турбо',
  orb: 'Звёздная сфера',
  shield: 'Барьер',
  ice: 'Ледяная ловушка',
};

export const SAKURA_LOGO = `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="translate(50 50)">${[0, 72, 144, 216, 288]
  .map(
    (a) =>
      `<path transform="rotate(${a})" d="M0 -8 C10 -18 16 -34 6 -44 L0 -38 L-6 -44 C-16 -34 -10 -18 0 -8 Z" fill="#ffb3d1" stroke="#e0508a" stroke-width="3" stroke-linejoin="round"/>`
  )
  .join('')}<circle r="7" fill="#ffd84a" stroke="#e0508a" stroke-width="3"/></g></svg>`;
