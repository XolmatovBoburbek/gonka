// Разметка трассы "Кленовый Перевал" (без зависимостей от DOM — используется и в тестах).
// Горный серпантин-тогэ, собранный из прямых и дуг с точными радиусами (как дорожный проект):
// вершина со стартом → скоростная дуга вниз → связка S-поворотов → серпантин из четырёх шпилек →
// карусель вокруг смотровой площадки → прямая с бустерами → подъём «змейкой» обратно на вершину.
// Ход по часовой стрелке (вид сверху: +x — восток, +z — юг).

// [тип, длина | радиус, угол°, высота в конце, ширина, метка]; 'S' — прямая, 'L'/'R' — дуга влево/вправо.
// Длина null — "свободная" прямая: две такие прямые подбираются так, чтобы петля замкнулась.
// Высота null — линейно между соседними заданными.
const PLAN = [
  ['S', 50, 0, 58, null, 'summit'], // вершина: от старта на восток
  ['R', 60, 90, 54, null, 'sweeper'], // скоростная дуга вниз на юг
  ['S', 18, 0, null],
  ['R', 44, 40, null, null, 'esses1'], // связка S-поворотов: занос перекладывается из стороны в сторону
  ['S', 5, 0, null, null, 'esses1'],
  ['L', 42, 90, null, null, 'esses1'],
  ['S', 5, 0, null, null, 'esses1'],
  ['R', 42, 90, null, null, 'esses1'],
  ['S', 5, 0, null, null, 'esses1'],
  ['L', 44, 40, 43, null, 'esses1'],
  ['S', 52, 0, 39], // серпантин: четыре шпильки подряд
  ['R', 22, 180, 38, 25, 'hairpin'],
  ['S', 55, 0, 33.5],
  ['L', 22, 180, 32.5, 25, 'hairpin'],
  ['S', 55, 0, 28],
  ['R', 22, 180, 27, 25, 'hairpin'],
  ['S', 55, 0, 22.5],
  ['L', 22, 180, 21.5, 25, 'hairpin'],
  ['S', 58, 0, 16.5],
  ['R', 44, 180, 24, 24, 'carousel'], // карусель вокруг смотровой горки
  ['S', null, 0, 33, null, 'straight'], // прямая с бустерами (подбирается по z)
  ['L', 46, 50, null, null, 'esses2'], // подъём змейкой
  ['S', 6, 0, null, null, 'esses2'],
  ['R', 46, 100, null, null, 'esses2'],
  ['S', 6, 0, null, null, 'esses2'],
  ['L', 46, 50, 48, null, 'esses2'],
  ['S', 14, 0, null],
  ['R', 46, 90, 55, null, 'corner'],
  ['S', null, 0, 58, null, 'summit'], // стартовая прямая перед линией (подбирается по x)
];

const WIDTH = 22;
const STEP = 9; // шаг контрольных точек, м
const SMOOTH = 26; // полуширина сглаживания профиля высот, м

function segLength(seg, free, k, plan) {
  const [type, a, deg] = seg;
  if (type !== 'S') return (a * deg * Math.PI) / 180;
  if (a !== null) return a;
  return free[plan.slice(0, k).filter((q) => q[0] === 'S' && q[1] === null).length];
}

function walk(plan, free, emit) {
  let x = 0;
  let z = 0;
  let psi = Math.PI / 2; // курс: направление (sin ψ, cos ψ); восток
  let s = 0;
  plan.forEach((seg, k) => {
    const [type, a, deg] = seg;
    const len = segLength(seg, free, k, plan);
    if (type === 'S') {
      const dx = Math.sin(psi);
      const dz = Math.cos(psi);
      const n = Math.max(1, Math.round(len / STEP));
      for (let i = 1; i <= n; i++) emit && emit(k, x + (dx * len * i) / n, z + (dz * len * i) / n, s + (len * i) / n);
      x += dx * len;
      z += dz * len;
    } else {
      const R = a;
      const ang = (deg * Math.PI) / 180;
      const sgn = type === 'L' ? 1 : -1; // влево — курс растёт
      // центр дуги — слева/справа от курса
      const cx = x + sgn * Math.cos(psi) * R;
      const cz = z - sgn * Math.sin(psi) * R;
      const n = Math.max(2, Math.ceil(Math.max(len / STEP, deg / 15)));
      for (let i = 1; i <= n; i++) {
        const p = psi + (sgn * ang * i) / n;
        emit && emit(k, cx - sgn * Math.cos(p) * R, cz + sgn * Math.sin(p) * R, s + (len * i) / n);
      }
      psi += sgn * ang;
      x = cx - sgn * Math.cos(psi) * R;
      z = cz + sgn * Math.sin(psi) * R;
    }
    s += len;
  });
  return { x, z, psi, s };
}

