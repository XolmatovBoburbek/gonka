// Локация 4: "Кленовый Перевал" — осеннее утро на горном перевале над морем облаков: серпантин-тогэ
// для дрифта (связки S-поворотов, четыре шпильки подряд, карусель вокруг смотровой горки), клёны-момидзи,
// золотые гинкго и тёмные криптомерии, каменные подпорные стенки, деревянный мост над ручьём с водопадом,
// чайный домик на вершине, святилище над каруселью, соседние вершины-острова и листопад.
import * as THREE from 'three';
import { momijiLayout, MOMIJI_MARKS } from './momijiLayout.js';
import { createSky, createLights, createMountainRing, mulberry32 } from '../world/sky.js';
import { buildTerrain } from '../world/terrain.js';
import { createNoise2D, fbm, smoothstep, lerp } from '../world/noise.js';
import { makePines, makeRocks, makeBushes, makeStoneLanterns, makeNobori, makeToriiRow, createAmbientParticles, scatterAround } from '../world/props.js';
import {
  makeMapleForest,
  makeGinkgo,
  makeSusuki,
  makeCloudSea,
  makeCloudPuffs,
  makePeaks,
  makeChevronBoards,
  makeCurveMirrors,
  makeRoadSigns,
  makeTeaHouse,
  makeShrine,
  makeRetainingWalls,
  makeStream,
} from './momijiProps.js';

const CLOUD_Y = -6; // уровень моря облаков (клубы поднимаются почти до нижней точки трассы)
const FOG = 0xf4dccc;
const M = MOMIJI_MARKS;
const mid = ([a, b]) => (a + b) / 2;

// ---------------------------------------------------------------- рельеф горы
/**
 * Высоты вокруг трассы. У дороги — взвешенное среднее высот всех проходящих рядом веток трассы
 * (вес — по расстоянию до кромки каждой ветки): между ногами серпантина склон плавно идёт
 * от верхней ветки к нижней, без ступенек. Внутри петли — лесистая вершина, снаружи — обрыв в облака.
 * features: [{x, z, r, y}] — площадки (чайный домик, святилище); bumps: [{x, z, r, h}] — горки;
 * hills: [{x, z, r, h}] — соседние вершины над облаками; carves: [{pts, bank}] — русла (дно по ломаной).
 */
