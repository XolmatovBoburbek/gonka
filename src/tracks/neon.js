// Локация 2: "Неон-Токио" — ночной аниме-город: небоскрёбы с огнями окон, неоновые вывески, голографические экраны,
// телебашня, эстакада над стартовым бульваром, аллея бумажных фонариков, парк ночной сакуры, канал и электричка.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { neonLayout, CANAL, CANAL_HW, TOWER, PARK } from './neonLayout.js';
import { createSky, createLights, mulberry32 } from '../world/sky.js';
import { buildTerrain, buildFarGround } from '../world/terrain.js';
import { createWater } from '../world/water.js';
import { createNoise2D, fbm, smoothstep } from '../world/noise.js';
import { PolylineDistance } from '../world/geom.js';
import { toon, glow, normalizeGeometry, outlineGeometry, outlineMaterial } from '../world/toon.js';
import { makeSakuraForest, makeStoneLanterns, createAmbientParticles } from '../world/props.js';
import {
  makeBuildings,
  makeSignAtlas,
  makeSigns,
  makeHoloScreen,
  makeBlinkers,
  makeLightPools,
  makeStreetLamps,
  makeVending,
  makeLanternStrings,
  makeTower,
  makeTrain,
  instancedParts,
  NEON,
} from './neonProps.js';

// расстояние до канала
const canalPts = new THREE.CatmullRomCurve3(CANAL.map(([x, z]) => new THREE.Vector3(x, 0, z))).getSpacedPoints(360);
const canalField = new PolylineDistance(canalPts, { cell: 40, maxDist: 90 });
const canalDist = (x, z) => canalField.dist(x, z);

const WATER_Y = -2.2;
const GROUND_Y = -0.3;
const TRAIN_X = 262; // эстакада электрички (с севера на юг)
const TRAIN_Y = 10;