/** Длины свободных прямых: конец пути должен совпасть с началом. */
function solveFree(plan) {
  const dirs = [];
  let psi = Math.PI / 2;
  for (const [type, a, deg] of plan) {
    if (type === 'S' && a === null) dirs.push([Math.sin(psi), Math.cos(psi)]);
    else if (type !== 'S') psi += (type === 'L' ? 1 : -1) * ((deg * Math.PI) / 180);
  }
  const end = walk(plan, [0, 0]);
  // a·d1 + b·d2 = −end
  const [d1, d2] = dirs;
  const det = d1[0] * d2[1] - d1[1] * d2[0];
  const a = (-end.x * d2[1] + end.z * d2[0]) / det;
  const b = (-end.z * d1[0] + end.x * d1[1]) / det;
  return [a, b];
}

function build(plan) {
  const free = solveFree(plan);
  const pts = [[0, 0, 0]];
  const ss = [0];
  const seg = [0];
  walk(plan, free, (k, x, z, s) => {
    pts.push([x, 0, z]);
    ss.push(s);
    seg.push(k);
  });
  const L = ss.pop();
  pts.pop(); // последняя точка совпадает со стартом
  seg.pop();

  // профиль высот: ломаная по заданным точкам → двойное скользящее среднее (петля замкнута)
  const keys = [];
  const marks = {};
  let s = 0;
  plan.forEach((sg, k) => {
    const len = segLength(sg, free, k, plan);
    const tag = sg[5];
    if (tag) {
      const list = (marks[tag] = marks[tag] || []);
      const last = list[list.length - 1];
      if (last && Math.abs(last[1] - s / L) < 1e-6) last[1] = (s + len) / L;
      else list.push([s / L, (s + len) / L]);
    }
    s += len;
    if (sg[3] !== null && sg[3] !== undefined) keys.push([s, sg[3]]);
  });
  const yRaw = (q) => {
    q = ((q % L) + L) % L;
    let prev = keys[keys.length - 1];
    let prevS = prev[0] - L;
    for (const kk of keys) {
      if (q <= kk[0]) return prev[1] + ((kk[1] - prev[1]) * (q - prevS)) / (kk[0] - prevS || 1);
      prev = kk;
      prevS = kk[0];
    }
    const first = keys[0];
    return prev[1] + ((first[1] - prev[1]) * (q - prevS)) / (first[0] + L - prevS || 1);
  };
  const M = Math.ceil(L);
  let prof = Float64Array.from({ length: M }, (_, i) => yRaw((i * L) / M));
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      let sum = 0;
      for (let k = -SMOOTH; k <= SMOOTH; k++) sum += prof[(i + k + M) % M];
      out[i] = sum / (2 * SMOOTH + 1);
    }
    prof = out;
  }
  const yAt = (q) => {
    const f = ((((q / L) * M) % M) + M) % M;
    const i = Math.floor(f);
    const t = f - i;
    return prof[i] * (1 - t) + prof[(i + 1) % M] * t;
  };
  const widths = [];
  for (let i = 0; i < pts.length; i++) {
    pts[i] = [+pts[i][0].toFixed(2), +yAt(ss[i]).toFixed(2), +pts[i][2].toFixed(2)];
    widths.push(plan[seg[i]][4] ?? WIDTH);
  }
  // ширина плавно меняется за пару шагов
  const wSm = widths.map((_, i) => {
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += widths[(i + k + widths.length) % widths.length];
    return +(sum / 5).toFixed(2);
  });
  return { points: pts, widths: wSm, free, marks };
}

const built = build(PLAN);

/** Участки трассы в долях круга: { hairpin: [[f0,f1]×4], carousel, esses1, esses2, straight, summit, … } */
export const MOMIJI_MARKS = built.marks;
export const MOMIJI_FREE = built.free;

export const momijiLayout = {
  track: {
    points: built.points,
    widths: built.widths,
    width: WIDTH,
    shoulder: 5,
    bankFactor: 4,
    maxBank: 0.1,
  },
};