function mountainField(track, { features = [], bumps = [], hills = [], carves = [] } = {}) {
  const N = track.count;
  const STEP = 2; // берём каждый 2-й сэмпл
  const CH = 4; // кусок трассы = 4 прореженных сэмпла (~12 м); локальные минимумы расстояния по кускам — отдельные ветки
  const R = 75;
  const cell = 22;
  const key = (cx, cz) => cx * 73856093 + cz * 19349663;
  const grid = new Map();
  for (let i = 0; i < N; i += STEP) {
    const p = track.pos[i];
    const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  }
  const nCh = Math.ceil(N / (STEP * CH));
  const dBest = new Float32Array(nCh).fill(Infinity);
  const iBest = new Int32Array(nCh);
  const touched = [];
  // контур петли по оси — для "внутри/снаружи"
  const poly = [];
  for (let i = 0; i < N; i += 6) poly.push(track.pos[i].x, track.pos[i].z);
  const insideLoop = (x, z) => {
    let inside = false;
    const n = poly.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[i * 2];
      const zi = poly[i * 2 + 1];
      const xj = poly[j * 2];
      const zj = poly[j * 2 + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  // дальнее поле: сглаженная высота трассы вокруг (обратные квадраты расстояний до редких сэмплов)
  const far = [];
  for (let i = 0; i < N; i += 16) far.push(track.pos[i]);
  const nA = createNoise2D(31);
  const nB = createNoise2D(57);
  const out = { h: 0, d: 0, inside: false, near: false };

  function sample(x, z) {
    for (const c of touched) dBest[c] = Infinity;
    touched.length = 0;
    const cx0 = Math.floor((x - R) / cell);
    const cx1 = Math.floor((x + R) / cell);
    const cz0 = Math.floor((z - R) / cell);
    const cz1 = Math.floor((z + R) / cell);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const arr = grid.get(key(cx, cz));
        if (!arr) continue;
        for (const i of arr) {
          const P = track.pos[i];
          const dx = x - P.x;
          const dz = z - P.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > R * R) continue;
          const d = Math.sqrt(d2) - (track.hw[i] + track.wall[i] + 1.2);
          const c = (i / (STEP * CH)) | 0;
          if (dBest[c] === Infinity) touched.push(c);
          if (d < dBest[c]) {
            dBest[c] = d;
            iBest[c] = i;
          }
        }
      }
    }
    let wS = 0;
    let yS = 0;
    let dMin = Infinity;
    for (const c of touched) {
      const d = dBest[c];
      if (!(d < dBest[(c - 1 + nCh) % nCh] && d <= dBest[(c + 1) % nCh])) continue;
      const i = iBest[c];
      const P = track.pos[i];
      const Rv = track.right[i];
      const e = track.hw[i] + track.wall[i] + 1.2;
      const lat = THREE.MathUtils.clamp((x - P.x) * Rv.x + (z - P.z) * Rv.z, -e, e);
      const dd = Math.max(0, d);
      const w = 1 / (dd * dd + 0.05);
      wS += w;
      yS += w * (P.y + Rv.y * lat);
      if (d < dMin) dMin = d;
    }
    let fw = 0;
    let fy = 0;
    let fd = Infinity;
    for (const P of far) {
      const q = (x - P.x) ** 2 + (z - P.z) ** 2;
      const w = 1 / (q + 900);
      fw += w;
      fy += w * P.y;
      if (q < fd) fd = q;
    }
    const yFar = fy / fw;
    const near = wS > 0;
    const yNear = near ? yS / wS : yFar;
    // за радиусом выборки — расстояние по редким сэмплам (у границы оба способа почти совпадают)
    const d = near ? Math.max(0, dMin) : Math.max(0, Math.sqrt(fd) - 17.2);
    const inside = insideLoop(x, z);
    let h;
    if (inside) {
      // лесистая вершина внутри петли: чем дальше от дорог, тем выше
      const base = lerp(yNear, yFar, smoothstep(10, R - 22, d));
      h = base + 24 * smoothstep(6, 110, d) + fbm(nA, x / 110, z / 110, 3) * 9 * smoothstep(6, 45, d);
    } else {
      // снаружи: полка у отбойника, крутая бровка, дальше лесистый склон под облака; отроги — неровный край
      const yRef = lerp(yNear, yFar, smoothstep(25, R - 22, d));
      const drop = 9 * smoothstep(3, 20, d) + Math.max(0, d - 10) * 0.42 + Math.max(0, d - 70) ** 2 * 0.0035;
      const spur = Math.max(0, fbm(nB, x / 170, z / 170, 3)) * 34 * smoothstep(10, 60, d) * (1 - smoothstep(170, 280, d));
      h = yRef - drop + spur + fbm(nA, x / 50, z / 50, 2) * 5 * smoothstep(6, 30, d);
    }
    // соседние вершины, торчащие из облаков
    for (const hl of hills) {
      const q = ((x - hl.x) ** 2 + (z - hl.z) ** 2) / (hl.r * hl.r);
      if (q < 1) h = Math.max(h, CLOUD_Y - 30 + (hl.h + 30) * Math.pow(1 - q, 1.3) + fbm(nB, x / 40, z / 40, 2) * 6 * (1 - q));
    }
    for (const b of bumps) {
      const q = ((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r);
      if (q < 9) h += b.h * Math.exp(-q) * smoothstep(3, 14, d);
    }
    for (const f of features) {
      const r = Math.hypot(x - f.x, z - f.z);
      if (r < f.r + 14) h = lerp(f.y, h, smoothstep(f.r, f.r + 14, r));
    }
    // русло ручья: дно по ломаной, пологие берега
    for (const cv of carves) {
      const q = nearestOnPath(cv.pts, x, z);
      if (q.d < cv.bank + 12) h = Math.min(h, lerp(q.bed, h, smoothstep(q.half, q.half + cv.bank, q.d)));
    }
    out.h = h;
    out.d = d;
    out.inside = inside;
    out.near = near;
    return out;
  }
  return { sample, insideLoop };
}

/** Ближайшая точка ломаной [{x, z, bed, half}]: расстояние в плане, высота дна и полуширина русла там. */
const _near = { d: 0, bed: 0, half: 0, t: 0 };
function nearestOnPath(pts, x, z) {
  _near.d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)));
    const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
    if (d < _near.d) {
      _near.d = d;
      _near.bed = lerp(a.bed, b.bed, t);
      _near.half = lerp(a.half, b.half, t);
      _near.t = i + t;
    }
  }
  return _near;
}

