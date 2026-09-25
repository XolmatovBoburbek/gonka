// Локация 3: "Закатный Берег" — золотой час на аниме-побережье: пальмовый бульвар, дорога по скалам мыса,
// маяк с вращающимся лучом, деревянный пирс над бухтой, пляж с зонтиками, яхты, чайки и небесные фонарики.
import * as THREE from 'three';
import { sunsetLayout, COAST } from './sunsetLayout.js';
import { createSky, createLights, createCumulus, createMountainRing, mulberry32 } from '../world/sky.js';
import { buildTerrain } from '../world/terrain.js';
import { createWater } from '../world/water.js';
import { createNoise2D, fbm, smoothstep, lerp } from '../world/noise.js';
import { toon } from '../world/toon.js';
import { makeGrass, makeBushes, scatterAround } from '../world/props.js';
import {
  makePalms,
  makeRocks,
  makeHibiscus,
  makeLighthouse,
  makePilings,
  makeLampPosts,
  makeStringLights,
  makeBeachHuts,
  makeUmbrellas,
  makeLifeguardTower,
  makeHouses,
  makeFerrisWheel,
  makeSailboats,
  makeSeagulls,
  createSkyLanterns,
  makeIslands,
} from './sunsetProps.js';

const WATER_Y = 0;
const FOG = 0xf0a08c;

// ---------------------------------------------------------------- береговая линия
// Знаковое расстояние до берега (суша > 0) через сетку-бакеты отрезков сглаженной ломаной.
class CoastField {
  constructor(points, { cell = 25, maxDist = 110 } = {}) {
    this.pts = points;
    this.cell = cell;
    this.maxDist = maxDist;
    this.grid = new Map();
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const x0 = Math.floor((Math.min(a.x, b.x) - maxDist) / cell);
      const x1 = Math.floor((Math.max(a.x, b.x) + maxDist) / cell);
      const z0 = Math.floor((Math.min(a.z, b.z) - maxDist) / cell);
      const z1 = Math.floor((Math.max(a.z, b.z) + maxDist) / cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = cx * 73856093 + cz * 19349663;
          let arr = this.grid.get(k);
          if (!arr) this.grid.set(k, (arr = []));
          arr.push(i);
        }
      }
    }
  }
  /** Приближённая высота берега z(x) — для знака вдали от линии. */
  coastZ(x) {
    const p = this.pts;
    let lo = 0;
    let hi = p.length - 1;
    if (x <= p[0].x) return p[0].z;
    if (x >= p[hi].x) return p[hi].z;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (p[m].x > x) hi = m;
      else lo = m;
    }
    const t = (x - p[lo].x) / (p[hi].x - p[lo].x || 1);
    return p[lo].z + (p[hi].z - p[lo].z) * t;
  }
  signed(x, z) {
    const k = Math.floor(x / this.cell) * 73856093 + Math.floor(z / this.cell) * 19349663;
    const arr = this.grid.get(k);
    if (!arr) return z < this.coastZ(x) ? this.maxDist : -this.maxDist;
    let best = this.maxDist * this.maxDist;
    let side = 0;
    for (const i of arr) {
      const a = this.pts[i];
      const b = this.pts[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)));
      const dx = x - (a.x + abx * t);
      const dz = z - (a.z + abz * t);
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        // суша — слева по ходу линии (запад → восток, север = -z)
        side = abx * (z - a.z) - abz * (x - a.x);
      }
    }
    if (side === 0) return z < this.coastZ(x) ? this.maxDist : -this.maxDist;
    return side < 0 ? Math.sqrt(best) : -Math.sqrt(best);
  }
}

