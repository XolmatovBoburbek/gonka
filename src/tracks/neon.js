// Локация 2: "Неон-Токио" — ночной аниме-город: небоскрёбы с огнями окон, неоновые вывески, голографические экраны,
// телебашня, эстакада над стартовым бульваром, аллея бумажных фонариков, парк ночной сакуры, канал и электричка.
import * as THREE from 'three';
import { neonLayout, CANAL, CANAL_HW, TOWER, PARK } from './neonLayout.js';
import { createSky, createLights, mulberry32 } from '../world/sky.js';
import { buildTerrain, buildFarGround } from '../world/terrain.js';
import { createWater } from '../world/water.js';
import { createNoise2D, fbm, smoothstep } from '../world/noise.js';
import { PolylineDistance } from '../world/geom.js';
import { toon, glow, normalizeGeometry } from '../world/toon.js';
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
  makeSearchlights,
  makeChevronBoards,
  makeBlimp,
  makeCrosswalks,
  highwayGantry,
  alleyGate,
  bannerTexture,
  tileTexture,
  instancedParts,
  merge,
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
  itemRows: [0.075, 0.225, 0.525, 0.93],
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
      emissive: { edge: '#ff4fd8', center: '#2cc4e8', intensity: 1.3 },
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
    const pools = []; // световые пятна на земле (одним InstancedMesh в конце)
    const lightDots = []; // огоньки-билборды (одним draw call в конце)
    const rnd = mulberry32(2024);
    const N = track.count;
    const L = track.length;
    // луна висит над даунтауном в конце стартового бульвара; свет для теней — выше, чтобы не заливать улицы тенью
    const moonDir = new THREE.Vector3(0.93, 0.33, -0.2).normalize();
    const lightDir = new THREE.Vector3(0.45, 0.8, -0.4).normalize();
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
      moonColor: 0xd0cad8,
    });
    scene.add(sky);
    updaters.push(sky.userData.update);
    const fogColor = 0x2a1848;
    scene.fog = new THREE.FogExp2(fogColor, 0.0019);
    const lights = createLights(scene, {
      sunDir: lightDir,
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

    // --- канал: вода, стенки набережной, променад
    {
      const water = createWater({
        size: 100,
        segments: 2,
        center,
        level: WATER_Y,
        deep: 0x22185a,
        shallow: 0x4a34a8,
        foam: 0xff7ad8,
        sky: 0xd04a9c,
        sunDir: moonDir,
        sunColor: 0xfff0e0,
        heightMap: terrain.heightTexture(),
        wave: 0.03,
        sparkle: 2.2,
        sunPath: 1.4,
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
      // неоновая кромка набережной и её "отражение" у воды
      const edgeA = [];
      const edgeB = [];
      for (const s of [-1, 1]) {
        edgeA.push(canalRibbon(canalPts, CANAL_HW - 0.02, 0.1, -0.15, s, true));
        edgeB.push(canalRibbon(canalPts, CANAL_HW - 0.02, WATER_Y + 0.35, WATER_Y + 0.05, s, true));
      }
      scene.add(new THREE.Mesh(merge(edgeA), glow(0x35e8ff, 2.2, { side: THREE.DoubleSide })));
      scene.add(new THREE.Mesh(merge(edgeB), glow(0xff3ad0, 1.1, { side: THREE.DoubleSide })));
      const wm = new THREE.Mesh(merge(walls), toon(0x4c4868, { side: THREE.DoubleSide }));
      const tm = new THREE.Mesh(merge(tops), toon(0x6a6488, { ramp: 'terrain' }));
      wm.receiveShadow = tm.receiveShadow = true;
      scene.add(wm, tm);
      // огоньки вдоль набережной
      for (let i = 0; i < canalPts.length; i += 3) {
        const p = canalPts[i];
        const q = canalPts[Math.min(canalPts.length - 1, i + 1)];
        const d = new THREE.Vector3().subVectors(q, p).setY(0).normalize();
        for (const s of [-1, 1]) {
          const x = p.x - d.z * s * (CANAL_HW + 0.6);
          const z = p.z + d.x * s * (CANAL_HW + 0.6);
          if (track.distanceTo(x, z, 30).dist < 16) continue;
          lightDots.push({ x, y: 0.9, z, phase: -1, color: 0xffc080, size: 0.9 });
        }
      }
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
      const shm = new THREE.Mesh(merge(sh), shoulderMat);
      shoulderMat.polygonOffset = true;
      shoulderMat.polygonOffsetFactor = -1;
      shoulderMat.polygonOffsetUnits = -1;
      const wkm = new THREE.Mesh(merge(wk), walkMat);
      shm.receiveShadow = wkm.receiveShadow = true;
      scene.add(shm, wkm);
    }

    // --- эстакада: опоры, подпорные стенки на въезде, вывеска над бульваром
    const bridgeRanges = track.ranges((i) => (track.flags[i] & 1) !== 0);
    const piers = [];
    const nearPier = (x, z, r) => piers.some((p) => Math.hypot(p.x - x, p.z - z) < r);
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
          piers.push(P);
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
      const sk = new THREE.Mesh(merge(skirts), toon(0x3a3654, { side: THREE.DoubleSide }));
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
      scene.add(new THREE.Mesh(merge(under), glow(0xb06bff, 2.0, { side: THREE.DoubleSide })));
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
        const tex = bannerTexture('ネオン東京', ['NEON TOKYO', '★ 夜のグランプリ ★']);
        const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6) });
        // щит на стойках над кромкой эстакады, двусторонний
        const frame = [];
        const planes = [];
        for (const s of [-1, 1]) {
          const off = s * (track.hw[best] + track.wall[best] + 0.75);
          const cx = P.x + R.x * off;
          const cz = P.z + R.z * off;
          const ry = Math.atan2(R.x * s, R.z * s);
          for (const side of [0, Math.PI]) {
            const a = ry + side;
            planes.push(new THREE.PlaneGeometry(32, 4.5).rotateY(a).translate(cx + Math.sin(a) * 0.26, P.y + 4.4, cz + Math.cos(a) * 0.26));
          }
          const T = track.tan[best];
          const box = new THREE.BoxGeometry(33, 5.3, 0.45);
          box.rotateY(ry);
          box.translate(cx, P.y + 4.4, cz);
          frame.push(box);
          for (const k of [-12, 0, 12]) frame.push(new THREE.BoxGeometry(0.5, 2.3, 0.5).translate(cx - R.x * s * 0.25 + T.x * k, P.y + 1.0, cz - R.z * s * 0.25 + T.z * k));
        }
        scene.add(new THREE.Mesh(merge(planes), mat));
        const fm = new THREE.Mesh(merge(frame), toon(0x1c1830));
        fm.castShadow = true;
        scene.add(fm);
        // светильники под настилом над бульваром
        const lamps = [];
        const T = track.tan[best];
        for (let k = -18; k <= 18; k += 6) {
          for (const lat of [-5.5, 0, 5.5]) {
            const x = P.x + T.x * k + R.x * lat;
            const z = P.z + T.z * k + R.z * lat;
            lamps.push(new THREE.BoxGeometry(2.2, 0.12, 0.7).rotateY(Math.atan2(T.x, T.z)).translate(x, P.y - 2.28, z));
            if (lat === 0 && Math.abs(z) < 16) pools.push({ x, y: 0.07, z, r: 6, color: 0xbfe6ff, i: 0.18 });
          }
        }
        scene.add(new THREE.Mesh(merge(lamps), glow(0xe8f4ff, 2.2)));
      }
    }

    // неоновые кольца на столбах стартовой арки
    {
      const fr = track.frameAt(0, {});
      const half = fr.hw + Math.min(fr.wall, 3) + 1.2;
      const rings = [];
      for (const s of [-1, 1]) {
        for (const y of [1.6, 3.4, 5.2]) {
          const t = new THREE.TorusGeometry(0.95, 0.09, 6, 24);
          t.rotateX(Math.PI / 2);
          t.translate(fr.pos.x + fr.right.x * s * half, fr.pos.y - 0.2 + y, fr.pos.z + fr.right.z * s * half);
          rings.push(t);
        }
      }
      scene.add(new THREE.Mesh(merge(rings), glow(0x35e8ff, 2.4)));
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
      b.lit = b.lit ?? 0.22 + rnd() * 0.4;
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
      if (screen) screens.push({ ...screen, b });
      return b;
    };
    special(262 + 30, -18, 30, 22, 66, -Math.PI / 2, { w: 28, h: 15.7, y: 42, mode: 0, text: 'ネオン東京 ♥ SAKURA DRIFT ♥ 夜のレース', ca: 0xff3ad0, cb: 0x5a2cff, cc: 0x35e8ff });
    special(22, -236, 30, 22, 62, 0, { w: 26, h: 14.6, y: 38, mode: 1, text: '', ca: 0xff3ad0, cb: 0x2a0a6a, cc: 0xff8a3a });
    special(214, 272, 26, 18, 40, Math.PI, { w: 20, h: 11.2, y: 22, mode: 0, text: 'カラオケ ★ ゲーム ★ ラーメン ★ アニメ', ca: 0x35e8ff, cb: 0xff3ad0, cc: 0xffe14a });

    // фасады вдоль трассы
    const front = [];
    const alley = (s) => s > 0.305 * L && s < 0.41 * L;
    // зоны невысокой застройки: вид на экраны, электричку и телебашню
    const lowZone = (x, z) =>
      (x > 212 && x < TRAIN_X + 4) || (x > 140 && x < 250 && z > -60 && z < 12) || (x > -8 && x < 60 && z > -228 && z < -140) || Math.hypot(x - TOWER[0], z - TOWER[1]) < 105;
    for (const side of [-1, 1]) {
      let s = rnd() * 10;
      while (s < L) {
        const fr = track.frameAtProgress(s, {});
        const i = fr.index;
        const bridge = (track.flags[i] & 1) !== 0;
        const w = 10 + rnd() * 12;
        const d = 10 + rnd() * 9;
        if (bridge && rnd() < 0.4) {
          s += 8 + rnd() * 10;
          continue;
        }
        const set = fr.hw + fr.wall + (bridge ? 8 + rnd() * 12 : 7.5 + rnd() * 3);
        const nx = fr.right.x * side;
        const nz = fr.right.z * side;
        const x = fr.pos.x + nx * (set + d / 2);
        const z = fr.pos.z + nz * (set + d / 2);
        let h;
        if (alley(s)) h = 7 + rnd() * 6;
        else if (bridge) h = rnd() < 0.5 ? Math.max(5, fr.pos.y - 6 + rnd() * 6) : fr.pos.y + 12 + rnd() * 30 + (rnd() < 0.25 ? 25 : 0);
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
    // ступенчатые надстройки на высоких зданиях — разнообразный силуэт
    const crowns = [];
    for (const b of buildings) {
      if (b.h < 34 || rnd() > 0.45) continue;
      const k = 0.55 + rnd() * 0.25;
      crowns.push({ ...b, w: b.w * k, d: b.d * (k + (rnd() - 0.5) * 0.15), h: b.h * (0.12 + rnd() * 0.2), y: b.y + b.h, crown: true, seed: rnd() * 1000 });
      b.hasCrown = true;
    }
    buildings.push(...crowns);
    // крупные вывески на крышах кварталов, повёрнутые к трассе
    const roofSigns = [];
    for (const b of buildings) {
      if (b.crown || b.hasCrown || b.h > 48 || b.h < 12 || rnd() > 0.2) continue;
      const { dist, index } = track.distanceTo(b.x, b.z, 240);
      if (index < 0 || dist < 45 || dist > 230) continue;
      const P = track.pos[index];
      const ry = Math.atan2(P.x - b.x, P.z - b.z);
      const w = Math.min(Math.max(b.w, b.d) * 0.9, 10 + rnd() * 8);
      roofSigns.push({ x: b.x, y: b.y + b.h + 1.6 + w / 8, z: b.z, ry, w, h: w / 4, kind: 'h', index: Math.floor(rnd() * 16), bright: 1.2, flicker: rnd() < 0.05 });
    }
    const bmesh = makeBuildings(buildings, { moonDir: lightDir });
    scene.add(bmesh);

    // крыши: техника, антенны и красные огни
    {
      const roofMats = [];
      const antMats = [];
      for (const b of buildings) {
        if (b.hasCrown) continue;
        const cs = Math.cos(b.ry);
        const sn = Math.sin(b.ry);
        const top = b.y + b.h;
        const place = (lu, lv) => [b.x + lu * cs + lv * sn, b.z - lu * sn + lv * cs];
        const nearTrack = Math.hypot(b.x - center.x, b.z - center.z) < 560;
        if (nearTrack && top < 70) {
          const n = 1 + Math.floor(rnd() * 3);
          for (let k = 0; k < n; k++) {
            const [x, z] = place((rnd() - 0.5) * (b.w - 4), (rnd() - 0.5) * (b.d - 4));
            const s = 1.5 + rnd() * 2.5;
            roofMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, top, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.ry), new THREE.Vector3(s, 0.8 + rnd() * 1.5, s * (0.6 + rnd() * 0.8))));
          }
        }
        if (top - GROUND_Y > 42) {
          for (const [cu, cv] of [
            [1, 1],
            [-1, -1],
            [1, -1],
            [-1, 1],
          ].slice(0, top > 80 ? 4 : 2)) {
            const [x, z] = place(cu * (b.w / 2 - 0.6), cv * (b.d / 2 - 0.6));
            lightDots.push({ x, y: top + 0.6, z, phase: rnd(), color: 0xff2a3a, size: 1.6 });
          }
          if (rnd() < 0.5) {
            const ah = 6 + rnd() * 12;
            antMats.push(new THREE.Matrix4().compose(new THREE.Vector3(b.x, top, b.z), new THREE.Quaternion(), new THREE.Vector3(1, ah, 1)));
            lightDots.push({ x: b.x, y: top + ah + 0.4, z: b.z, phase: rnd(), color: 0xff2a3a, size: 1.6 });
          }
        }
      }
      const roofGeo = normalizeGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
      scene.add(instancedParts([{ geo: roofGeo, mat: toon(0x5a5676), shadow: false }], roofMats, { name: 'roof-units' }));
      const antGeo = normalizeGeometry(new THREE.CylinderGeometry(0.12, 0.3, 1, 5).translate(0, 0.5, 0));
      scene.add(instancedParts([{ geo: antGeo, mat: toon(0x8a86a0), shadow: false }], antMats, { name: 'antennas' }));
    }

    // голографические экраны
    const screenFrames = [];
    for (const sc of screens) {
      const { b } = sc;
      const mesh = makeHoloScreen(sc.w, sc.h, { mode: sc.mode, text: sc.text, a: sc.ca, b: sc.cb, c: sc.cc });
      const off = b.d / 2 + 0.6;
      mesh.position.set(b.x + Math.sin(b.ry) * off, sc.y, b.z + Math.cos(b.ry) * off);
      mesh.rotation.y = b.ry;
      scene.add(mesh);
      updaters.push(mesh.userData.update);
      // рама
      const p = mesh.position.clone().addScaledVector(new THREE.Vector3(Math.sin(b.ry), 0, Math.cos(b.ry)), -0.45);
      screenFrames.push(new THREE.BoxGeometry(sc.w + 1.2, sc.h + 1.2, 0.8).rotateY(b.ry).translate(p.x, p.y, p.z));
    }
    scene.add(new THREE.Mesh(merge(screenFrames), toon(0x1a1628)));

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
          signs.push({ x: px + Math.sin(ry + flip) * 0.18, y: cy, z: pz + Math.cos(ry + flip) * 0.18, ry: ry + flip, w: ww, h: hh, kind: 'v', index: idx, bright: 1.05, flicker: rnd() < 0.08 });
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
        signs.push({ x: b.x + fx * (b.d / 2 + 0.07) + tx * lu, y: cy, z: b.z + fz * (b.d / 2 + 0.07) + tz * lu, ry: b.ry, w: ww, h: hh, kind: 'h', index: Math.floor(rnd() * 16), bright: 1.0, flicker: rnd() < 0.06 });
      }
      // большая вывеска на крыше невысоких домов
      if (!f.bridge && b.h < 24 && rnd() < 0.3) {
        const ww = Math.min(b.w * 0.9, 12);
        const hh = ww / 4;
        const y = b.y + b.h + 1.4 + hh / 2;
        signs.push({ x: b.x + fx * (b.d / 2 - 1.5), y, z: b.z + fz * (b.d / 2 - 1.5), ry: b.ry, w: ww, h: hh, kind: 'h', index: Math.floor(rnd() * 16), bright: 1.2 });
        signBacks.push(new THREE.Matrix4().compose(new THREE.Vector3(b.x + fx * (b.d / 2 - 1.75), y - 0.9, b.z + fz * (b.d / 2 - 1.75)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.ry), new THREE.Vector3(ww * 0.8, hh + 1.8, 0.3)));
      }
    }
    for (const r of roofSigns) {
      signs.push(r);
      signBacks.push(new THREE.Matrix4().compose(new THREE.Vector3(r.x - Math.sin(r.ry) * 0.25, r.y - 0.8, r.z - Math.cos(r.ry) * 0.25), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.ry), new THREE.Vector3(r.w * 0.85, r.h + 1.6, 0.3)));
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
      for (const p of tw.blink) lightDots.push({ ...p, x: TOWER[0] + p.x * cs + p.z * sn, y: p.y + GROUND_Y, z: TOWER[1] - p.x * sn + p.z * cs });
    }

    // --- фонари, автоматы, световые пятна
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
          if (!bridge && nearPier(x, z, 3.5)) continue;
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
          const vl = side * (fr.hw + fr.wall + 5.6);
          if (nearPier(fr.pos.x + fr.right.x * vl, fr.pos.z + fr.right.z * vl, 5)) continue;
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
        pools.push({ x: fr.pos.x, y: fr.pos.y + 0.06, z: fr.pos.z, r: 7, sx: 1.4, ry: Math.atan2(fr.right.x, fr.right.z), color: 0xff5a2a, i: 0.04 });
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
      const vm = new THREE.Mesh(merge(via), toon(0x4c4866, { rim: 0.2 }));
      vm.castShadow = true;
      scene.add(vm);
      const pg = normalizeGeometry(new THREE.BoxGeometry(2.2, TRAIN_Y - GROUND_Y - 0.7, 2.2).translate(0, (TRAIN_Y - GROUND_Y - 0.7) / 2, 0));
      scene.add(instancedParts([{ geo: pg, mat: toon(0x4c4866), shadow: false }], pierMats, { name: 'rail-piers' }));
      const train = makeTrain(a, b, { cars: 7, speed: 24, outline });
      scene.add(train.group);
      updaters.push(train.update);
    }

    // отсветы витрин на тротуаре
    for (const f of front) {
      if (f.bridge || rnd() < 0.3) continue;
      const fr = track.frameAtProgress(f.s, {});
      const lat = f.side * (fr.hw + fr.wall + 4);
      const r = 2.6;
      pools.push({ x: fr.pos.x + fr.right.x * lat, y: fr.pos.y + 0.18, z: fr.pos.z + fr.right.z * lat, r, sx: Math.min(4, f.b.w / (2 * r)), ry: f.b.ry, color: NEON[f.b.hue], i: 0.22 });
    }

    // пешеходные "зебры" на асфальте
    scene.add(makeCrosswalks(track, [0.028, 0.128, 0.915]));

    // указатели скоростной дороги над эстакадой
    for (const [f, t1, t2] of [
      [0.49, '渋谷  Shibuya', '新宿  Shinjuku'],
      [0.715, '東京タワー  Tower', '銀座  Ginza'],
    ]) {
      const g = highwayGantry(track, f * L, t1, t2, outline);
      scene.add(g);
    }

    // бегущие шевроны на внешней стороне поворотов
    {
      const ch = makeChevronBoards(track, { minCurv: 0.016, step: 10 });
      scene.add(ch.group);
      updaters.push(ch.update);
    }

    // дирижабль с экраном кружит вокруг телебашни (вокруг неё только низкие дома)
    {
      const bl = makeBlimp({ center: new THREE.Vector3(TOWER[0], 0, TOWER[1]), radius: 72, height: 88, speed: 0.045, start: 1.2, outline });
      scene.add(bl.group);
      updaters.push(bl.update);
    }

    // прожекторы над даунтауном
    {
      // с крыш самых высоких башен, подальше друг от друга
      const tops = buildings
        .filter((b) => !b.hasCrown && Math.hypot(b.x - center.x, b.z - center.z) > 250)
        .sort((a, b) => b.y + b.h - (a.y + a.h));
      const src = [];
      for (const b of tops) {
        if (src.length >= 3) break;
        if (src.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 260)) continue;
        src.push({ x: b.x, y: b.y + b.h + 0.5, z: b.z, lean: [b.x - center.x, b.z - center.z] }); // от трассы наружу
      }
      const sl = makeSearchlights(src, { color: 0xc8c0ff, alpha: 0.2 });
      scene.add(sl.group);
      updaters.push(sl.update);
    }

    scene.add(makeLightPools(pools));
    const dots = makeBlinkers(lightDots);
    scene.add(dots);
    updaters.push(dots.userData.update);

    // --- неоновые огоньки в воздухе
    const ambientCount = 420;
    const motes = createAmbientParticles({ count: ambientCount, box: [90, 40, 90], fall: -0.3, sway: 0.9, size: 0.7, shape: 'dot', additive: true, glow: 0.4, color: 0xff5ad0, color2: 0x4ae8ff });
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
      idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
    }
  }
  // горизонтальные ленты должны смотреть вверх
  if (!wall && idx.length) {
    const v = (j) => new THREE.Vector3(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
    const nrm = new THREE.Vector3().subVectors(v(idx[1]), v(idx[0])).cross(new THREE.Vector3().subVectors(v(idx[2]), v(idx[0])));
    if (nrm.y < 0) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
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