// ---------------------------------------------------------------- ручей под деревянным мостом
// Каскад сбегает с горки внутри петли, ныряет под мост в конце прямой с бустерами и падает с обрыва в облака.
// Точки: [сдвиг поперёк трассы (+ внутрь петли), вдоль, полуширина русла, дно: {road: ниже дороги} | {ground: ниже рельефа}]
const STREAM = [
  [37, 2, 1.6, { ground: 0.6 }],
  [30, 1, 1.8, { ground: 0.9 }],
  [23, 0, 4.5, { road: 2.2 }],
  [13, 0, 2.6, { road: 4.2 }],
  [0, 0, 2.6, { road: 4.8 }],
  [-14, -1, 2.6, { road: 5.2 }],
  [-25, -2, 2.4, { ground: 1.6 }],
  [-45, -1, 2.2, { ground: 1.6 }],
  [-80, 1, 2.2, { ground: 1.6 }],
];
function streamPlan(track) {
  const fr = track.frameAtProgress((M.straight[0][1] - 0.01) * track.length, {});
  return STREAM.map(([lat, along, half, bed]) => ({
    x: fr.pos.x + fr.right.x * lat + fr.tan.x * along,
    z: fr.pos.z + fr.right.z * lat + fr.tan.z * along,
    half,
    spec: bed,
    road: fr.pos.y,
    lat,
  }));
}

// ---------------------------------------------------------------- спецэлементы трассы
const hairpins = M.hairpin;
const carousel = M.carousel[0];
const straight = M.straight[0];
const esses1 = M.esses1[0];
const esses2 = M.esses2[0];