const coastPts = (() => {
  const c = new THREE.CatmullRomCurve3(COAST.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  return c.getSpacedPoints(700).map((v) => ({ x: v.x, z: v.z }));
})();
const coast = new CoastField(coastPts);

// ---------------------------------------------------------------- гладкое "поле высоты дороги"
// Взвешенное среднее высот соседних сэмплов трассы + расстояние до дороги — на грубой сетке.
function buildRoadField(track, center, size, cell = 6, sigma = 26, radius = 130) {
  const n = Math.ceil(size / cell) + 1;
  const x0 = center.x - (size / 2);
  const z0 = center.z - (size / 2);
  const W = new Float32Array(n * n);
  const Y = new Float32Array(n * n);
  const D = new Float32Array(n * n).fill(radius);
  const r = Math.ceil(radius / cell);
  const inv = 1 / (2 * sigma * sigma);
  for (let i = 0; i < track.count; i += 2) {
    const p = track.pos[i];
    const cx = Math.round((p.x - x0) / cell);
    const cz = Math.round((p.z - z0) / cell);
    for (let gz = Math.max(0, cz - r); gz <= Math.min(n - 1, cz + r); gz++) {
      const wz = z0 + gz * cell - p.z;
      for (let gx = Math.max(0, cx - r); gx <= Math.min(n - 1, cx + r); gx++) {
        const wx = x0 + gx * cell - p.x;
        const d2 = wx * wx + wz * wz;
        if (d2 > radius * radius) continue;
        const k = gz * n + gx;
        const w = Math.exp(-d2 * inv);
        W[k] += w;
        Y[k] += w * p.y;
        const d = Math.sqrt(d2);
        if (d < D[k]) D[k] = d;
      }
    }
  }
  for (let k = 0; k < n * n; k++) Y[k] = (Y[k] + 3 * 1e-3) / (W[k] + 1e-3);
  const out = { y: 3, d: radius };
  const sample = (x, z) => {
    const gx = (x - x0) / cell;
    const gz = (z - z0) / cell;
    if (gx < 0 || gz < 0 || gx >= n - 1 || gz >= n - 1) {
      out.y = 3;
      out.d = radius;
      return out;
    }
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const k = iz * n + ix;
    const bl = (A) => lerp(lerp(A[k], A[k + 1], fx), lerp(A[k + n], A[k + n + 1], fx), fz);
    out.y = bl(Y);
    out.d = bl(D);
    return out;
  };
  return sample;
}

export const sunset = {
  id: 'sunset',
  name: 'Закатный Берег',
  jp: '夕焼け海岸',
  time: 'Золотой закат',
  description: 'Прибрежное кольцо в золотой час: пальмовый бульвар, серпантин по скалам к маяку, пляж с зонтиками и деревянный пирс над сверкающей бухтой.',
  music: 'sunset',
  card: ['#ff9a3c', '#ff4f9a'],
  ...sunsetLayout,
  itemRows: [0.045, 0.265, 0.52, 0.885],
  boostPads: [
    { at: 0.935, lateral: -4.5, length: 9, width: 5 },
    { at: 0.235, lateral: 4, length: 9, width: 5 },
    { at: 0.47, lateral: 0, length: 9, width: 5 },
    { at: 0.685, lateral: 3.5, length: 9, width: 5 },
  ],
  ramps: [{ at: 0.575, lateral: -3.5, width: 8, length: 8, height: 1.4 }],
  theme: {
    road: { base: '#857a86', grain: 0.09, edgeLine: '#fff4e8', centerLine: '#ffd27a' },
    curb: { a: '#ff5e62', b: '#fff4e6', width: 1.5 },
    wall: { style: 'guard', a: '#fff4ea', b: '#8a5a3e', height: 0.95 },
    deck: { color: 0xb88a62, side: 0x6e4c38, depth: 1.6 },
    gate: { pillar: 0xfff6ec, accent: 0xff5a6e, bannerA: '#ff7a3c', bannerB: '#ffc46a', text: 'SUNSET  DRIFT  GP' },
    boost: { a: '#39f3ff', b: '#fff7a8', intensity: 1.8 },
    ramp: { a: '#ffd84a', b: '#ffffff', side: 0xff7a4a },
  },

  prepare(track) {
    // над водой и у самой кромки — деревянный пирс
    track.markSections((p) => coast.signed(p.x, p.z) < 7, { bridge: true, wall: 2.2 });
  },

  build({ scene, track, quality }) {
    const detail = quality.detail ?? 1;
    const outline = detail >= 0.8;
    const L = track.length;
    // солнце у самого горизонта над морем (юго-запад); свет чуть выше — для читаемости
    const sunDir = new THREE.Vector3(-0.56, 0.075, 0.83).normalize();
    const lightDir = new THREE.Vector3(-0.56, 0.36, 0.83).normalize();
    const updaters = [];

    // --- небо, туман, свет
    const sky = createSky({
      top: 0x2e3494,
      mid: 0xe0748c,
      horizon: 0xffa468,
      bottom: FOG,
      midPos: 0.13,
      sunDir,
      sunColor: 0xffe2a0,
      sunBright: 3.4,
      glowColor: 0xffa848,
      sunSize: 0.07,
      sunGlow: 1.35,
      horizonGlow: 0.75,
      cloudCover: 0.34,
      cloudScale: 0.95,
      cloudLight: 0xffc4a0,
      cloudShade: 0xb07aa8,
      cloudRim: 0xffe0a0,
      cloudOpacity: 0.95,
    });
    sky.userData.uniforms.uCloudRim.value.multiplyScalar(1.5);
    scene.add(sky);
    updaters.push(sky.userData.update);
    scene.fog = new THREE.FogExp2(FOG, 0.00115);
    const lights = createLights(scene, {
      sunDir: lightDir,
      sunColor: 0xffb880,
      sunIntensity: 2.5,
      hemiSky: 0xc4a8e8,
      hemiGround: 0x9a6a5a,
      hemiIntensity: 1.65,
      shadowExtent: 80,
    });

    // --- рельеф
    const center = track.bounds.getCenter(new THREE.Vector3());
    const SIZE = 1500;
    const road = buildRoadField(track, center, SIZE + 40);
    const nA = createNoise2D(21);
    const nB = createNoise2D(77);
    const nC = createNoise2D(5);
    const hills = (x, z) => {
      const north = smoothstep(20, -330, z);
      const far = smoothstep(-400, -1300, z);
      const ridge = 1 - Math.abs(fbm(nB, x / 260 + 7, z / 200, 3));
      return Math.max(-1, 4 + fbm(nA, x / 150, z / 150, 3) * 9 + north * (24 + ridge * ridge * 36 + fbm(nB, x / 120, z / 120, 2) * 10) + far * 60);
    };
    // обрывы на мысе и восточном берегу, пляж — на остальном
    const cliffK = (x) => smoothstep(132, 160, x) * (1 - smoothstep(420, 560, x));
    const cap = (x, sd) => {
      const beach = sd >= 0 ? 0.3 + sd * 0.07 + smoothstep(30, 100, sd) * 200 : sd > -5 ? 0.3 + sd * 0.32 : -1.3 + (sd + 5) * 0.085;
      const rock = sd >= 0 ? -3 + sd * 2.1 : -3 + sd * 0.35;
      return Math.max(-16, lerp(beach, rock, cliffK(x)));
    };
    let lastX = NaN;
    let lastZ = NaN;
    let lastSd = 0;
    const sdAt = (x, z) => {
      if (x !== lastX || z !== lastZ) {
        lastX = x;
        lastZ = z;
        lastSd = coast.signed(x, z);
      }
      return lastSd;
    };
    const heightFn = (x, z) => {
      const r = road(x, z);
      const t = smoothstep(14, 120, r.d);
      const sd = sdAt(x, z);
      return Math.min(r.y + t * hills(x, z), cap(x, sd)) + dune(x, z, sd);
    };
    // невысокие песчаные дюны на пляже
    const dune = (x, z, sd) => {
      const k = (1 - cliffK(x)) * smoothstep(5, 12, sd) * (1 - smoothstep(20, 28, sd));
      return k > 0 ? k * Math.max(0, fbm(nC, x / 16, z / 16, 2)) * 1.8 : 0;
    };
    const post = (x, z, h, roadK) => {
      const sd = sdAt(x, z);
      return lerp(Math.min(h, cap(x, sd) + dune(x, z, sd)), h, roadK);
    };
    const cSand = new THREE.Color(0xf4d8a6);
    const cSandWet = new THREE.Color(0xc89e78);
    const cGrass = new THREE.Color(0x86b85a);
    const cGrassDry = new THREE.Color(0xc8c070);
    const cGrassDark = new THREE.Color(0x4f8a4e);
    const cRock = new THREE.Color(0xb08a7e);
    const cRockDark = new THREE.Color(0x7a5a6a);
    const cRoad = new THREE.Color(0xa8b870);
    const colorFn = (x, z, h, info) => {
      const sd = coast.signed(x, z);
      const c = cGrass.clone();
      const n = fbm(nC, x / 45, z / 45, 3);
      c.lerp(cGrassDry, THREE.MathUtils.clamp(n * 0.9 + 0.35 + (h - 8) * 0.02, 0, 0.8));
      c.lerp(cGrassDark, THREE.MathUtils.clamp(-n * 0.8, 0, 0.35));
      c.lerp(cRoad, info.road * 0.3);
      const ck = cliffK(x);
      // песок: пляжи и дюны
      const sand = (1 - ck) * (1 - smoothstep(26, 34, sd + n * 4));
      c.lerp(cSand, sand);
      // скалы на крутых склонах
      const rock = THREE.MathUtils.clamp((info.slope - 0.14) * 4, 0, 1) * (0.35 + 0.65 * ck);
      c.lerp(n > 0 ? cRock : cRockDark, rock);
      if (sd < 3) c.lerp(ck > 0.5 ? cRockDark : cSandWet, THREE.MathUtils.clamp((3 - sd) / 3, 0, 1) * 0.8);
      return c;
    };
    const terrain = buildTerrain(track, {
      size: SIZE,
      segments: Math.round(260 * Math.max(0.7, detail)),
      center,
      height: heightFn,
      post,
      color: colorFn,
      blendOuter: 36,
    });
    scene.add(terrain.mesh);
    const H = terrain.heightAt;
    scene.add(buildFarTerrain(center, SIZE, heightFn, colorFn));

    // --- океан
    const water = createWater({
      size: 6400,
      segments: 40,
      center,
      level: WATER_Y,
      deep: 0x2a3a86,
      shallow: 0x3cc4bc,
      foam: 0xfff0e0,
      sky: 0xe08a9c,
      sunDir,
      sunColor: 0xffc070,
      heightMap: terrain.heightTexture(),
      wave: 0.08,
      sparkle: 0.9,
      sunPath: 1.05,
    });
    scene.add(water);
    updaters.push(water.userData.update);

    // --- горизонт: горы на севере, острова и облака
    const north = [Math.PI * 0.94, Math.PI * 2.06];
    const ring1 = createMountainRing({ radius: 1250, height: 150, baseY: -6, color: 0x6e4f86, topColor: 0x8e62a0, seed: 6, peaks: 9, fogColor: FOG, fogAmount: 0.45, arc: north });
    const ring2 = createMountainRing({ radius: 1900, height: 300, baseY: -20, color: 0x5a4480, topColor: 0x80609e, seed: 13, peaks: 6, fogColor: FOG, fogAmount: 0.55, arc: north });
    ring1.position.set(center.x, 0, center.z);
    ring2.position.set(center.x, 0, center.z);
    scene.add(ring1, ring2);
    const islands = makeIslands(
      [
        { x: -1100, z: 1250, w: 260, h: 55, ry: 0.3 },
        { x: -560, z: 1550, w: 170, h: 34 },
        { x: 650, z: 1500, w: 320, h: 70, ry: -0.2 },
        { x: 1350, z: 950, w: 220, h: 48 },
        { x: -1700, z: 700, w: 300, h: 60 },
      ].map((i) => ({ ...i, x: i.x + center.x, z: i.z + center.z })),
      { low: 0x9a5a86, high: 0xc07a96 }
    );
    scene.add(islands);
    const clouds = createCumulus({ count: 9, radius: 1750, radiusJitter: 200, minY: 90, maxY: 170, scale: [150, 260], arc: [Math.PI * 1.08, Math.PI * 1.92], color: 0xffc4a4, shade: 0x8a5a9a, seed: 5, tint: { color: 0xff9a7a, amount: 0.25 } });
    clouds.position.set(center.x, 0, center.z);
    scene.add(clouds);

    // яхты в море
    const rb = mulberry32(17);
    const boats = [];
    for (let i = 0; i < 14; i++) {
      const x = center.x - 600 + rb() * 1200;
      const z = 300 + rb() * 700;
      if (coast.signed(x, z) > -60) continue;
      boats.push({ x, z, ry: rb() * Math.PI * 2, s: 1.6 + rb() * 0.8, speed: 0.3 + rb() * 0.4 });
    }
    const sb = makeSailboats(boats, { level: WATER_Y });
    scene.add(sb.mesh);
    updaters.push(sb.update);

    // --- ориентиры вдоль трассы
    const fr = {};
    const frameAt = (f) => track.frameAtProgress((((f % 1) + 1) % 1) * L, fr);
    const sideXZ = (f, side, off) => {
      frameAt(f);
      const d = fr.hw + fr.wall + off;
      return { x: fr.pos.x + fr.right.x * side * d, z: fr.pos.z + fr.right.z * side * d, yaw: Math.atan2(fr.tan.x, fr.tan.z), rx: fr.right.x * side, rz: fr.right.z * side };
    };
    const clearOfRoad = (x, z, margin) => {
      const q = track.distanceTo(x, z, 60);
      return q.index < 0 || q.dist > track.hw[q.index] + track.wall[q.index] + margin;
    };

    // маяк на оконечности мыса (самая высокая точка трассы)
    let tipI = 0;
    for (let i = 0; i < track.count; i++) if (track.pos[i].y > track.pos[tipI].y) tipI = i;
    {
      const P = track.pos[tipI];
      // наружу от петли — к морю
      const R = track.right[tipI];
      let side = 1;
      if (coast.signed(P.x + R.x * 30, P.z + R.z * 30) > coast.signed(P.x - R.x * 30, P.z - R.z * 30)) side = -1;
      const d = track.hw[tipI] + track.wall[tipI] + 9;
      const lx = P.x + R.x * side * d;
      const lz = P.z + R.z * side * d;
      const T = track.tan[tipI];
      const ox = R.x * side;
      const oz = R.z * side;
      const lh = makeLighthouse({ height: 22, housePos: { x: T.x * 10 + ox * 1.5, z: T.z * 10 + oz * 1.5 }, houseRot: Math.atan2(-ox, -oz) });
      lh.group.position.set(lx, H(lx, lz) - 0.4, lz);
      scene.add(lh.group);
      updaters.push(lh.update);
    }

    // --- пальмы
    const palms = [];
    const addRow = (f0, f1, step, off, jitter, sides = [-1, 1], lean = null) => {
      const r = mulberry32(Math.round(f0 * 1000) + 3);
      for (let f = f0; f < f1; f += step / L) {
        for (const s of sides) {
          if (r() < 0.12) continue;
          const p = sideXZ(f, s, off + r() * jitter);
          if (coast.signed(p.x, p.z) < 3 || !clearOfRoad(p.x, p.z, 1.5)) continue;
          const ry = lean !== null ? lean + (r() - 0.5) * 0.9 : Math.atan2(p.rz, -p.rx) + Math.PI + (r() - 0.5) * 1.2;
          palms.push({ x: p.x, y: H(p.x, p.z), z: p.z, ry });
        }
      }
    };
    // бульвар (старт/финиш) — ровные ряды, пальмы клонятся от дороги
    addRow(0.84, 1.0, 15, 2.8, 1.2);
    addRow(0.0, 0.1, 15, 2.8, 1.2);
    // пляжная дорога — со стороны моря, наклон к морю
    addRow(0.45, 0.63, 17, 4, 6, [-1, 1], -Math.PI / 2);
    addRow(0.75, 0.84, 20, 4, 8);
    const scattered = scatterAround(track, H, { count: Math.round(95 * detail), minDist: 6, maxDist: 70, seed: 4, avoid: (x, z) => coast.signed(x, z) < 5 || cliffK(x) > 0.5 });
    for (const p of scattered) palms.push({ x: p.x, y: p.y, z: p.z });
    scene.add(makePalms(palms, { outline, seed: 1, variants: 2 }));
    const farPalms = scatterAround(track, H, { count: Math.round(120 * detail), minDist: 75, maxDist: 230, seed: 8, avoid: (x, z) => coast.signed(x, z) < 5 });
    const rfp = mulberry32(12);
    scene.add(makePalms(farPalms.map((p) => ({ x: p.x, y: p.y, z: p.z, s: 1 + rfp() * 0.4 })), { outline: false, seed: 2, fronds: 6, segs: 5, variants: 2, chunk: 420 }));

    // --- пирс: сваи, фонари, гирлянды
    const bridgeRanges = track.ranges((i) => (track.flags[i] & 1) !== 0);
    const pilings = [];
    const pierLamps = [];
    const lampTops = { '-1': [], 1: [] };
    for (const [a, b] of bridgeRanges) {
      const s0 = a * track.spacing;
      const s1 = b * track.spacing;
      for (let s = s0; s <= s1; s += 7) {
        track.frameAtProgress(s % L, fr);
        const top = fr.pos.y - 1.7;
        for (const lat of [-1, -0.35, 0.35, 1]) {
          const d = lat * (fr.hw + (Math.abs(lat) === 1 ? fr.wall : 0));
          const x = fr.pos.x + fr.right.x * d;
          const z = fr.pos.z + fr.right.z * d;
          const bottom = Math.min(H(x, z), WATER_Y) - 1.5;
          if (top - bottom > 0.6) pilings.push({ x, z, top, bottom });
        }
      }
      for (let s = s0 + 6; s <= s1 - 4; s += 17) {
        track.frameAtProgress(s % L, fr);
        for (const side of [-1, 1]) {
          const d = fr.hw + fr.wall + 0.25;
          const x = fr.pos.x + fr.right.x * side * d;
          const z = fr.pos.z + fr.right.z * side * d;
          const y = fr.pos.y + fr.right.y * side * d;
          // кронштейн (+x) смотрит на дорогу
          const ry = Math.atan2(fr.right.z * side, -fr.right.x * side);
          pierLamps.push({ x, y: y + 0.1, z, ry });
          lampTops[side].push(new THREE.Vector3(x, y + 5.3, z));
        }
      }
    }
    scene.add(makePilings(pilings));
    // фонари на бульваре и пляжной дороге
    const lamps = [...pierLamps];
    const addLamps = (f0, f1, step, sides, off) => {
      for (let f = f0; f < f1; f += step / L) {
        for (const s of sides) {
          const p = sideXZ(f, s, off);
          if (coast.signed(p.x, p.z) < 4) continue;
          lamps.push({ x: p.x, y: H(p.x, p.z), z: p.z, ry: Math.atan2(-p.rz, p.rx) + Math.PI });
        }
      }
    };
    addLamps(0.86, 1.0, 26, [-1, 1], 0.9);
    addLamps(0.0, 0.08, 26, [-1, 1], 0.9);
    addLamps(0.46, 0.62, 24, [1, -1], 0.9);
    scene.add(makeLampPosts(lamps, { outline }));
    const pairs = [];
    for (const side of [-1, 1]) {
      const arr = lampTops[side];
      for (let i = 0; i < arr.length - 1; i++) if (arr[i].distanceTo(arr[i + 1]) < 30) pairs.push([arr[i], arr[i + 1]]);
    }
    scene.add(makeStringLights(pairs, { spacing: 1.5, sag: 1.1 }));

    // --- пляж: домики, зонтики, вышка спасателей
    const huts = [];
    const umbrellas = [];
    const rp = mulberry32(33);
    for (let x = -40; x < 110; x += 6 + rp() * 3) {
      if (rp() < 0.25) {
        x += 6;
        continue;
      }
      // найти точку на sd≈21
      let z = coast.coastZ(x) - 21;
      for (let k = 0; k < 4; k++) z += coast.signed(x, z) - 21;
      if (!clearOfRoad(x, z, 2.5)) continue;
      huts.push({ x, y: H(x, z), z, ry: 0 });
    }
    scene.add(makeBeachHuts(huts));
    for (let i = 0; i < 70; i++) {
      const x = -45 + rp() * 175;
      const z = coast.coastZ(x) - (4 + rp() * 14);
      const sd = coast.signed(x, z);
      if (sd < 3.5 || sd > 18 || cliffK(x) > 0.3 || !clearOfRoad(x, z, 3)) continue;
      if (huts.some((h) => Math.abs(h.x - x) < 3 && Math.abs(h.z - z) < 3)) continue;
      umbrellas.push({ x, y: H(x, z), z });
    }
    scene.add(makeUmbrellas(umbrellas));
    {
      const x = 62;
      let z = coast.coastZ(x) - 12;
      for (let k = 0; k < 4; k++) z += coast.signed(x, z) - 12;
      const tower = makeLifeguardTower();
      tower.position.set(x, H(x, z) - 0.1, z);
      tower.rotation.y = 0;
      scene.add(tower);
    }

    // --- дома на холмах
    const houses = scatterAround(track, H, {
      count: Math.round(26 * Math.max(0.6, detail)),
      minDist: 16,
      maxDist: 120,
      seed: 61,
      avoid: (x, z) => coast.signed(x, z) < 35 || cliffK(x) > 0.2,
    });
    scene.add(
      makeHouses(
        houses.map((p) => ({ x: p.x, y: p.y, z: p.z, ry: Math.round(rp() * 4) * (Math.PI / 2) + (rp() - 0.5) * 0.4 })),
        { outline }
      )
    );

    // --- скалы: подножие обрывов и кекуры в море
    const rocks = [];
    const rr = mulberry32(8);
    for (let i = 0; i < 1200 && rocks.length < 170 * detail; i++) {
      const p = coastPts[Math.floor(rr() * coastPts.length)];
      const ck = cliffK(p.x);
      if (ck < 0.5 && rr() < 0.9) continue;
      if (Math.abs(p.x - center.x) > 600) continue;
      const x = p.x + (rr() - 0.5) * 8;
      const z = p.z + (rr() - 0.5) * 8;
      if (!clearOfRoad(x, z, 3)) continue;
      const s = ck < 0.5 ? 0.6 + rr() * 0.8 : rr() < 0.15 ? 3 + rr() * 1.5 : 1.2 + rr() * 1.8;
      rocks.push({ x, y: H(x, z) - 0.5, z, s, sy: ck < 0.5 ? 0.8 : 1 + rr() * 0.6 });
    }
    // кекуры у мыса
    for (const [dx, dz, s, sy] of [
      [30, 70, 5, 2.4],
      [55, 58, 3.5, 2],
      [-35, 80, 4.5, 2.8],
      [90, 25, 6, 2],
      [-60, 64, 3, 1.6],
      [70, 90, 2.5, 1.5],
    ]) {
      const P = track.pos[tipI];
      const x = P.x + dx;
      const z = P.z + dz;
      rocks.push({ x, y: Math.min(-2, H(x, z)), z, s, sy });
    }
    const inland = scatterAround(track, H, { count: Math.round(50 * detail), minDist: 8, maxDist: 110, seed: 23, avoid: (x, z) => coast.signed(x, z) < 20 });
    for (const p of inland) rocks.push({ x: p.x, y: p.y - 0.3, z: p.z, s: 0.8 + rr() * 1.2 });
    scene.add(makeRocks(rocks, { color: 0xb49488 }));

    // --- трава, кусты, цветы
    const grass = scatterAround(track, H, { count: Math.round(1500 * detail), minDist: 0.5, maxDist: 42, seed: 31, avoid: (x, z) => coast.signed(x, z) < 12 });
    scene.add(makeGrass(grass, { low: 0x5a7a3a, high: 0xd8c878 }));
    const flowers = scatterAround(track, H, { count: Math.round(700 * detail), minDist: 1, maxDist: 45, seed: 41, avoid: (x, z) => coast.signed(x, z) < 30 });
    scene.add(makeHibiscus(flowers));
    const bushes = scatterAround(track, H, { count: Math.round(75 * detail), minDist: 2, maxDist: 40, seed: 51, avoid: (x, z) => coast.signed(x, z) < 22 });
    scene.add(makeBushes(bushes, { outline, low: 0x3a6a3a, high: 0x8ab85a }));

    // --- колесо обозрения на западном мысу
    {
      const x = center.x - 420;
      const z = coast.coastZ(x) - 45;
      const fw = makeFerrisWheel({ radius: 24 });
      fw.group.position.set(x, Math.max(0.5, H(x, z)) - 0.5, z);
      fw.group.rotation.y = 0.5;
      scene.add(fw.group);
      updaters.push(fw.update);
    }

    // --- чайки
    const tip = track.pos[tipI];
    const gulls = makeSeagulls([
      { x: 40, y: 22, z: coast.coastZ(40) - 5, r: 26, count: 7 },
      { x: tip.x, y: 40, z: tip.z + 20, r: 20, count: 6 },
      { x: -140, y: 16, z: 170, r: 30, count: 6 },
      { x: 20, y: 18, z: 40, r: 22, count: 4 },
    ]);
    scene.add(gulls.mesh);
    updaters.push(gulls.update);

    // --- небесные фонарики: дальнее поле + рядом с камерой (ambient)
    const farLanterns = createSkyLanterns({ count: Math.round(320 * (quality.particles ?? 1)), box: [900, 210, 900], baseY: 12, size: 1.9, rise: 1.1, glow: 2.6, seed: 3 });
    scene.add(farLanterns);
    updaters.push(farLanterns.userData.update);
    const ambientCount = 90;
    const near = createSkyLanterns({ count: ambientCount, box: [150, 50, 150], baseY: 4, size: 0.9, rise: 0.8, glow: 2.2, seed: 9 });
    near.userData.setCount(Math.round(ambientCount * (quality.particles ?? 1)));
    scene.add(near);
    updaters.push(near.userData.update);

    return {
      sky,
      lights,
      updaters,
      ambient: near,
      ambientCount,
      dustColor: new THREE.Color(0xe8c89a),
      bloom: { strength: 0.5, radius: 0.6, threshold: 1.2 },
      exposure: 1.0,
      post: { saturation: 1.1, vignette: 0.3 },
      minimap: { road: '#ffffff', edge: '#ff7a3c', bg: 'rgba(255,226,206,0.35)' },
    };
  },
};

/** Дальний рельеф до горизонта: грубая сетка, внутри ближнего квадрата утоплена под землю. */
function buildFarTerrain(center, nearSize, heightFn, colorFn) {
  const cells = 28;
  const step = nearSize / cells;
  const seg = 100;
  const size = step * seg;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const half = nearSize / 2 + 0.01;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    const x = lx + center.x;
    const z = lz + center.z;
    const inside = Math.abs(lx) < half - 1 && Math.abs(lz) < half - 1;
    const onEdge = !inside && Math.abs(lx) <= half && Math.abs(lz) <= half;
    let h = heightFn(x, z);
    if (inside) h = -40;
    else if (onEdge) h -= 0.3;
    pos.setXYZ(i, x, h, z);
  }
  geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal');
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = colorFn(pos.getX(i), pos.getZ(i), pos.getY(i), { road: 0, slope: 1 - nrm.getY(i) });
    c.toArray(cols, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true, ramp: 'terrain' }));
  m.name = 'far-terrain';
  m.receiveShadow = false;
  m.userData.noShadow = true;
  return m;
}
