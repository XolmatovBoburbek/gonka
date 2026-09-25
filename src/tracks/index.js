// Реестр локаций: метаданные для меню + ленивая загрузка модулей самих трасс.
export const TRACKS = [
  {
    id: 'sakura',
    name: 'Сакура-Долина',
    jp: '桜の谷',
    time: 'Солнечный день',
    card: ['#ff9cc8', '#8fd0ff'],
    load: () => import('./sakura.js').then((m) => m.sakura),
  },
  {
    id: 'neon',
    name: 'Неон-Токио',
    jp: 'ネオン東京',
    time: 'Ночной город',
    card: ['#8a3cff', '#ff3ad0'],
    load: () => import('./neon.js').then((m) => m.neon),
  },
  {
    id: 'sunset',
    name: 'Закатный Берег',
    jp: '夕焼け海岸',
    time: 'Золотой закат',
    card: ['#ff9a3c', '#ff4f9a'],
    load: () => import('./sunset.js').then((m) => m.sunset),
  },
];

export function getTrackMeta(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}

const cache = new Map();
export async function loadTrack(id) {
  const meta = getTrackMeta(id);
  if (!cache.has(meta.id)) cache.set(meta.id, await meta.load());
  return cache.get(meta.id);
}