export const momiji = {
  id: 'momiji',
  name: 'Кленовый Перевал',
  jp: '紅葉峠',
  time: 'Осеннее утро',
  description: 'Горный перевал для дрифта над морем облаков: связки S-поворотов, четыре шпильки серпантина подряд и долгая карусель вокруг смотровой горки среди алых клёнов.',
  music: 'momiji',
  card: ['#ff5a2e', '#ffc93c'],
  ...momijiLayout,
  itemRows: [0.045, esses1[1] + 0.012, straight[0] + 0.02, esses2[1] - 0.01],
  boostPads: [
    { at: straight[0] + 0.004, lateral: -4, length: 9, width: 5 },
    { at: mid(straight) + 0.01, lateral: 4, length: 9, width: 5 },
    { at: 0.955, lateral: -4.5, length: 9, width: 5 },
  ],
  ramps: [{ at: straight[1] - 0.03, lateral: -4, width: 8, length: 8, height: 1.3 }],
  theme: {
    road: { base: '#5a5c6a', grain: 0.1, edgeLine: '#fffaf0', centerLine: '#ffb42e', dashed: false },
    curb: { a: '#e8362e', b: '#ffffff', width: 1.5 },
    wall: { style: 'guard', a: 0xf6f7fb, b: 0xdfe3ea, height: 0.95 },
    deck: { color: 0x9a6a48, side: 0x6a4630, depth: 1.6 },
    gate: { pillar: 0xfff6ea, accent: 0xe0362a, bannerA: '#e0362a', bannerB: '#ffc93c', text: 'MOMIJI  TOUGE  GP' },
    boost: { a: '#39f3ff', b: '#fff7a8', intensity: 1.8 },
    ramp: { a: '#ffd84a', b: '#ffffff', side: 0xe0362a },
  },

  prepare(track) {
    // деревянный мост над ручьём в конце прямой с бустерами
    const pts = streamPlan(track).map((p) => ({ x: p.x, z: p.z, bed: 0, half: 0 }));
    track.markSections((p) => nearestOnPath(pts, p.x, p.z).d < 13, { bridge: true });
  },

  build({ scene, track, quality }) {
    const detail = quality.detail ?? 1;
    const outline = detail >= 0.8;
    const L = track.length;
    const N = track.count;
    const updaters = [];
    // солнце только встало на востоке — низко над облаками; свет для теней выше (читаемость)
    const sunDir = new THREE.Vector3(0.86, 0.15, -0.49).normalize();
    const lightDir = new THREE.Vector3(0.66, 0.6, -0.45).normalize();

    // --- небо, туман, свет
    const sky = createSky({
      top: 0x2a62d6,
      mid: 0x86b8f2,
      horizon: 0xffdcc0,
      bottom: FOG,
      midPos: 0.24,
      sunDir,
      sunColor: 0xfff2d8,
      sunBright: 3.2,
      glowColor: 0xffc27a,
      sunSize: 0.05,
      sunGlow: 1.1,
      horizonGlow: 0.55,
      cloudCover: 0.22,
      cloudScale: 0.85,
      cloudLight: 0xfff6ee,
      cloudShade: 0xc6b8e6,
      cloudRim: 0xffdcb0,
      cloudOpacity: 0.85,
    });
    scene.add(sky);
    updaters.push(sky.userData.update);
    scene.fog = new THREE.FogExp2(FOG, 0.00125);
    const lights = createLights(scene, {
      sunDir: lightDir,
      sunColor: 0xffe6c8,
      sunIntensity: 2.6,
      hemiSky: 0xc8d8ff,
      hemiGround: 0xa07a6a,
      hemiIntensity: 1.6,
      shadowExtent: 75,
    });

    // --- опорные точки: вершина (чайный домик) и горка внутри карусели (святилище)
    const fr = {};
    const frameAt = (f) => track.frameAtProgress((((f % 1) + 1) % 1) * L, fr);
    const sideXZ = (f, side, off) => {
      frameAt(f);
      const d = fr.hw + fr.wall + off;
      return { x: fr.pos.x + fr.right.x * side * d, z: fr.pos.z + fr.right.z * side * d, y: fr.pos.y, rx: fr.right.x * side, rz: fr.right.z * side, tan: fr.tan.clone() };
    };
    // центр карусели — центр кривизны её середины
    frameAt(mid(carousel));
    const carC = { x: fr.pos.x + fr.right.x * (1 / Math.abs(fr.curv)) * -Math.sign(fr.curv), z: fr.pos.z + fr.right.z * (1 / Math.abs(fr.curv)) * -Math.sign(fr.curv), y: fr.pos.y };
    const tea = sideXZ(0.972, -1, 10);
    const features = [
      { x: tea.x, z: tea.z, r: 8, y: tea.y - 0.3 },
      { x: carC.x, z: carC.z, r: 7, y: carC.y + 11 },
    ];
    const bumps = [{ x: carC.x, z: carC.z, r: 16, h: 12 }];
    // горка, с которой сбегает каскад ручья
    const stream = streamPlan(track);
    {
      const a = stream[0];
      const b = stream[1];
      const k = 7 / Math.hypot(a.x - b.x, a.z - b.z);
      bumps.push({ x: a.x + (a.x - b.x) * k, z: a.z + (a.z - b.z) * k, r: 12, h: 15 });
    }
    const center = track.bounds.getCenter(new THREE.Vector3());
    // соседние лесистые вершины-острова (h — над уровнем облаков)
    const hills = [
      [320, -250, 120, 50],
      [410, 140, 110, 34],
      [60, 430, 110, 40],
      [-300, 330, 120, 58],
      [-420, -60, 100, 30],
      [-170, -400, 120, 44],
    ].map(([dx, dz, r, h]) => ({ x: center.x + dx, z: center.z + dz, r, h }));
    const carves = [];
    const field = mountainField(track, { features, bumps, hills, carves });
    // дно ручья: под мостом — ниже дороги, на склонах — чуть ниже рельефа (до вырезания русла)
    const bed = stream.map((p) => ({
      x: p.x,
      z: p.z,
      half: p.half,
      bed: p.spec.road !== undefined ? p.road - p.spec.road : field.sample(p.x, p.z).h - p.spec.ground,
    }));
    carves.push({ pts: bed, bank: 6 });

    // --- рельеф
    const heightFn = (x, z) => field.sample(x, z).h;
    const nC = createNoise2D(5);
    const nLeaf = createNoise2D(77);
    const nGold = createNoise2D(91);
    const cGrass = new THREE.Color(0x9ea64e);
    const cGold = new THREE.Color(0xdcbc5c);
    const cRust = new THREE.Color(0xd0643c);
    const cRed = new THREE.Color(0xd8483a);
    const cGinkgo = new THREE.Color(0xf2c63e);
    const cRock = new THREE.Color(0xa296a6);
    const cRockDark = new THREE.Color(0x7a6c8e);
    const cMist = new THREE.Color(0xcfc2e4);
    const cRoad = new THREE.Color(0xb8aa78);
    const leafAt = (x, z) => nLeaf(x / 26, z / 26) + 0.35 * nLeaf(x / 9, z / 9);
    const colorFn = (x, z, h, info) => {
      const n = fbm(nC, x / 45, z / 45, 3);
      const c = cGrass.clone().lerp(cGold, THREE.MathUtils.clamp(n * 0.9 + 0.45, 0, 1));
      const lf = leafAt(x, z);
      if (lf > 0.05) c.lerp(n > 0.05 ? cRed : cRust, Math.min(0.8, (lf - 0.05) * 1.6));
      const gl = nGold(x / 34, z / 34);
      if (gl > 0.45) c.lerp(cGinkgo, Math.min(0.7, (gl - 0.45) * 2.5));
      c.lerp(cRoad, info.road * 0.35);
      const rock = THREE.MathUtils.clamp((info.slope - 0.2) * 3.2, 0, 1);
      c.lerp(n > 0 ? cRock : cRockDark, rock);
      if (h < CLOUD_Y + 14) c.lerp(cMist, THREE.MathUtils.clamp((CLOUD_Y + 14 - h) / 26, 0, 0.8));
      return c;
    };
    const terrain = buildTerrain(track, {
      size: 1100,
      segments: Math.round(220 * Math.max(0.7, detail)),
      center,
      height: heightFn,
      color: colorFn,
      blendOuter: 2,
    });
    scene.add(terrain.mesh);
    const H = terrain.heightAt;

    // --- море облаков, горы-острова, дальний хребет
    const sea = makeCloudSea({
      center,
      level: CLOUD_Y,
      sunDir,
      heightMap: terrain.heightTexture(),
      amp: 56,
      tileA: 560,
      tileB: 180,
      lit: 0xfff8f0,
      shade: 0xc2b4e6,
      deep: 0x9c8cd4,
      glow: 0xffc488,
      fogScale: 0.5,
    });
    scene.add(sea);
    updaters.push(sea.userData.update);
    const peaks = [
      { x: 900, z: -520, r: 330, h: 150, lit: 0xb08ab8, shade: 0x7a64a8, haze: 0.25 },
      { x: 1250, z: 420, r: 420, h: 210, lit: 0xa48ad0, shade: 0x6e64b0, haze: 0.35, snow: 0.84 },
      { x: -760, z: 820, r: 380, h: 170, lit: 0xa890c8, shade: 0x7066aa, haze: 0.35 },
      { x: -1500, z: -380, r: 560, h: 330, lit: 0x9c90d8, shade: 0x6a66b6, haze: 0.45, snow: 0.72 },
      { x: 140, z: 1500, r: 520, h: 260, lit: 0xa296d6, shade: 0x6c68b4, haze: 0.45, snow: 0.8 },
      { x: -300, z: -1400, r: 480, h: 240, lit: 0xa294d4, shade: 0x6e68b2, haze: 0.45 },
      { x: 2200, z: -1200, r: 700, h: 420, lit: 0xa6a0e0, shade: 0x7a74c0, haze: 0.55, snow: 0.66 },
      { x: -2400, z: 1300, r: 760, h: 380, lit: 0xa8a2e0, shade: 0x7c76c2, haze: 0.58, snow: 0.7 },
    ].map((p) => ({ ...p, x: p.x + center.x, z: p.z + center.z }));
    scene.add(makePeaks(peaks, { sunDir, baseY: CLOUD_Y - 25, haze: FOG, mist: 0xfff2ea, seed: 3 }));
    const ring = createMountainRing({ radius: 3300, height: 230, baseY: CLOUD_Y - 10, color: 0xb2a6e0, topColor: 0x9c94d6, seed: 9, peaks: 13, fogColor: FOG, fogAmount: 0.45 });
    ring.position.set(center.x, 0, center.z);
    scene.add(ring);

    // клубы облаков у подножия: там, где склон уходит под облака
    {
      const puffs = [];
      const rp = mulberry32(19);
      for (let k = 0; k < 400 && puffs.length < 34; k++) {
        const a = rp() * Math.PI * 2;
        const r = 180 + rp() * 260;
        const x = center.x + Math.cos(a) * r;
        const z = center.z + Math.sin(a) * r;
        const h = H(x, z);
        if (h > CLOUD_Y + 6 || h < CLOUD_Y - 20) continue;
        puffs.push({ x, y: CLOUD_Y + 2 + rp() * 4, z, s: 9 + rp() * 9 });
      }
      // брызги у подножия каскада
      const pool = bed[2];
      for (let k = 0; k < 3; k++) puffs.push({ x: pool.x + (rp() - 0.5) * 5, y: H(pool.x, pool.z) + 0.8, z: pool.z + (rp() - 0.5) * 5, s: 1.6 + rp() * 0.8 });
      scene.add(makeCloudPuffs(puffs, { seed: 4 }));
    }

    // --- ручей: каскад с горки, заводь, русло под мостом и водопад с обрыва в облака
    const streamRocks = [];
    {
      const pts = [];
      const rs = mulberry32(61);
      let prev = null;
      for (let i = 0; i < bed.length - 1; i++) {
        const a = bed[i];
        const b = bed[i + 1];
        const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.5));
        for (let k = i ? 1 : 0; k <= n; k++) {
          const t = k / n;
          const x = lerp(a.x, b.x, t);
          const z = lerp(a.z, b.z, t);
          const y = H(x, z) + 0.28;
          if (y < CLOUD_Y - 4) break;
          const half = lerp(a.half, b.half, t);
          const slope = prev ? Math.abs(y - prev.y) / Math.max(0.5, Math.hypot(x - prev.x, z - prev.z)) : 0;
          const p = { x, y, z, w: Math.max(2.2, half * 1.5), foam: THREE.MathUtils.clamp((slope - 0.18) * 2.5, 0, 1) };
          pts.push(p);
          prev = p;
          // валуны по берегам (кроме участка под мостом)
          if (rs() < 0.35 && Math.abs(lerp(stream[i].lat, stream[i + 1].lat, t)) > 18) {
            const side = rs() < 0.5 ? -1 : 1;
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const l = Math.hypot(dx, dz) || 1;
            const off = half + 0.8 + rs() * 1.5;
            const rx = x - (dz / l) * side * off;
            const rz = z + (dx / l) * side * off;
            streamRocks.push({ x: rx, y: H(rx, rz) - 0.3, z: rz, s: 0.8 + rs() * 1.2 });
          }
        }
      }
      // пена сглаживается по соседям — перекаты без резких скачков
      for (let i = 1; i < pts.length - 1; i++) pts[i].foamS = (pts[i - 1].foam + pts[i].foam * 2 + pts[i + 1].foam) / 4;
      for (let i = 1; i < pts.length - 1; i++) pts[i].foam = pts[i].foamS;
      const water = makeStream(pts);
      scene.add(water);
      updaters.push(water.userData.update);
    }
    const nearStream = (x, z) => nearestOnPath(bed, x, z).d < 7;

    // --- лес
    // у старта и вокруг облёта камеры в интро — без высоких деревьев
    const grid0 = track.frameAtProgress(L - 14, {}).pos.clone();
    const nearStart = (x, z) => Math.hypot(x - grid0.x, z - grid0.z) < 42;
    const nearTea = (x, z) => Math.hypot(x - tea.x, z - tea.z) < 14;
    const nearShrine = (x, z) => Math.hypot(x - carC.x, z - carC.z) < 15;
    const aboveClouds = CLOUD_Y + 8;
    const busy = (x, z) => nearStart(x, z) || nearTea(x, z) || nearShrine(x, z) || nearStream(x, z);
    const rng = mulberry32(2025);
    // низшая точка земли рядом: на крутом склоне ствол не висит над рельефом
    const ground = (x, z) => Math.min(H(x, z), H(x + 0.7, z), H(x - 0.7, z), H(x, z + 0.7), H(x, z - 0.7));
    const seat = (p, dy = 0) => ({ x: p.x, y: ground(p.x, p.z) + dy, z: p.z, s: p.s });
    // крона не нависает над коридором камеры ниже 5 м (иначе камера на шпильке проезжала бы сквозь листву)
    const canopyClear = (pts) => {
      for (const v of pts) {
        const q = track.distanceTo(v.x, v.z, 30);
        if (q.index < 0) continue;
        if (q.dist < track.hw[q.index] + track.wall[q.index] + 0.8 && v.y - track.pos[q.index].y < 6) return false;
      }
      return true;
    };
    // клёны: гуще там, где на земле пятна красной листвы
    const maplesNear = scatterAround(track, H, { count: Math.round(265 * detail), minDist: 4.5, maxDist: 60, seed: 1, minY: aboveClouds, avoid: (x, z) => busy(x, z) || leafAt(x, z) < -0.35 });
    scene.add(makeMapleForest(maplesNear.map((p) => seat(p)), { outline, seed: 2, keep: canopyClear }));
    // дальние клёны (склоны и соседние вершины) — упрощённые, без контуров и теней
    const maplesFar = scatterAround(track, H, { count: Math.round(220 * detail), minDist: 55, maxDist: 230, seed: 7, minY: aboveClouds, avoid: (x, z) => leafAt(x, z) < -0.2 }).map((p) => ({
      x: p.x,
      y: ground(p.x, p.z),
      z: p.z,
      s: 1.05 + rng() * 0.45,
    }));
    // гинкго: аллея на вершине и золотые пятна по склонам
    const ginkgo = [];
    for (const [f0, f1] of M.summit) {
      for (let f = f0; f < f1; f += 16 / L) {
        for (const side of [-1, 1]) {
          const p = sideXZ(f, side, 5 + rng() * 2);
          if (busy(p.x, p.z) || rng() < 0.3) continue;
          ginkgo.push({ x: p.x, y: ground(p.x, p.z), z: p.z });
        }
      }
    }
    for (const p of scatterAround(track, H, { count: Math.round(60 * detail), minDist: 6, maxDist: 120, seed: 13, minY: aboveClouds, avoid: (x, z) => busy(x, z) || nGold(x / 34, z / 34) < 0.2 })) ginkgo.push(seat(p));
    scene.add(makeGinkgo(ginkgo, { outline, seed: 4 }));
    // криптомерии: тёмная зелень на вершине внутри петли и на крутых склонах
    const cedars = scatterAround(track, H, { count: Math.round(240 * detail), minDist: 20, maxDist: 260, seed: 3, minY: aboveClouds, avoid: (x, z) => busy(x, z) || leafAt(x, z) > 0.3 }).map((p) => ({
      x: p.x,
      y: ground(p.x, p.z) - 0.3,
      z: p.z,
      s: 1.0 + rng() * 0.6,
    }));
    scene.add(makePines(cedars, { outline, low: 0x163a2e, high: 0x3e6e4c }));
    // лес на соседних вершинах: издалека, без контуров и теней
    const hillCedars = [];
    const rh = mulberry32(88);
    for (const hl of hills) {
      for (let k = 0; k < 50 * detail; k++) {
        const a = rh() * Math.PI * 2;
        const r = Math.sqrt(rh()) * hl.r * 0.9;
        const x = hl.x + Math.cos(a) * r;
        const z = hl.z + Math.sin(a) * r;
        const y = ground(x, z);
        if (y < aboveClouds) continue;
        (k % 3 ? maplesFar : hillCedars).push({ x, y: y - 0.3, z, s: 1.2 + rh() * 0.5 });
      }
    }
    scene.add(makeMapleForest(maplesFar, { outline: false, lite: true, shadow: false, seed: 9, chunk: 360 }));
    const farPines = makePines(hillCedars, { outline: false, low: 0x163a2e, high: 0x3e6e4c, seed: 5 });
    farPines.traverse((o) => (o.castShadow = false));
    scene.add(farPines);

    // кусты, сусуки, камни
    const bushes = scatterAround(track, H, { count: Math.round(130 * detail), minDist: 4, maxDist: 30, seed: 51, minY: aboveClouds, avoid: busy });
    scene.add(makeBushes(bushes, { outline, low: 0x8a2a1e, high: 0xff8a3a }));
    const susuki = scatterAround(track, H, { count: Math.round(440 * detail), minDist: 1.6, maxDist: 40, seed: 31, minY: aboveClouds, avoid: nearStream });
    scene.add(makeSusuki(susuki));
    const rocks = scatterAround(track, H, { count: Math.round(90 * detail), minDist: 8, maxDist: 160, seed: 21, minY: CLOUD_Y });
    scene.add(makeRocks([...rocks.map((p) => ({ x: p.x, y: ground(p.x, p.z) - 0.4, z: p.z, s: 1 + rng() * 2.4 })), ...streamRocks], { color: 0xa89cae }));

    // --- дорожная обстановка серпантина
    scene.add(makeRetainingWalls(track, H));
    scene.add(makeChevronBoards(track, H, { minCurv: 0.03, step: 8 }));
    scene.add(makeChevronBoards(track, H, { minCurv: 0.018, step: 10, from: carousel[0], to: carousel[1] }));
    const mirrors = [];
    const signs = [];
    hairpins.forEach(([f0, f1], k) => {
      // зеркало — на внешней стороне вершины шпильки, смотрит к центру поворота
      frameAt((f0 + f1) / 2);
      const out = Math.sign(fr.curv);
      const d = fr.hw + fr.wall + 2.6;
      const mx = fr.pos.x + fr.right.x * out * d;
      const mz = fr.pos.z + fr.right.z * out * d;
      mirrors.push({ x: mx, y: H(mx, mz), z: mz, ry: Math.atan2(-fr.right.x * out, -fr.right.z * out) });
      // знаки перед шпилькой: предупреждение и табличка с номером
      const pre = f0 - 38 / L;
      frameAt(pre);
      const side = Math.sign(track.curv[Math.floor(((f0 + 0.01) % 1) * N)]) || 1; // снаружи поворота
      const sd = fr.hw + fr.wall + 2.2;
      const sx = fr.pos.x + fr.right.x * side * sd;
      const sz = fr.pos.z + fr.right.z * side * sd;
      const ry = Math.atan2(-fr.tan.x, -fr.tan.z);
      signs.push({ x: sx, y: H(sx, sz), z: sz, ry, tile: 0, w: 1.3, h: 1.3, post: 1.5 });
      const sx2 = sx + fr.tan.x * 6;
      const sz2 = sz + fr.tan.z * 6;
      signs.push({ x: sx2, y: H(sx2, sz2), z: sz2, ry, tile: 1 + k, w: 1.2, h: 1.2, post: 1.4 });
    });
    scene.add(makeCurveMirrors(mirrors));
    // указатель перевала на вершине, ограничение скорости, камнепад в связке S-поворотов
    {
      const p = sideXZ(0.02, 1, 3.1);
      signs.push({ x: p.x, y: H(p.x, p.z), z: p.z, ry: Math.atan2(-p.tan.x, -p.tan.z), tile: 5, w: 2.6, h: 2.0, post: 1.2, wide: true });
      const q = sideXZ(0.07, -1, 2.4);
      signs.push({ x: q.x, y: H(q.x, q.z), z: q.z, ry: Math.atan2(-q.tan.x, -q.tan.z), tile: 6, w: 1.1, h: 1.1, post: 1.6 });
      const r = sideXZ(esses1[0] + 0.004, -1, 2.4);
      signs.push({ x: r.x, y: H(r.x, r.z), z: r.z, ry: Math.atan2(-r.tan.x, -r.tan.z), tile: 7, w: 1.3, h: 1.3, post: 1.5 });
    }
    scene.add(makeRoadSigns(signs));

    // --- вершина: чайный домик, флаги, фонари
    {
      const th = makeTeaHouse();
      th.position.set(tea.x, H(tea.x, tea.z) - 0.1, tea.z);
      th.rotation.y = Math.atan2(-tea.rx, -tea.rz); // фасадом к дороге
      scene.add(th);
    }
    const flags = [];
    const lanterns = [];
    for (let s = L - 120; s < L + 40; s += 11) {
      if (Math.abs(s - L) < 8) continue; // у стартовой арки
      const f = s / L;
      for (const side of [-1, 1]) {
        const p = sideXZ(f, side, 1.6);
        if (Math.hypot(p.x - tea.x, p.z - tea.z) < 9) continue;
        flags.push({ x: p.x, y: H(p.x, p.z) - 0.1, z: p.z, ry: Math.atan2(fr.tan.x, fr.tan.z) + (side > 0 ? Math.PI : 0) });
      }
    }
    scene.add(makeNobori(flags, [0xe0362a, 0xffc93c, 0xffffff, 0xff7a2a]));
    for (const f of [0.962, 0.985, 0.012]) {
      for (const side of [-1, 1]) {
        const p = sideXZ(f, side, 3.2);
        lanterns.push({ x: p.x, y: H(p.x, p.z) - 0.1, z: p.z, ry: Math.atan2(fr.tan.x, fr.tan.z) });
      }
    }

    // --- смотровая горка внутри карусели: святилище, тории, фонари
    {
      const y = H(carC.x, carC.z);
      const sh = makeShrine();
      // лицом к выезду из карусели
      frameAt(carousel[1]);
      const face = Math.atan2(fr.pos.x - carC.x, fr.pos.z - carC.z);
      sh.position.set(carC.x, y - 0.2, carC.z);
      sh.rotation.y = face;
      sh.scale.setScalar(1.45);
      scene.add(sh);
      const tx = carC.x + Math.sin(face) * 5.5;
      const tz = carC.z + Math.cos(face) * 5.5;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(tx, H(tx, tz) - 0.3, tz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), face), new THREE.Vector3(1, 1, 1));
      scene.add(makeToriiRow([m], 4.2, 5.2));
      for (const s of [-1, 1]) {
        const lx = carC.x + Math.sin(face) * 3.6 + Math.cos(face) * s * 2.8;
        const lz = carC.z + Math.cos(face) * 3.6 - Math.sin(face) * s * 2.8;
        lanterns.push({ x: lx, y: H(lx, lz) - 0.1, z: lz, ry: face, s: 0.8 });
      }
    }
    scene.add(makeStoneLanterns(lanterns));

    // --- листопад: кленовые листья кружатся вокруг камеры
    const ambientCount = 520;
    const leaves = createAmbientParticles({ count: ambientCount, box: [80, 36, 80], fall: 1.15, sway: 1.7, size: 1.6, shape: 'maple', color: 0xffa02a, color2: 0xe8302a, seed: 21 });
    leaves.userData.setCount(Math.round(ambientCount * (quality.particles ?? 1)));
    scene.add(leaves);
    updaters.push(leaves.userData.update);

    return {
      sky,
      lights,
      updaters,
      ambient: leaves,
      ambientCount,
      dustColor: new THREE.Color(0xd8b08a),
      bloom: { strength: 0.45, radius: 0.55, threshold: 1.2 },
      exposure: 1.0,
      post: { saturation: 1.1, vignette: 0.26 },
      minimap: { road: '#ffffff', edge: '#ff5a2e', bg: 'rgba(255,236,214,0.35)' },
    };
  },
};
