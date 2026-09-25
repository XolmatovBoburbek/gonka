// Локация 1: "Сакура-Долина" — солнечный день, цветущие сакуры, тоннель тории, река с красными мостами,
// пагода у шпильки, бамбуковая роща, Фудзи на горизонте и летящие лепестки.
import * as THREE from 'three';
import { sakuraLayout, RIVER } from './sakuraLayout.js';
import { createSky, createLights, createCumulus, createMountainRing, mulberry32 } from '../world/sky.js';
import { buildTerrain, buildFarGround } from '../world/terrain.js';
import { createWater } from '../world/water.js';
import { createNoise2D, fbm, smoothstep } from '../world/noise.js';
import { PolylineDistance } from '../world/geom.js';
import {
  makeSakuraForest,
  makePines,
  makeBamboo,
  makeToriiRow,
  makeStoneLanterns,
  makePagoda,
  makeRocks,
  makeGrass,
  makeFlowers,
  makeBushes,
  makeNobori,
  makeBridgeRails,
  createAmbientParticles,
  scatterAround,
  trs,
} from '../world/props.js';

// расстояние до реки (сглаженная ломаная + сетка для скорости)
const riverPts = (() => {
  const c = new THREE.CatmullRomCurve3(RIVER.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  return c.getSpacedPoints(300);
})();
const riverField = new PolylineDistance(riverPts, { cell: 40, maxDist: 90 });
const riverDist = (x, z) => riverField.dist(x, z);

const RIVER_HW = 11;
const WATER_Y = -1.3;

export const sakura = {
  id: 'sakura',
  name: 'Сакура-Долина',
  jp: '桜の谷',
  time: 'Солнечный день',
  description: 'Горный серпантин среди цветущих сакур: тоннель из тории, красные мосты над рекой и пагода у крутой шпильки.',
  music: 'sakura',
  card: ['#ff9cc8', '#8fd0ff'],
  ...sakuraLayout,
  itemRows: [0.07, 0.3, 0.56, 0.86],
  boostPads: [
    { at: 0.955, lateral: -4.5, length: 9, width: 5 },
    { at: 0.18, lateral: 4.5, length: 9, width: 5 },
    { at: 0.48, lateral: 0, length: 9, width: 5 },
    { at: 0.835, lateral: 3.5, length: 9, width: 5 },
  ],
  ramps: [{ at: 0.615, lateral: -3.5, width: 8, length: 8, height: 1.4 }],
  theme: {
    road: { base: '#6d6f82', grain: 0.09, edgeLine: '#fff6fb', centerLine: '#ffd9ea' },
    curb: { a: '#ff6fa8', b: '#ffffff', width: 1.5 },
    wall: { style: 'pillow', a: '#ff8fbf', b: '#ffffff', height: 1.0 },
    deck: { color: 0xc7b3a2, side: 0xb14a3a, depth: 1.6 },
    gate: { pillar: 0xffffff, accent: 0xff5d93, bannerA: '#ff5d93', bannerB: '#ffc2dc', text: 'SAKURA  DRIFT  GP' },
    boost: { a: '#39f3ff', b: '#fff7a8', intensity: 1.8 },
    ramp: { a: '#ffd84a', b: '#ffffff', side: 0xff6fa8 },
  },

  prepare(track) {
    track.markSections((p) => riverDist(p.x, p.z) < RIVER_HW + 9, { bridge: true, wall: 1.8 });
  },

  build({ scene, track, quality }) {
    const detail = quality.detail ?? 1;
    const outline = detail >= 0.8;
    const sunDir = new THREE.Vector3(0.42, 0.72, 0.55).normalize();
    const updaters = [];

    // --- небо, туман, свет
    const sky = createSky({
      top: 0x2f7dff,
      mid: 0x86c2ff,
      horizon: 0xffe4f0,
      midPos: 0.32,
      sunDir,
      sunColor: 0xfff6e0,
      glowColor: 0xffe8c0,
      sunSize: 0.04,
      sunGlow: 0.9,
      horizonGlow: 0.25,
      cloudCover: 0.4,
      cloudScale: 1.25,
      cloudLight: 0xffffff,
      cloudShade: 0xc5d6f5,
      cloudRim: 0xffffff,
    });
    scene.add(sky);
    updaters.push(sky.userData.update);
    scene.fog = new THREE.FogExp2(0xf4dcec, 0.0015);
    const lights = createLights(scene, {
      sunDir,
      sunColor: 0xfff0e2,
      sunIntensity: 2.7,
      hemiSky: 0xcfe2ff,
      hemiGround: 0xa89088,
      hemiIntensity: 1.55,
      shadowExtent: 75,
    });

    // --- рельеф
    const noise = createNoise2D(12);
    const noise2 = createNoise2D(99);
    const center = track.bounds.getCenter(new THREE.Vector3());
    const heightFn = (x, z) => {
      const dx = x - center.x;
      const dz = z - center.z;
      const r = Math.hypot(dx * 0.85, dz);
      let h = 2 + fbm(noise, x / 170, z / 170, 4) * 7;
      h += smoothstep(330, 560, r) * (18 + fbm(noise2, x / 90, z / 90, 3) * 14);
      return h;
    };
    const post = (x, z, h) => {
      const rd = riverDist(x, z);
      const fadeEdge = 1 - smoothstep(560, 640, Math.abs(x - center.x));
      const carve = (1 - smoothstep(RIVER_HW - 2, RIVER_HW + 9, rd)) * fadeEdge;
      if (carve <= 0) return h;
      const bed = -4.2 + (rd / RIVER_HW) * 1.2;
      return THREE.MathUtils.lerp(h, Math.min(h, bed), carve);
    };
    const petalNoise = createNoise2D(5);
    const cGrass = new THREE.Color(0x7fce62);
    const cGrass2 = new THREE.Color(0xa8dc6a);
    const cDark = new THREE.Color(0x4f9a4c);
    const cSand = new THREE.Color(0xe6d2a8);
    const cPink = new THREE.Color(0xf7c3d6);
    const cRoad = new THREE.Color(0x9ab85a);
    const colorFn = (x, z, h, info) => {
      const c = cGrass.clone();
      const n = fbm(noise2, x / 40, z / 40, 3);
      c.lerp(cGrass2, THREE.MathUtils.clamp(n * 0.8 + 0.4 + h * 0.012, 0, 1));
      c.lerp(cDark, THREE.MathUtils.clamp(info.slope * 2.2, 0, 0.6));
      c.lerp(cRoad, info.road * 0.35);
      const pn = petalNoise(x / 30, z / 30);
      if (pn > 0.35) c.lerp(cPink, Math.min(0.55, (pn - 0.35) * 2));
      if (h < WATER_Y + 1.4) c.lerp(cSand, THREE.MathUtils.clamp((WATER_Y + 1.4 - h) / 1.5, 0, 1));
      return c;
    };
    const terrain = buildTerrain(track, {
      size: 1250,
      segments: Math.round(230 * Math.max(0.7, detail)),
      center,
      height: heightFn,
      post,
      color: colorFn,
      blendOuter: 36,
    });
    scene.add(terrain.mesh);
    scene.add(buildFarGround(0x9fcf86, 18, 3200, 600));

    // --- вода
    const water = createWater({
      size: 1250,
      segments: 32,
      center,
      level: WATER_Y,
      deep: 0x2a86c8,
      shallow: 0x6fe6d8,
      foam: 0xffffff,
      sky: 0xcfe8ff,
      sunDir,
      sunColor: 0xfff4d8,
      heightMap: terrain.heightTexture(),
      wave: 0.06,
      sparkle: 1,
      sunPath: 0.6,
    });
    scene.add(water);
    updaters.push(water.userData.update);

    // --- горизонт: холмы, горы, Фудзи, облака
    scene.add(createMountainRing({ radius: 900, height: 110, baseY: -5, color: 0x8fc0a0, topColor: 0x9cc8b0, seed: 4, peaks: 11, fogColor: 0xf4dcec, fogAmount: 0.35 }));
    scene.add(createMountainRing({ radius: 1250, height: 260, baseY: -20, color: 0x8a92d8, topColor: 0xb0b8f0, snowLine: 0.72, snowColor: 0xf6f4ff, seed: 8, peaks: 7, fogColor: 0xf4dcec, fogAmount: 0.5 }));
    scene.add(makeFuji(new THREE.Vector3(1500, -40, 380), 900, 560));
    scene.add(createCumulus({ count: 16, radius: 1050, radiusJitter: 150, minY: 90, maxY: 200, scale: [60, 120], color: 0xffffff, shade: 0xbcd0f4, seed: 3 }));

    // --- декорации
    const avoidRiver = (x, z) => riverDist(x, z) < RIVER_HW + 5;
    const H = terrain.heightAt;
    const sk = scatterAround(track, H, { count: Math.round(260 * detail), minDist: 7, maxDist: 75, seed: 1, avoid: avoidRiver });
    scene.add(makeSakuraForest(sk, { outline, seed: 2 }));
    const farSk = scatterAround(track, H, { count: Math.round(160 * detail), minDist: 80, maxDist: 240, seed: 7, avoid: avoidRiver });
    scene.add(makeSakuraForest(farSk.map((p) => ({ x: p.x, y: p.y, z: p.z, s: 1.1 + Math.random() * 0.5 })), { outline: false, seed: 9 }));
    const pines = scatterAround(track, H, { count: Math.round(220 * detail), minDist: 60, maxDist: 320, seed: 3, avoid: avoidRiver, minY: 4 });
    scene.add(makePines(pines, { outline }));

    // бамбуковая роща вдоль "змейки"
    const bamboo = [];
    const rb = mulberry32(44);
    for (let f = 0.33; f < 0.47; f += 0.0035) {
      const fr = track.frameAtProgress(f * track.length, {});
      for (const side of [-1, 1]) {
        if (rb() < 0.35) continue;
        const d = fr.hw + fr.wall + 4 + rb() * 18;
        const x = fr.pos.x + fr.right.x * side * d;
        const z = fr.pos.z + fr.right.z * side * d;
        if (track.distanceTo(x, z, 40).dist < fr.hw + fr.wall + 3) continue;
        bamboo.push(new THREE.Vector3(x, H(x, z) - 0.2, z));
      }
    }
    scene.add(makeBamboo(bamboo, { outline }));

    // тоннель из тории
    const toriiMats = [];
    let maxHw = 0;
    for (let f = 0.53; f <= 0.6; f += 0.0005) maxHw = Math.max(maxHw, track.frameAtProgress(f * track.length, {}).hw + track.frameAtProgress(f * track.length, {}).wall);
    const span = (maxHw + 1.2) * 2;
    for (let s = 0.525 * track.length; s < 0.605 * track.length; s += 7.5) {
      const fr = track.frameAtProgress(s, {});
      const m = new THREE.Matrix4().makeBasis(fr.right.clone().negate(), new THREE.Vector3(0, 1, 0), fr.tan.clone().setY(0).normalize());
      m.setPosition(fr.pos.x, fr.pos.y - 0.3, fr.pos.z);
      toriiMats.push(m);
    }
    scene.add(makeToriiRow(toriiMats, span, 9.5));
    // большие тории у старта
    {
      const fr = track.frameAtProgress(0.12 * track.length, {});
      const m = new THREE.Matrix4().makeBasis(fr.right.clone().negate(), new THREE.Vector3(0, 1, 0), fr.tan.clone().setY(0).normalize());
      m.setPosition(fr.pos.x, fr.pos.y - 0.4, fr.pos.z);
      m.scale(new THREE.Vector3(1, 1.25, 1));
      scene.add(makeToriiRow([m], (fr.hw + fr.wall + 2) * 2, 11));
    }

    // фонари вдоль тоннеля и старта
    const lanterns = [];
    const addLanternsAlong = (f0, f1, step, off) => {
      for (let s = f0 * track.length; s < f1 * track.length; s += step) {
        const fr = track.frameAtProgress(s, {});
        for (const side of [-1, 1]) {
          const d = fr.hw + fr.wall + off;
          const x = fr.pos.x + fr.right.x * side * d;
          const z = fr.pos.z + fr.right.z * side * d;
          lanterns.push({ x, y: H(x, z) - 0.1, z, ry: Math.atan2(fr.tan.x, fr.tan.z) });
        }
      }
    };
    addLanternsAlong(0.9, 1.0, 24, 3.2);
    addLanternsAlong(0.0, 0.05, 24, 3.2);
    addLanternsAlong(0.5, 0.52, 10, 2.8);
    addLanternsAlong(0.61, 0.63, 10, 2.8);
    scene.add(makeStoneLanterns(lanterns));

    // флаги-нобори на стартовой прямой
    const flags = [];
    for (let s = 0.9 * track.length; s < 1.04 * track.length; s += 9) {
      const fr = track.frameAtProgress(s, {});
      for (const side of [-1, 1]) {
        const d = fr.hw + fr.wall + 1.6;
        const x = fr.pos.x + fr.right.x * side * d;
        const z = fr.pos.z + fr.right.z * side * d;
        flags.push({ x, y: H(x, z) - 0.2, z, ry: Math.atan2(fr.tan.x, fr.tan.z) + (side > 0 ? Math.PI : 0) });
      }
    }
    scene.add(makeNobori(flags));

    // пагода внутри шпильки
    {
      const a = track.frameAtProgress(0.765 * track.length, {});
      const b = track.frameAtProgress(0.815 * track.length, {});
      const c = track.frameAtProgress(0.79 * track.length, {});
      const px = (a.pos.x + b.pos.x) / 2 * 0.6 + c.pos.x * 0.4;
      const pz = (a.pos.z + b.pos.z) / 2 * 0.6 + c.pos.z * 0.4;
      const pagoda = makePagoda();
      const inward = new THREE.Vector3(px - c.pos.x, 0, pz - c.pos.z).normalize();
      const pp = new THREE.Vector3(c.pos.x, 0, c.pos.z).addScaledVector(inward, c.hw + c.wall + 14);
      pagoda.position.set(pp.x, H(pp.x, pp.z) - 0.5, pp.z);
      pagoda.rotation.y = Math.atan2(inward.x, inward.z);
      pagoda.scale.setScalar(0.95);
      scene.add(pagoda);
    }

    // перила мостов
    scene.add(makeBridgeRails(track, { color: 0xe23a2e, gold: 0xffc23a }));

    // камни у реки и по полям
    const rocks = scatterAround(track, H, { count: Math.round(70 * detail), minDist: 10, maxDist: 150, seed: 21 });
    const riverRocks = [];
    const rr = mulberry32(8);
    for (let i = 0; i < 90; i++) {
      const p = riverPts[Math.floor(rr() * riverPts.length)];
      const side = rr() < 0.5 ? -1 : 1;
      const x = p.x + (rr() - 0.5) * 10;
      const z = p.z + side * (RIVER_HW - 1 + rr() * 5);
      if (track.distanceTo(x, z, 40).dist < 22) continue;
      riverRocks.push(new THREE.Vector3(x, H(x, z) - 0.3, z));
    }
    scene.add(makeRocks([...rocks.map((p) => ({ x: p.x, y: p.y - 0.3, z: p.z })), ...riverRocks], { color: 0xa9a3a0 }));

    // трава, цветы, кусты у дороги
    const grass = scatterAround(track, H, { count: Math.round(2600 * detail), minDist: 0.5, maxDist: 45, seed: 31, avoid: (x, z) => riverDist(x, z) < RIVER_HW });
    scene.add(makeGrass(grass));
    const flowers = scatterAround(track, H, { count: Math.round(1600 * detail), minDist: 1, maxDist: 55, seed: 41, avoid: avoidRiver });
    scene.add(makeFlowers(flowers));
    const bushes = scatterAround(track, H, { count: Math.round(120 * detail), minDist: 2, maxDist: 30, seed: 51, avoid: avoidRiver });
    scene.add(makeBushes(bushes, { outline }));

    // летящие лепестки
    const ambientCount = 700;
    const petals = createAmbientParticles({ count: ambientCount, box: [80, 36, 80], fall: 1.3, sway: 1.4, size: 1.35, color: 0xffd0e4, color2: 0xff8fbf });
    petals.userData.setCount(Math.round(ambientCount * (quality.particles ?? 1)));
    scene.add(petals);
    updaters.push(petals.userData.update);

    return {
      sky,
      lights,
      updaters,
      ambient: petals,
      ambientCount,
      dustColor: new THREE.Color(0xb7d88a),
      bloom: { strength: 0.45, radius: 0.55, threshold: 1.25 },
      exposure: 1.0,
      post: { saturation: 1.08, vignette: 0.26 },
      minimap: { road: '#ffffff', edge: '#ff6fa8', bg: 'rgba(255,240,248,0.35)' },
    };
  },
};

function makeFuji(pos, radius, height) {
  const pts = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // вогнутый профиль вулкана с плоской вершиной
    const r = radius * (0.06 + 0.94 * Math.pow(1 - t, 1.9));
    pts.push(new THREE.Vector2(r, t * height));
  }
  pts.push(new THREE.Vector2(0, height));
  const geo = new THREE.LatheGeometry(pts, 64);
  const pos3 = geo.getAttribute('position');
  const cols = new Float32Array(pos3.count * 3);
  const base = new THREE.Color(0x7d86cc);
  const top = new THREE.Color(0x9aa4e6);
  const snow = new THREE.Color(0xfbfaff);
  const fog = new THREE.Color(0xf4dcec);
  const noise = createNoise2D(3);
  const c = new THREE.Color();
  for (let i = 0; i < pos3.count; i++) {
    const x = pos3.getX(i);
    const y = pos3.getY(i);
    const z = pos3.getZ(i);
    const t = y / height;
    const a = Math.atan2(z, x);
    c.copy(base).lerp(top, t);
    const snowLine = 0.62 + noise(Math.cos(a) * 3, Math.sin(a) * 3) * 0.1 + Math.sin(a * 9) * 0.04;
    if (t > snowLine) c.copy(snow).lerp(new THREE.Color(0xdfe2ff), Math.max(0, 0.3 - (t - snowLine)));
    // лёгкая тень на одной стороне
    const side = Math.max(0, Math.cos(a - 2.4));
    c.multiplyScalar(1 - side * 0.12);
    c.lerp(fog, 0.35 * (1 - t * 0.5));
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  m.position.copy(pos);
  m.name = 'fuji';
  m.frustumCulled = false;
  return m;
}

export { trs };