export const neon = {
  id: 'neon',
  name: 'Неон-Токио',
  jp: 'ネオン東京',
  time: 'Ночной город',
  description: 'Ночная восьмёрка по неоновому Токио: бульвар под эстакадой, аллея бумажных фонариков и скоростной хайвей вокруг телебашни.',
  music: 'neon',
  card: ['#8a3cff', '#ff3ad0'],
  ...neonLayout,
  itemRows: [0.075, 0.225, 0.525, 0.62, 0.93],
  boostPads: [
    { at: 0.1, lateral: 4.5, length: 9, width: 5 },
    { at: 0.245, lateral: -4, length: 9, width: 5 },
    { at: 0.455, lateral: 0, length: 9, width: 5 },
    { at: 0.585, lateral: -4, length: 9, width: 5 },
    { at: 0.955, lateral: 4.5, length: 9, width: 5 },
  ],
  ramps: [{ at: 0.205, lateral: 3.5, width: 8, length: 8, height: 1.4 }],
  theme: {
    road: {
      base: '#2e2c40',
      grain: 0.12,
      edgeLine: '#ffd6f4',
      centerLine: '#c8f8ff',
      laneLines: '#6a6690',
      emissive: { edge: '#ff4fd8', center: '#35e8ff', intensity: 1.5 },
    },
    curb: { a: '#ff3ad0', b: '#f2ecff', width: 1.5 },
    wall: { style: 'neon', base: 0x2a2640, glowA: 0x35e8ff, glowB: 0xff3ad0, intensity: 2.4, height: 0.75 },
    deck: { color: 0x3c3854, side: 0x2e2a44, depth: 1.8 },
    gate: { pillar: 0x2a2440, accent: 0xff3ad0, bannerA: '#8a3cff', bannerB: '#ff3ad0', text: 'NEON  TOKYO  GP' },
    boost: { a: '#39f3ff', b: '#ff9af0', intensity: 2.2 },
    ramp: { a: '#ff3ad0', b: '#ffffff', side: 0x8a3cff },
  },

  prepare(track) {
    // эстакада и мост через канал
    track.markSections((p) => p.y > 0.9 || canalDist(p.x, p.z) < CANAL_HW + 10, { bridge: true, wall: 2.6 });
  },

  build({ scene, track, quality }) {
    const detail = quality.detail ?? 1;
    const outline = detail >= 0.8;
    const updaters = [];
    const rnd = mulberry32(2024);
    const N = track.count;
    const L = track.length;
    const moonDir = new THREE.Vector3(0.66, 0.42, -0.62).normalize();
    const glowDir = new THREE.Vector3(0.95, -0.06, 0.3).normalize();

    // --- небо, туман, свет
    const sky = createSky({
      top: 0x060824,
      mid: 0x2a1660,
      horizon: 0xc8468c,
      bottom: 0x1a0c2c,
      midPos: 0.2,
      sunDir: glowDir,
      sunColor: 0xff7a5a,
      sunBright: 1,
      glowColor: 0xff6a6a,
      sunSize: 0.01,
      sunGlow: 0.55,
      horizonGlow: 0.55,
      cloudCover: 0.2,
      cloudScale: 1.1,
      cloudLight: 0x4a3a8a,
      cloudShade: 0x1c1846,
      cloudRim: 0xff8ad0,
      cloudOpacity: 0.55,
      stars: 1.3,
      moonDir,
      moonSize: 0.055,
      moonColor: 0xfff0dc,
    });
    scene.add(sky);
    updaters.push(sky.userData.update);
    const fogColor = 0x2a1848;
    scene.fog = new THREE.FogExp2(fogColor, 0.0019);
    const lights = createLights(scene, {
      sunDir: moonDir,
      sunColor: 0xc0c4ff,
      sunIntensity: 1.25,
      hemiSky: 0xa89cff,
      hemiGround: 0x7a4a80,
      hemiIntensity: 1.9,
      shadowExtent: 75,
    });

    // --- земля города с каналом
    const center = track.bounds.getCenter(new THREE.Vector3());
    center.y = 0;
    const noise = createNoise2D(21);
    const post = (x, z, h) => {
      const rd = canalDist(x, z);
      const carve = 1 - smoothstep(CANAL_HW - 4, CANAL_HW - 1, rd);
      if (carve <= 0) return h;
      return THREE.MathUtils.lerp(h, -4.6, carve);
    };
    const cBase = new THREE.Color(0x2e2b44);
    const cBase2 = new THREE.Color(0x3a3450);
    const cWalk = new THREE.Color(0x4a4560);
    const cGrass = new THREE.Color(0x1e4a4a);
    const cPlaza = new THREE.Color(0x4a4058);
    const cBed = new THREE.Color(0x151222);
    const colorFn = (x, z, h, info) => {
      const c = cBase.clone().lerp(cBase2, THREE.MathUtils.clamp(fbm(noise, x / 50, z / 50, 3) * 0.8 + 0.4, 0, 1));
      c.lerp(cWalk, info.road * 0.5);
      const pd = Math.hypot(x - PARK.x, z - PARK.z);
      if (pd < PARK.r + 4) c.lerp(cGrass, 1 - smoothstep(PARK.r - 4, PARK.r + 4, pd));
      const td = Math.hypot(x - TOWER[0], z - TOWER[1]);
      if (td < 40) c.lerp(cPlaza, 1 - smoothstep(30, 40, td));
      if (h < -1) c.lerp(cBed, THREE.MathUtils.clamp((-1 - h) / 2, 0, 1));
      return c;
    };
    const terrain = buildTerrain(track, {
      size: 1150,
      segments: Math.round(200 * Math.max(0.7, detail)),
      center,
      height: () => GROUND_Y,
      post,
      color: colorFn,
      blendOuter: 20,
      roadDrop: 0.2,
    });
    scene.add(terrain.mesh);
    scene.add(buildFarGround(0x1c1430, GROUND_Y - 0.1, 3200, 560));
    const H = terrain.heightAt;

    // --- канал: вода, стенки набережной, променад
    {
      const water = createWater({
        size: 100,
        segments: 2,
        center,
        level: WATER_Y,
        deep: 0x0a0826,
        shallow: 0x2a1a60,
        foam: 0xff7ad8,
        sky: 0xff4a9a,
        sunDir: moonDir,
        sunColor: 0xfff0e0,
        heightMap: terrain.heightTexture(),
        wave: 0.03,
        sparkle: 1.4,
        sunPath: 1,
      });
      water.geometry.dispose();
      water.geometry = canalRibbon(canalPts, CANAL_HW + 0.5, 0, 0, 0);
      water.position.set(0, WATER_Y, 0);
      scene.add(water);
      updaters.push(water.userData.update);
      const walls = [];
      const tops = [];
      for (const s of [-1, 1]) {
        walls.push(canalRibbon(canalPts, CANAL_HW, 0.12, -4.8, s, true));
        tops.push(canalRibbon(canalPts, CANAL_HW + 3.2, 0.12, 0.12, s, false, CANAL_HW));
      }
      const wm = new THREE.Mesh(mergeList(walls), toon(0x4c4868, { side: THREE.DoubleSide }));
      const tm = new THREE.Mesh(mergeList(tops), toon(0x6a6488, { ramp: 'terrain' }));
      wm.receiveShadow = tm.receiveShadow = true;
      scene.add(wm, tm);
      // огоньки вдоль набережной
      const bollards = [];
      for (let i = 0; i < canalPts.length; i += 3) {
        const p = canalPts[i];
        const q = canalPts[Math.min(canalPts.length - 1, i + 1)];
        const d = new THREE.Vector3().subVectors(q, p).setY(0).normalize();
        for (const s of [-1, 1]) {
          const x = p.x - d.z * s * (CANAL_HW + 0.6);
          const z = p.z + d.x * s * (CANAL_HW + 0.6);
          if (track.distanceTo(x, z, 30).dist < 16) continue;
          bollards.push({ x, y: 0.9, z, phase: -1 });
        }
      }
      const bl = makeBlinkers(bollards, { color: 0xffc080, size: 0.9 });
      scene.add(bl);
    }

    // --- обочины и тротуары вдоль дороги (кроме эстакады)
    const cw = 1.5;
    const groundRanges = track.ranges((i) => (track.flags[i] & 1) === 0);
    {
      const walkTex = tileTexture();
      const shoulderMat = toon(0x3a3654, { ramp: 'terrain' });
      const walkMat = toon(0xffffff, { map: walkTex, ramp: 'terrain' });
      const sh = [];
      const wk = [];
      for (const [a, b] of groundRanges) {
        for (const s of [-1, 1]) {
          let prof = [
            { k: s, c: s * (cw - 0.02), y: -0.02, u: 0 },
            { k: s, w: s, c: s * 0.05, y: -0.02, u: 1 },
          ];
          if (s < 0) prof.reverse();
          sh.push(track.extrude(prof, { from: a, to: b, vScale: 6 }));
          prof = [
            { k: s, w: s, c: s * 0.45, y: 0.14, u: 0 },
            { k: s, w: s, c: s * 6.5, y: 0.14, u: 1 },
            { k: s, w: s, c: s * 6.6, y: -0.45, u: 1 },
          ];
          if (s < 0) prof.reverse();
          wk.push(track.extrude(prof, { from: a, to: b, vScale: 6.5 }));
        }
      }
      const shm = new THREE.Mesh(mergeList(sh), shoulderMat);
      shoulderMat.polygonOffset = true;
      shoulderMat.polygonOffsetFactor = -1;
      shoulderMat.polygonOffsetUnits = -1;
      const wkm = new THREE.Mesh(mergeList(wk), walkMat);
      shm.receiveShadow = wkm.receiveShadow = true;
      scene.add(shm, wkm);
    }

    // --- эстакада: опоры, подпорные стенки на въезде, вывеска над бульваром
    const bridgeRanges = track.ranges((i) => (track.flags[i] & 1) !== 0);
    const groundIdx = [];
    for (let i = 0; i < N; i++) if (track.pos[i].y < 0.9) groundIdx.push(i);
    const clearOfGroundRoad = (x, z, margin) => {
      for (const i of groundIdx) {
        const p = track.pos[i];
        const dx = x - p.x;
        const dz = z - p.z;
        const need = track.hw[i] + track.wall[i] + margin;
        if (dx * dx + dz * dz < need * need) return false;
      }
      return true;
    };
    {
      const colMats = [];
      const capMats = [];
      const skirts = [];
      const deckDepth = 1.8;
      const up = new THREE.Vector3(0, 1, 0);
      for (const [a, b] of bridgeRanges) {
        // подпорные стенки там, где эстакада низко
        const low = [];
        for (let i = a; i <= b; i++) low.push(track.pos[i % N].y < 5.5 && track.pos[i % N].y > 0.3);
        for (const s of [-1, 1]) skirts.push(skirtGeometry(track, a, b, s, low));
        const step = Math.max(1, Math.round(21 / track.spacing));
        for (let i = a + 4; i <= b - 4; i += step) {
          const j = i % N;
          const P = track.pos[j];
          if (P.y < 5.5) continue;
          if (!clearOfGroundRoad(P.x, P.z, 4)) continue;
          if (canalDist(P.x, P.z) < CANAL_HW - 1 && canalDist(P.x, P.z) > CANAL_HW - 5) continue;
          const T = track.tan[j];
          const ry = Math.atan2(T.x, T.z);
          const top = P.y - deckDepth - 0.4;
          const m = new THREE.Matrix4().compose(new THREE.Vector3(P.x, GROUND_Y, P.z), new THREE.Quaternion().setFromAxisAngle(up, ry), new THREE.Vector3(1, top - GROUND_Y - 1.2, 1));
          colMats.push(m);
          const span = (track.hw[j] + track.wall[j]) * 2 + 1;
          const c = new THREE.Matrix4().compose(new THREE.Vector3(P.x, top - 1.3, P.z), new THREE.Quaternion().setFromAxisAngle(up, ry), new THREE.Vector3(span, 1, 1));
          capMats.push(c);
        }
      }
      const colGeo = normalizeGeometry(new THREE.CylinderGeometry(1.5, 1.7, 1, 10).translate(0, 0.5, 0));
      const capGeo = normalizeGeometry(new THREE.BoxGeometry(1, 1.5, 2.8).translate(0, 0.75, 0));
      const concrete = toon(0x514c6c, { rim: 0.25 });
      scene.add(instancedParts([{ geo: colGeo, mat: concrete, outline: outline ? 0.08 : 0 }], colMats, { name: 'piers' }));
      scene.add(instancedParts([{ geo: capGeo, mat: concrete, outline: outline ? 0.08 : 0 }], capMats, { name: 'pier-caps' }));
      const sk = new THREE.Mesh(mergeList(skirts), toon(0x3a3654, { side: THREE.DoubleSide }));
      sk.receiveShadow = true;
      scene.add(sk);
      // неоновая полоса снизу вдоль кромки эстакады
      const under = [];
      for (const [a, b] of bridgeRanges) {
        for (const s of [-1, 1]) {
          const prof = [
            { k: s, w: s, c: s * 0.62, y: -deckDepth + 0.35 },
            { k: s, w: s, c: s * 0.62, y: -deckDepth + 0.6 },
          ];
          if (s < 0) prof.reverse();
          under.push(track.extrude(prof, { from: a, to: b }));
        }
      }
      scene.add(new THREE.Mesh(mergeList(under), glow(0xb06bff, 2.0, { side: THREE.DoubleSide })));
    }

    // вывеска "ネオン東京" на эстакаде над стартовым бульваром
    {
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < N; i++) {
        const p = track.pos[i];
        if (p.y < 10) continue;
        const d = Math.abs(p.z);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best >= 0) {
        const P = track.pos[best];
        const R = track.right[best];
        const tex = bannerTexture('ネオン東京', 'NEON TOKYO  ★  夜のグランプリ');
        const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6) });
        for (const s of [-1, 1]) {
          const off = s * (track.hw[best] + track.wall[best] + 0.75);
          const g = new THREE.PlaneGeometry(30, 4.2);
          const m = new THREE.Mesh(g, mat);
          m.position.set(P.x + R.x * off, P.y - 0.9, P.z + R.z * off);
          m.rotation.y = Math.atan2(R.x * s, R.z * s);
          scene.add(m);
        }
      }
    }

    // --- город: здания вдоль трассы + кварталы + дальний силуэт
    const occ = new Map();
    const OC = 3;
    const okey = (x, z) => Math.floor(x / OC) * 100003 + Math.floor(z / OC);
    const footprint = (b, pad = 0) => {
      const pts = [];
      const cs = Math.cos(b.ry);
      const sn = Math.sin(b.ry);
      const hw = b.w / 2 + pad;
      const hd = b.d / 2 + pad;
      const nu = Math.max(1, Math.ceil((hw * 2) / 2.8));
      const nv = Math.max(1, Math.ceil((hd * 2) / 2.8));
      for (let iu = 0; iu <= nu; iu++) {
        for (let iv = 0; iv <= nv; iv++) {
          const lu = -hw + (iu / nu) * hw * 2;
          const lv = -hd + (iv / nv) * hd * 2;
          // локальная +Z → (sin ry, cos ry)
          pts.push([b.x + lu * cs + lv * sn, b.z - lu * sn + lv * cs, iu === 0 || iv === 0 || iu === nu || iv === nv]);
        }
      }
      return pts;
    };
    const reserved = []; // [{x,z,r}]
    const fits = (b, margin) => {
      const pts = footprint(b);
      for (const [x, z, edge] of pts) {
        if (occ.has(okey(x, z))) return false;
        if (!edge) continue;
        const { dist, index } = track.distanceTo(x, z, 70);
        if (index >= 0 && dist < track.hw[index] + track.wall[index] + margin) return false;
        if (canalDist(x, z) < CANAL_HW + 4) return false;
        if (Math.hypot(x - PARK.x, z - PARK.z) < PARK.r) return false;
        if (Math.abs(x - TRAIN_X) < 6) return false;
        for (const r of reserved) if (Math.hypot(x - r.x, z - r.z) < r.r) return false;
      }
      return true;
    };
    const claim = (b) => {
      for (const [x, z] of footprint(b, 0.5)) occ.set(okey(x, z), 1);
    };
    const buildings = [];
    const wallCols = [0x2a2a4a, 0x322848, 0x1f3044, 0x3a3052, 0x283a4a, 0x40324e, 0x4a4466, 0x2c2c3c];
    const addBuilding = (b) => {
      b.color = b.color ?? wallCols[Math.floor(rnd() * wallCols.length)];
      b.hue = b.hue ?? Math.floor(rnd() * NEON.length);
      b.seed = rnd() * 1000;
      b.lit = b.lit ?? 0.35 + rnd() * 0.45;
      b.y = b.y ?? GROUND_Y;
      buildings.push(b);
      claim(b);
      return b;
    };
    reserved.push({ x: TOWER[0], z: TOWER[1], r: 36 });

    // особые здания: экраны в перспективе главных прямых
    const screens = [];
    const special = (x, z, w, d, h, ry, screen) => {
      const b = addBuilding({ x, z, w, d, h, ry, type: 0, lit: 0.5 });
      if (screen) screens.push({ b, ...screen });
      return b;
    };
    special(262 + 30, -18, 26, 22, 58, -Math.PI / 2, { w: 22, h: 12.5, y: 34, mode: 0, text: 'ネオン東京 ♥ SAKURA DRIFT ♥ 夜のレース', a: 0xff3ad0, b: 0x5a2cff, c: 0x35e8ff });
    special(22, -236, 30, 22, 62, 0, { w: 26, h: 14.6, y: 38, mode: 1, text: '', a: 0xff3ad0, b: 0x2a0a6a, c: 0xff8a3a });
    special(214, 272, 26, 18, 40, Math.PI, { w: 20, h: 11.2, y: 22, mode: 0, text: 'カラオケ ★ ゲーム ★ ラーメン ★ アニメ', a: 0x35e8ff, b: 0xff3ad0, c: 0xffe14a });

    // фасады вдоль трассы
    const front = [];
    const alley = (s) => s > 0.305 * L && s < 0.41 * L;
    const lowZone = (x, z) => (x > 212 && x < TRAIN_X + 4) || (x > 140 && x < 250 && z > -60 && z < 12);
    for (const side of [-1, 1]) {
      let s = rnd() * 10;
      while (s < L) {
        const fr = track.frameAtProgress(s, {});
        const i = fr.index;
        const bridge = (track.flags[i] & 1) !== 0;
        const w = 10 + rnd() * 12;
        const d = 10 + rnd() * 9;
        const set = fr.hw + fr.wall + (bridge ? 4.5 : 7.5) + rnd() * 3;
        const nx = fr.right.x * side;
        const nz = fr.right.z * side;
        const x = fr.pos.x + nx * (set + d / 2);
        const z = fr.pos.z + nz * (set + d / 2);
        let h;
        if (alley(s)) h = 7 + rnd() * 6;
        else if (bridge) h = fr.pos.y + 10 + rnd() * 30 + (rnd() < 0.2 ? 30 : 0);
        else h = 10 + rnd() * 22 + (rnd() < 0.18 ? 30 + rnd() * 25 : 0);
        if (lowZone(x, z)) h = Math.min(h, 8 + rnd() * 2);
        const b = { x, z, w, d, h, ry: Math.atan2(-nx, -nz), type: alley(s) ? 1 : rnd() < 0.5 ? 0 : rnd() < 0.7 ? 1 : 2 };
        if (fits(b, bridge ? 3.5 : 6.5)) {
          addBuilding(b);
          front.push({ b, s, side, bridge, alley: alley(s) });
          s += w + 0.5 + rnd() * 3;
        } else s += 3;
      }
    }

    // кварталы
    const grid = 26;
    for (let gx = -560; gx <= 560; gx += grid) {
      for (let gz = -560; gz <= 560; gz += grid) {
        const x = gx + (rnd() - 0.5) * 8;
        const z = gz + (rnd() - 0.5) * 8;
        const dc = Math.hypot(x - center.x, z - center.z);
        if (dc > 575) continue;
        const td = track.distanceTo(x, z, 90).dist;
        const w = 12 + rnd() * 12;
        const d = 12 + rnd() * 12;
        const down = Math.hypot(x - 380, z + 120) < 230;
        let h = 14 + rnd() * 30 + Math.min(60, Math.max(0, td - 40) * 0.35) + (rnd() < 0.15 ? 40 : 0);
        if (down) h += 30 + rnd() * 70;
        if (lowZone(x, z)) h = Math.min(h, 10);
        const b = { x, z, w, d, h, ry: rnd() < 0.8 ? 0 : (rnd() - 0.5) * 0.6, type: down ? (rnd() < 0.6 ? 2 : 0) : rnd() < 0.45 ? 0 : rnd() < 0.7 ? 1 : 2 };
        if (fits(b, 8)) addBuilding(b);
      }
    }
    // дальний силуэт
    const far = Math.round(300 * Math.max(0.6, detail));
    for (let k = 0; k < far; k++) {
      const a = rnd() * Math.PI * 2;
      const r = 600 + rnd() * 420;
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      const w = 20 + rnd() * 22;
      const d = 20 + rnd() * 22;
      const downtown = Math.cos(a - Math.atan2(-120 - center.z, 380 - center.x)) > 0.75;
      const h = 30 + rnd() * 70 + (downtown ? 60 + rnd() * 100 : rnd() < 0.2 ? 60 : 0);
      addBuilding({ x, z, w, d, h, ry: rnd() * Math.PI, type: rnd() < 0.5 ? 2 : 0, lit: 0.3 + rnd() * 0.4 });
    }
    const bmesh = makeBuildings(buildings, { moonDir });
    scene.add(bmesh);

    // крыши: техника, антенны и красные огни
    {
      const roofMats = [];
      const antMats = [];
      const blink = [];
      for (const b of buildings) {
        const cs = Math.cos(b.ry);
        const sn = Math.sin(b.ry);
        const top = b.y + b.h;
        const place = (lu, lv) => [b.x + lu * cs + lv * sn, b.z - lu * sn + lv * cs];
        const nearTrack = Math.hypot(b.x - center.x, b.z - center.z) < 560;
        if (nearTrack && b.h < 70) {
          const n = 1 + Math.floor(rnd() * 3);
          for (let k = 0; k < n; k++) {
            const [x, z] = place((rnd() - 0.5) * (b.w - 4), (rnd() - 0.5) * (b.d - 4));
            const s = 1.5 + rnd() * 2.5;
            roofMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, top, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.ry), new THREE.Vector3(s, 0.8 + rnd() * 1.5, s * (0.6 + rnd() * 0.8))));
          }
        }
        if (b.h > 42) {
          for (const [cu, cv] of [
            [1, 1],
            [-1, -1],
            [1, -1],
            [-1, 1],
          ].slice(0, b.h > 80 ? 4 : 2)) {
            const [x, z] = place(cu * (b.w / 2 - 0.6), cv * (b.d / 2 - 0.6));
            blink.push({ x, y: top + 0.6, z, phase: rnd() });
          }
          if (rnd() < 0.5) {
            const ah = 6 + rnd() * 12;
            antMats.push(new THREE.Matrix4().compose(new THREE.Vector3(b.x, top, b.z), new THREE.Quaternion(), new THREE.Vector3(1, ah, 1)));
            blink.push({ x: b.x, y: top + ah + 0.4, z: b.z, phase: rnd() });
          }
        }
      }
      const roofGeo = normalizeGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
      scene.add(instancedParts([{ geo: roofGeo, mat: toon(0x5a5676), shadow: false }], roofMats, { name: 'roof-units' }));
      const antGeo = normalizeGeometry(new THREE.CylinderGeometry(0.12, 0.3, 1, 5).translate(0, 0.5, 0));
      scene.add(instancedParts([{ geo: antGeo, mat: toon(0x8a86a0), shadow: false }], antMats, { name: 'antennas' }));
      const bl = makeBlinkers(blink, { color: 0xff2a3a, size: 1.6 });
      scene.add(bl);
      updaters.push(bl.userData.update);
    }

    // голографические экраны
    for (const sc of screens) {
      const { b } = sc;
      const mesh = makeHoloScreen(sc.w, sc.h, { mode: sc.mode, text: sc.text, a: sc.a, b: sc.b, c: sc.c });
      const off = b.d / 2 + 0.6;
      mesh.position.set(b.x + Math.sin(b.ry) * off, sc.y, b.z + Math.cos(b.ry) * off);
      mesh.rotation.y = b.ry;
      scene.add(mesh);
      updaters.push(mesh.userData.update);
      // рама
      const fr = new THREE.Mesh(new THREE.BoxGeometry(sc.w + 1.2, sc.h + 1.2, 0.8), toon(0x1a1628));
      fr.position.copy(mesh.position).addScaledVector(new THREE.Vector3(Math.sin(b.ry), 0, Math.cos(b.ry)), -0.45);
      fr.rotation.y = b.ry;
      scene.add(fr);
    }

    // --- неоновые вывески на фасадах
    const atlas = makeSignAtlas(7);
    const signs = [];
    const signBacks = [];
    for (const f of front) {
      const { b } = f;
      if (Math.hypot(b.x - center.x, b.z - center.z) > 560) continue;
      const fx = Math.sin(b.ry);
      const fz = Math.cos(b.ry);
      const tx = Math.cos(b.ry);
      const tz = -Math.sin(b.ry);
      const baseY = f.bridge ? Math.max(5, track.frameAtProgress(f.s, {}).pos.y - 4) : 4.8;
      const topY = Math.min(b.y + b.h - 2.5, baseY + 22);
      // вертикальная вывеска на углу, торчит перпендикулярно фасаду
      if (rnd() < 0.62 && topY - baseY > 7) {
        const hh = Math.min(10, 6 + rnd() * 4);
        const ww = hh / 4;
        const cy = baseY + hh / 2 + rnd() * Math.max(0, topY - baseY - hh);
        const lu = (rnd() < 0.5 ? -1 : 1) * (b.w / 2 - 1.4);
        const px = b.x + fx * (b.d / 2 + ww / 2 + 0.25) + tx * lu;
        const pz = b.z + fz * (b.d / 2 + ww / 2 + 0.25) + tz * lu;
        const idx = Math.floor(rnd() * 16);
        const ry = b.ry + Math.PI / 2;
        for (const flip of [0, Math.PI]) {
          signs.push({ x: px + Math.sin(ry + flip) * 0.18, y: cy, z: pz + Math.cos(ry + flip) * 0.18, ry: ry + flip, w: ww, h: hh, kind: 'v', index: idx, bright: 1.45, flicker: rnd() < 0.08 });
        }
        signBacks.push(new THREE.Matrix4().compose(new THREE.Vector3(px, cy, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(ww + 0.25, hh + 0.25, 0.3)));
      }
      // горизонтальные вывески на фасаде
      const nh = rnd() < 0.75 ? 1 + Math.floor(rnd() * 2) : 0;
      const used = [];
      for (let k = 0; k < nh; k++) {
        const ww = Math.min(b.w * 0.8, 6 + rnd() * 6);
        const hh = ww / 4;
        const cy = baseY + hh / 2 + 0.5 + rnd() * Math.max(0, topY - baseY - hh - 1);
        if (used.some((u) => Math.abs(u - cy) < hh + 0.8)) continue;
        used.push(cy);
        const lu = (rnd() - 0.5) * (b.w - ww - 1);
        signs.push({ x: b.x + fx * (b.d / 2 + 0.07) + tx * lu, y: cy, z: b.z + fz * (b.d / 2 + 0.07) + tz * lu, ry: b.ry, w: ww, h: hh, kind: 'h', index: Math.floor(rnd() * 16), bright: 1.35, flicker: rnd() < 0.06 });
      }
      // большая вывеска на крыше невысоких домов
      if (!f.bridge && b.h < 24 && rnd() < 0.3) {
        const ww = Math.min(b.w * 0.9, 12);
        const hh = ww / 4;
        const y = b.y + b.h + 1.4 + hh / 2;
        signs.push({ x: b.x + fx * (b.d / 2 - 1.5), y, z: b.z + fz * (b.d / 2 - 1.5), ry: b.ry, w: ww, h: hh, kind: 'h', index: Math.floor(rnd() * 16), bright: 1.6 });
        signBacks.push(new THREE.Matrix4().compose(new THREE.Vector3(b.x + fx * (b.d / 2 - 1.75), y - 0.9, b.z + fz * (b.d / 2 - 1.75)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.ry), new THREE.Vector3(ww * 0.8, hh + 1.8, 0.3)));
      }
    }
    const signMesh = makeSigns(signs, atlas);
    scene.add(signMesh);
    updaters.push(signMesh.userData.update);
    scene.add(instancedParts([{ geo: normalizeGeometry(new THREE.BoxGeometry(1, 1, 1)), mat: toon(0x1c1828), outline: outline ? 0.05 : 0, shadow: false }], signBacks, { name: 'sign-backs' }));

    // --- телебашня
    {
      const tw = makeTower({ height: 150, outline });
      tw.group.position.set(TOWER[0], GROUND_Y, TOWER[1]);
      tw.group.rotation.y = 0.3;
      scene.add(tw.group);
      const cs = Math.cos(0.3);
      const sn = Math.sin(0.3);
      const tr = (p) => ({ x: TOWER[0] + p.x * cs + p.z * sn, y: p.y + GROUND_Y, z: TOWER[1] - p.x * sn + p.z * cs, phase: p.phase });
      const red = makeBlinkers(tw.blink.map(tr), { color: 0xff2a3a, size: 2.2 });
      const warm = makeBlinkers(tw.warm.map(tr), { color: 0xffb060, size: 1.6 });
      scene.add(red, warm);
      updaters.push(red.userData.update);
    }

    // --- фонари, автоматы, световые пятна
    const pools = [];
    {
      const lamps = [];
      const step = 24;
      for (let s = 3; s < L; s += step) {
        const fr = track.frameAtProgress(s, {});
        const bridge = (track.flags[fr.index] & 1) !== 0;
        if (alley(s)) continue;
        for (const side of [-1, 1]) {
          if ((Math.floor(s / step) + (side > 0 ? 1 : 0)) % 2 && !bridge) continue;
          const lat = side * (fr.hw + fr.wall + (bridge ? 0.3 : 1.6));
          const x = fr.pos.x + fr.right.x * lat;
          const z = fr.pos.z + fr.right.z * lat;
          const y = fr.pos.y + (bridge ? 0 : 0.14);
          lamps.push({ x, y, z, ry: Math.atan2(-fr.right.x * side, -fr.right.z * side) });
          const pl = side * (fr.hw + fr.wall + (bridge ? 0.3 : 1.6) - 2.35);
          pools.push({ x: fr.pos.x + fr.right.x * pl, y: fr.pos.y + 0.06, z: fr.pos.z + fr.right.z * pl, r: 5.5, color: 0xffd6a0, i: 0.2 });
        }
      }
      scene.add(makeStreetLamps(lamps, { outline }));

      const vend = [];
      const vcols = [0xffffff, 0xff4a5a, 0x3a8aff, 0xffffff, 0xffd23a];
      for (const [a, b] of groundRanges) {
        for (let i = a + 6; i < b - 6; i += 9 + Math.floor(rnd() * 14)) {
          if (rnd() < 0.45) continue;
          const j = i % N;
          const s = j * track.spacing;
          if (alley(s)) continue;
          const side = rnd() < 0.5 ? -1 : 1;
          const fr = track.frameAtProgress(s, {});
          const n = 2 + Math.floor(rnd() * 2);
          const ry = Math.atan2(-fr.right.x * side, -fr.right.z * side);
          for (let k = 0; k < n; k++) {
            const lat = side * (fr.hw + fr.wall + 5.6);
            const along = (k - (n - 1) / 2) * 1.3;
            const x = fr.pos.x + fr.right.x * lat + fr.tan.x * along;
            const z = fr.pos.z + fr.right.z * lat + fr.tan.z * along;
            vend.push({ x, y: fr.pos.y + 0.14, z, ry, color: vcols[Math.floor(rnd() * vcols.length)] });
          }
          const pl = side * (fr.hw + fr.wall + 4.2);
          pools.push({ x: fr.pos.x + fr.right.x * pl, y: fr.pos.y + 0.2, z: fr.pos.z + fr.right.z * pl, r: 2.6, color: 0xbfe8ff, i: 0.55 });
        }
      }
      scene.add(makeVending(vend, { outline }));
    }

    // --- аллея бумажных фонариков
    {
      const strings = [];
      const posts = [];
      for (let s = 0.31 * L; s < 0.405 * L; s += 8.5) {
        const fr = track.frameAtProgress(s, {});
        const off = fr.hw + fr.wall + 1.0;
        const pa = fr.pos.clone().addScaledVector(fr.right, -off);
        const pb = fr.pos.clone().addScaledVector(fr.right, off);
        pa.y += 8;
        pb.y += 8;
        strings.push({ a: pa, b: pb, sag: 1.6, count: 7 });
        for (const p of [pa, pb]) posts.push(new THREE.Matrix4().makeTranslation(p.x, fr.pos.y + 0.1, p.z));
        pools.push({ x: fr.pos.x, y: fr.pos.y + 0.06, z: fr.pos.z, r: 7, sx: 1.4, ry: Math.atan2(fr.right.x, fr.right.z), color: 0xff5a2a, i: 0.1 });
      }
      scene.add(makeLanternStrings(strings, { color: 0xff3a1a, color2: 0xffb040 }));
      const postGeo = normalizeGeometry(new THREE.CylinderGeometry(0.16, 0.2, 8.4, 6).translate(0, 4.2, 0));
      scene.add(instancedParts([{ geo: postGeo, mat: toon(0x2a1a22), outline: outline ? 0.04 : 0 }], posts, { name: 'lantern-posts' }));
      // ворота аллеи
      const fr = track.frameAtProgress(0.305 * L, {});
      const gate = alleyGate(fr.hw + fr.wall + 1.6, outline);
      gate.position.copy(fr.pos);
      gate.rotation.y = Math.atan2(fr.tan.x, fr.tan.z);
      scene.add(gate);
    }

    // --- парк ночной сакуры
    {
      const trees = [];
      const lanterns = [];
      const pr = mulberry32(77);
      for (let k = 0; k < Math.round(34 * Math.max(0.6, detail)); k++) {
        const a = pr() * Math.PI * 2;
        const r = 8 + Math.sqrt(pr()) * (PARK.r - 12);
        if (Math.abs(r - 22) < 3.5) continue; // дорожка-кольцо
        const x = PARK.x + Math.cos(a) * r;
        const z = PARK.z + Math.sin(a) * r;
        trees.push({ x, y: GROUND_Y, z, s: 0.9 + pr() * 0.5 });
        pools.push({ x, y: GROUND_Y + 0.08, z, r: 6, color: 0xff5ab0, i: 0.22 });
      }
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        lanterns.push({ x: PARK.x + Math.cos(a) * 22, y: GROUND_Y, z: PARK.z + Math.sin(a) * 22, ry: -a });
      }
      const forest = makeSakuraForest(trees, { outline, seed: 3, low: 0xff7ab8, high: 0xffe0f0 });
      forest.traverse((o) => {
        if (o.isMesh && o.material?.vertexColors) {
          o.material.emissive = new THREE.Color(0x6a1848);
          o.material.emissiveIntensity = 1;
        }
      });
      scene.add(forest);
      scene.add(makeStoneLanterns(lanterns, { light: 0xffd08a, lightIntensity: 2.6 }));
      for (const l of lanterns) pools.push({ x: l.x, y: GROUND_Y + 0.08, z: l.z, r: 4, color: 0xffc070, i: 0.4 });
    }

    // --- электричка на эстакаде
    {
      const a = new THREE.Vector3(TRAIN_X, TRAIN_Y + 0.6, -470);
      const b = new THREE.Vector3(TRAIN_X, TRAIN_Y + 0.6, 520);
      const via = [];
      via.push(new THREE.BoxGeometry(8, 1.3, b.z - a.z).translate(TRAIN_X, TRAIN_Y - 0.1, (a.z + b.z) / 2));
      for (const s of [-1, 1]) via.push(new THREE.BoxGeometry(0.4, 1.2, b.z - a.z).translate(TRAIN_X + s * 3.8, TRAIN_Y + 1.0, (a.z + b.z) / 2));
      const pierMats = [];
      for (let z = a.z + 10; z < b.z; z += 32) pierMats.push(new THREE.Matrix4().makeTranslation(TRAIN_X, GROUND_Y, z));
      const vm = new THREE.Mesh(mergeList(via), toon(0x4c4866, { rim: 0.2 }));
      vm.castShadow = true;
      scene.add(vm);
      const pg = normalizeGeometry(new THREE.BoxGeometry(2.2, TRAIN_Y - GROUND_Y - 0.7, 2.2).translate(0, (TRAIN_Y - GROUND_Y - 0.7) / 2, 0));
      scene.add(instancedParts([{ geo: pg, mat: toon(0x4c4866), shadow: false }], pierMats, { name: 'rail-piers' }));
      const train = makeTrain(a, b, { cars: 7, speed: 24, outline });
      scene.add(train.group);
      updaters.push(train.update);
    }

    scene.add(makeLightPools(pools));

    // --- неоновые огоньки в воздухе
    const ambientCount = 520;
    const motes = createAmbientParticles({ count: ambientCount, box: [90, 40, 90], fall: -0.35, sway: 0.9, size: 1.1, shape: 'dot', additive: true, glow: 1.6, color: 0xff7ad8, color2: 0x7af0ff });
    motes.userData.setCount(Math.round(ambientCount * (quality.particles ?? 1)));
    scene.add(motes);
    updaters.push(motes.userData.update);

    return {
      sky,
      lights,
      updaters,
      ambient: motes,
      ambientCount,
      dustColor: new THREE.Color(0x6a5a8a),
      bloom: { strength: 0.65, radius: 0.5, threshold: 1.05 },
      exposure: 1.05,
      post: { saturation: 1.12, vignette: 0.32 },
      minimap: { road: '#ffffff', edge: '#ff3ad0', bg: 'rgba(24,12,48,0.45)' },
    };
  },
};

// ------------------------------------------------------------------ вспомогательные геометрии
function mergeList(list) {
  const geos = list.filter(Boolean).map((g) => normalizeGeometry(g));
  return geos.length ? mergeGeometries(geos) : new THREE.BufferGeometry();
}

/**
 * Лента вдоль канала. side=0 — вся ширина (вода), side=±1 — вертикальная стенка (wall=true) или полоса от inner до off.
 */
function canalRibbon(pts, off, yTop, yBot, side, wall = false, inner = 0) {
  const pos = [];
  const uv = [];
  const idx = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[Math.min(n - 1, i + 1)];
    const r = pts[Math.max(0, i - 1)];
    const d = new THREE.Vector3().subVectors(q, r).setY(0).normalize();
    const nx = -d.z;
    const nz = d.x;
    let a;
    let b;
    if (side === 0) {
      a = [p.x - nx * off, yTop, p.z - nz * off];
      b = [p.x + nx * off, yTop, p.z + nz * off];
    } else if (wall) {
      a = [p.x + nx * off * side, yTop, p.z + nz * off * side];
      b = [p.x + nx * off * side, yBot, p.z + nz * off * side];
    } else {
      a = [p.x + nx * inner * side, yTop, p.z + nz * inner * side];
      b = [p.x + nx * off * side, yTop, p.z + nz * off * side];
    }
    pos.push(...a, ...b);
    uv.push(0, i * 0.2, 1, i * 0.2);
    if (i < n - 1) {
      const k = i * 2;
      if (side >= 0 && !wall) idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      else idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Подпорная стенка под краем настила эстакады — от настила до земли (только там, где low[i]). */
function skirtGeometry(track, a, b, s, low) {
  const N = track.count;
  const pos = [];
  const idx = [];
  let prev = -1;
  for (let i = a; i <= b; i++) {
    const j = i % N;
    const P = track.pos[j];
    const R = track.right[j];
    const lat = s * (track.hw[j] + track.wall[j] + 0.6);
    const x = P.x + R.x * lat;
    const z = P.z + R.z * lat;
    const base = pos.length / 3;
    pos.push(x, P.y - 0.05, z, x, GROUND_Y - 0.3, z);
    if (prev >= 0 && low[i - a] && low[i - 1 - a]) idx.push(prev, prev + 1, base, base, prev + 1, base + 1);
    prev = base;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5c5674';
  g.fillRect(0, 0, 128, 128);
  const rnd = mulberry32(9);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const v = 80 + Math.floor(rnd() * 20);
      g.fillStyle = `rgb(${v},${v - 6},${v + 22})`;
      g.fillRect(i * 32 + 2, j * 32 + 2, 28, 28);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function bannerTexture(big, small) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 144;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 1024, 0);
  grd.addColorStop(0, '#1a0830');
  grd.addColorStop(0.5, '#2a0c44');
  grd.addColorStop(1, '#1a0830');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 144);
  g.strokeStyle = '#35e8ff';
  g.lineWidth = 6;
  g.shadowColor = '#35e8ff';
  g.shadowBlur = 16;
  g.strokeRect(8, 8, 1008, 128);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#ff3ad0';
  g.shadowBlur = 26;
  g.fillStyle = '#ff5ad8';
  g.font = '900 92px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", "IPAGothic", sans-serif';
  g.fillText(big, 330, 76);
  g.shadowBlur = 8;
  g.fillStyle = '#ffe0f8';
  g.fillText(big, 330, 76);
  g.shadowColor = '#35e8ff';
  g.shadowBlur = 14;
  g.fillStyle = '#bff8ff';
  g.font = '900 34px "Russo One", "M PLUS Rounded 1c", "IPAGothic", sans-serif';
  g.fillText(small, 780, 76);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Ворота аллеи фонариков: два столба, балка и вывеска "ネオン横丁". */
function alleyGate(half, outline) {
  const group = new THREE.Group();
  const red = toon(0xc8283a, { rim: 0.3 });
  const dark = toon(0x1c1420);
  const parts = [];
  for (const s of [-1, 1]) parts.push(new THREE.BoxGeometry(0.9, 11, 0.9).translate(s * half, 5.5, 0));
  parts.push(new THREE.BoxGeometry(half * 2 + 3, 0.9, 1.1).translate(0, 11.2, 0));
  parts.push(new THREE.BoxGeometry(half * 2 + 1, 0.5, 0.7).translate(0, 9.2, 0));
  const g = mergeList(parts);
  const m = new THREE.Mesh(g, red);
  m.castShadow = true;
  group.add(m);
  const board = new THREE.Mesh(new THREE.BoxGeometry(14, 2.4, 0.5), dark);
  board.position.set(0, 10.1, 0);
  group.add(board);
  if (outline) {
    m.add(new THREE.Mesh(outlineGeometry(g), outlineMaterial(0x2a0a14, 0.06)));
    board.add(new THREE.Mesh(outlineGeometry(board.geometry), outlineMaterial(0x2a0a14, 0.06)));
  }
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#1a0a14';
  x.fillRect(0, 0, 512, 96);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '900 64px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", "IPAGothic", sans-serif';
  x.shadowColor = '#ffb040';
  x.shadowBlur = 20;
  x.fillStyle = '#ffd070';
  x.fillText('ネオン横丁', 256, 52);
  x.shadowBlur = 0;
  x.fillStyle = '#fff4d8';
  x.fillText('ネオン横丁', 256, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sm = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.7, 1.7, 1.7) });
  for (const z of [-0.27, 0.27]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 2.1), sm);
    p.position.set(0, 10.1, z);
    if (z < 0) p.rotation.y = Math.PI;
    group.add(p);
  }
  group.name = 'alley-gate';
  return group;
}
