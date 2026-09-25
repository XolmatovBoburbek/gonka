// Геометрия трассы: дорога, бордюры, отбойники, мостовые настилы, старт/финиш, бустеры, трамплины.
import * as THREE from 'three';
import { toon, glow, outlineMaterial, getGradientMap } from './toon.js';
import { mulberry32 } from './sky.js';

let maxAniso = 8;
export function setMaxAnisotropy(n) {
  maxAniso = n;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texFrom(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  return t;
}

/** Асфальт с разметкой. u — поперёк (0..1), v — вдоль. */
export function makeRoadTexture(o = {}) {
  const W = 256;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = o.base ?? '#62667a';
  g.fillRect(0, 0, W, H);
  const rnd = mulberry32(o.seed ?? 7);
  // зерно
  const grain = o.grain ?? 0.1;
  for (let i = 0; i < 5000; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const a = rnd() * grain;
    g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.3})`;
    g.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // мягкие пятна
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 12 + rnd() * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() > 0.5;
    grd.addColorStop(0, dark ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // лёгкий градиент к краям (накатанная середина полос)
  const edge = g.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, 'rgba(0,0,0,0.12)');
  edge.addColorStop(0.12, 'rgba(0,0,0,0)');
  edge.addColorStop(0.88, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);
  // краевые линии
  g.fillStyle = o.edgeLine ?? '#f4f4f8';
  g.fillRect(W * 0.025, 0, W * 0.022, H);
  g.fillRect(W * 0.953, 0, W * 0.022, H);
  // центральная пунктирная
  if (o.centerLine !== false) {
    g.fillStyle = o.centerLine ?? '#ffe070';
    const dash = o.dashed === false ? H : H * 0.45;
    g.fillRect(W * 0.49, H * 0.05, W * 0.02, dash);
  }
  if (o.laneLines) {
    g.fillStyle = o.laneLines;
    for (const u of [0.26, 0.74]) g.fillRect(W * u - W * 0.008, H * 0.1, W * 0.016, H * 0.3);
  }
  return texFrom(c);
}

/** Светящаяся разметка (для ночных трасс) — отдельная карта emissive. */
export function makeRoadEmissive(o = {}) {
  const W = 256;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.fillStyle = o.edge ?? '#ffffff';
  g.fillRect(W * 0.025, 0, W * 0.022, H);
  g.fillRect(W * 0.953, 0, W * 0.022, H);
  if (o.center) {
    g.fillStyle = o.center;
    g.fillRect(W * 0.49, H * 0.05, W * 0.02, H * 0.45);
  }
  return texFrom(c);
}

export function makeStripeTexture(a, b, { vertical = false, size = 64, border = null } = {}) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = a;
  g.fillRect(0, 0, size, size);
  g.fillStyle = b;
  if (vertical) g.fillRect(0, 0, size / 2, size);
  else g.fillRect(0, 0, size, size / 2);
  if (border) {
    g.fillStyle = border;
    g.fillRect(0, 0, size, 3);
    g.fillRect(0, size - 3, size, 3);
  }
  const t = texFrom(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function makeCheckerTexture(n = 8, a = '#ffffff', b = '#1b1b24') {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const s = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      g.fillStyle = (i + j) % 2 ? a : b;
      g.fillRect(i * s, j * s, s, s);
    }
  }
  const t = texFrom(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Шевроны бустера. */
export function makeChevronTexture(c1 = '#39f3ff', c2 = '#ffffff') {
  const W = 128;
  const H = 128;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(20,10,40,0.35)';
  g.fillRect(0, 0, W, H);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, c2);
  grd.addColorStop(1, c1);
  g.fillStyle = grd;
  g.beginPath();
  // "^" указывает к верху канваса (= вперёд по трассе)
  g.moveTo(W * 0.5, H * 0.06);
  g.lineTo(W * 0.95, H * 0.5);
  g.lineTo(W * 0.95, H * 0.74);
  g.lineTo(W * 0.5, H * 0.3);
  g.lineTo(W * 0.05, H * 0.74);
  g.lineTo(W * 0.05, H * 0.5);
  g.closePath();
  g.fill();
  const t = texFrom(c);
  return t;
}

// ------------------------------------------------------------------ сборка
/**
 * Строит всю "дорожную" геометрию по теме.
 * theme: {
 *   road: {base, grain, edgeLine, centerLine, dashed, emissive:{edge, center, intensity}},
 *   curb: {a, b, width},
 *   wall: {style: 'pillow'|'neon'|'guard'|'none', a, b, height, glowColor},
 *   deck: {color, side}, // для мостов/эстакад
 * }
 */
export function buildTrackMeshes(track, theme = {}) {
  const group = new THREE.Group();
  group.name = 'track';
  const updaters = [];
  const L = track.length;
  // vScale так, чтобы текстура дороги замыкалась без шва
  const roadRepeat = Math.max(1, Math.round(L / 18));
  const vRoad = L / roadRepeat;

  // --- дорога
  const roadTex = makeRoadTexture(theme.road || {});
  const roadMat = toon(0xffffff, { map: roadTex, ramp: 'terrain' });
  roadMat.polygonOffset = true;
  roadMat.polygonOffsetFactor = -2;
  roadMat.polygonOffsetUnits = -2;
  if (theme.road?.emissive) {
    const e = theme.road.emissive;
    roadMat.emissiveMap = makeRoadEmissive(e);
    roadMat.emissive = new THREE.Color(0xffffff);
    roadMat.emissiveIntensity = e.intensity ?? 2.5;
  }
  const roadGeo = track.extrude(
    [
      { k: -1, c: 0, y: 0, u: 0 },
      { k: 0, c: 0, y: 0, u: 0.5 },
      { k: 1, c: 0, y: 0, u: 1 },
    ],
    { vScale: vRoad }
  );
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  road.name = 'road';
  group.add(road);

  // --- бордюры
  const cw = theme.curb?.width ?? 1.5;
  const curbRepeat = Math.round(L / 3.2);
  const curbTex = makeStripeTexture(theme.curb?.a ?? '#ff5d93', theme.curb?.b ?? '#ffffff');
  const curbMat = toon(0xffffff, { map: curbTex, ramp: 'terrain' });
  curbMat.polygonOffset = true;
  curbMat.polygonOffsetFactor = -2;
  curbMat.polygonOffsetUnits = -2;
  const curbProfileR = [
    { k: 1, c: -0.05, y: 0.0, u: 0 },
    { k: 1, c: cw * 0.35, y: 0.1, u: 0.5 },
    { k: 1, c: cw, y: 0.0, u: 1 },
  ];
  const curbProfileL = [
    { k: -1, c: -cw, y: 0.0, u: 1 },
    { k: -1, c: -cw * 0.35, y: 0.1, u: 0.5 },
    { k: -1, c: 0.05, y: 0.0, u: 0 },
  ];
  for (const prof of [curbProfileL, curbProfileR]) {
    const g = track.extrude(prof, { vScale: L / curbRepeat });
    const m = new THREE.Mesh(g, curbMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // --- настил мостов / эстакад
  const bridgeRanges = track.ranges((i) => (track.flags[i] & 1) !== 0);
  if (bridgeRanges.length) {
    const deckMat = toon(theme.deck?.color ?? 0xb9a89a, { ramp: 'terrain', side: THREE.DoubleSide });
    const sideMat = toon(theme.deck?.side ?? theme.deck?.color ?? 0x9a8a80, { side: THREE.DoubleSide });
    const depth = theme.deck?.depth ?? 1.4;
    for (const [a, b] of bridgeRanges) {
      const top = track.extrude(
        [
          { k: -1, w: -1, c: -0.6, y: -0.03 },
          { k: -1, c: -cw, y: -0.03 },
        ],
        { from: a - 2, to: b + 2 }
      );
      const top2 = track.extrude(
        [
          { k: 1, c: cw, y: -0.03 },
          { k: 1, w: 1, c: 0.6, y: -0.03 },
        ],
        { from: a - 2, to: b + 2 }
      );
      const m1 = new THREE.Mesh(top, deckMat);
      const m2 = new THREE.Mesh(top2, deckMat);
      m1.receiveShadow = m2.receiveShadow = true;
      group.add(m1, m2);
      const side = track.extrude(
        [
          { k: 1, w: 1, c: 0.6, y: -0.03 },
          { k: 1, w: 1, c: 0.6, y: -depth },
          { k: 1, w: 1, c: 0.2, y: -depth - 0.4 },
          { k: -1, w: -1, c: -0.2, y: -depth - 0.4 },
          { k: -1, w: -1, c: -0.6, y: -depth },
          { k: -1, w: -1, c: -0.6, y: -0.03 },
        ],
        { from: a - 2, to: b + 2 }
      );
      const sm = new THREE.Mesh(side, sideMat);
      sm.castShadow = true;
      group.add(sm);
    }
  }

  // --- отбойники
  const wall = theme.wall || { style: 'pillow' };
  if (wall.style !== 'none') {
    const res = buildWalls(track, wall);
    group.add(res.group);
    if (res.update) updaters.push(res.update);
  }

  // --- старт/финиш
  const checker = makeCheckerTexture(8);
  const startGeo = track.extrude(
    [
      { k: -1, c: -cw, y: 0.02, u: 0 },
      { k: 1, c: cw, y: 0.02, u: 1 },
    ],
    { from: 0, to: 2 }
  );
  const uv = startGeo.getAttribute('uv');
  // v по кольцам: 0..1
  for (let r = 0; r <= 2; r++) {
    uv.setY(r * 2, r / 2);
    uv.setY(r * 2 + 1, r / 2);
  }
  checker.repeat.set(9, 2);
  const startMat = toon(0xffffff, { map: checker, ramp: 'terrain' });
  startMat.polygonOffset = true;
  startMat.polygonOffsetFactor = -4;
  startMat.polygonOffsetUnits = -4;
  const startLine = new THREE.Mesh(startGeo, startMat);
  startLine.receiveShadow = true;
  group.add(startLine);

  return { group, updaters, roadMat };
}

// ------------------------------------------------------------------ отбойники
function buildWalls(track, wall) {
  const group = new THREE.Group();
  const L = track.length;
  const style = wall.style;
  let update = null;
  const sides = [-1, 1];
  if (style === 'pillow') {
    // мягкий "зефирный" барьер в полоску
    const rep = Math.round(L / 4);
    const tex = makeStripeTexture(wall.a ?? '#ff7eb3', wall.b ?? '#ffffff');
    const mat = toon(0xffffff, { map: tex, rim: 0.2 });
    const h = wall.height ?? 1.0;
    for (const s of sides) {
      const o = 0.0;
      const prof = [
        { k: s, w: s, c: s * (o + 0.0), y: -0.3 },
        { k: s, w: s, c: s * (o + 0.0), y: h * 0.55 },
        { k: s, w: s, c: s * (o + 0.12), y: h * 0.88 },
        { k: s, w: s, c: s * (o + 0.42), y: h },
        { k: s, w: s, c: s * (o + 0.72), y: h * 0.88 },
        { k: s, w: s, c: s * (o + 0.85), y: h * 0.55 },
        { k: s, w: s, c: s * (o + 0.85), y: -0.3 },
      ];
      if (s < 0) prof.reverse();
      const g = track.extrude(prof, { vScale: L / rep });
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      const ol = new THREE.Mesh(g, outlineMaterial(0x3a2030, 0.05));
      group.add(ol);
    }
  } else if (style === 'neon') {
    // бетонный бортик + светящаяся трубка на стойках
    const baseMat = toon(wall.base ?? 0x2a2640);
    const h = wall.height ?? 0.7;
    for (const s of sides) {
      const prof = [
        { k: s, w: s, c: 0, y: -0.3 },
        { k: s, w: s, c: 0, y: h },
        { k: s, w: s, c: s * 0.5, y: h },
        { k: s, w: s, c: s * 0.5, y: -0.3 },
      ];
      if (s < 0) prof.reverse();
      const g = track.extrude(prof, { vScale: 10 });
      const m = new THREE.Mesh(g, baseMat);
      m.receiveShadow = true;
      group.add(m);
      const col = s < 0 ? wall.glowA ?? 0x00f0ff : wall.glowB ?? 0xff3ad0;
      const tube = track.extrude(
        [
          { k: s, w: s, c: s * 0.12, y: h + 0.02 },
          { k: s, w: s, c: s * 0.12, y: h + 0.14 },
          { k: s, w: s, c: s * 0.38, y: h + 0.14 },
          { k: s, w: s, c: s * 0.38, y: h + 0.02 },
        ],
        { vScale: 10 }
      );
      const tm = new THREE.Mesh(tube, glow(col, wall.intensity ?? 3.2, { side: THREE.DoubleSide }));
      group.add(tm);
    }
  } else if (style === 'guard') {
    // отбойник-"волна" на столбиках
    const railMat = toon(wall.a ?? 0xe8ecf4, { rim: 0.3 });
    const postMat = toon(wall.b ?? 0x8a6a4a);
    const h = wall.height ?? 0.9;
    const posts = [];
    for (const s of sides) {
      const prof = [
        { k: s, w: s, c: s * 0.05, y: h * 0.55 },
        { k: s, w: s, c: s * -0.08, y: h * 0.7 },
        { k: s, w: s, c: s * 0.05, y: h * 0.85 },
        { k: s, w: s, c: s * -0.08, y: h },
      ];
      if (s < 0) prof.reverse();
      const g = track.extrude(prof, { vScale: 10 });
      const m = new THREE.Mesh(g, railMat);
      m.material.side = THREE.DoubleSide;
      m.castShadow = true;
      group.add(m);
      const ol = new THREE.Mesh(g, outlineMaterial(0x2a2030, 0.03));
      group.add(ol);
      const step = 4;
      for (let d = 0; d < L; d += step) {
        const fr = track.frameAtProgress(d, {});
        const lat = s * (fr.hw + fr.wall + 0.2);
        posts.push(fr.pos.clone().addScaledVector(fr.right, lat));
      }
    }
    const pg = new THREE.BoxGeometry(0.18, h + 0.4, 0.18);
    pg.translate(0, (h + 0.4) / 2 - 0.3, 0);
    const im = new THREE.InstancedMesh(pg, postMat, posts.length);
    const m4 = new THREE.Matrix4();
    posts.forEach((p, i) => im.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
    im.castShadow = true;
    group.add(im);
  }
  return { group, update };
}

// ------------------------------------------------------------------ бустеры
export function buildBoostPads(track, pads, colors = {}) {
  const tex = makeChevronTexture(colors.a ?? '#39f3ff', colors.b ?? '#fff7a8');
  tex.repeat.set(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    color: new THREE.Color(1, 1, 1).multiplyScalar(colors.intensity ?? 1.6),
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
  });
  const geos = [];
  const zones = [];
  for (const p of pads) {
    const s0 = p.at * track.length;
    const len = p.length ?? 9;
    const w = p.width ?? 5;
    const from = Math.floor(s0 / track.spacing);
    const to = Math.ceil((s0 + len) / track.spacing);
    const g = track.extrude(
      [
        { k: 0, c: p.lateral - w / 2, y: 0.04, u: 0 },
        { k: 0, c: p.lateral + w / 2, y: 0.04, u: 1 },
      ],
      { from, to, vScale: 3 }
    );
    geos.push(g);
    zones.push({ s0, s1: s0 + len, lat: p.lateral, halfW: w / 2 });
  }
  const group = new THREE.Group();
  for (const g of geos) {
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 2;
    group.add(m);
  }
  const update = (dt) => {
    tex.offset.y -= dt * 1.6;
  };
  return { group, zones, update };
}

// ------------------------------------------------------------------ трамплины
export function buildRamps(track, ramps, colors = {}) {
  const group = new THREE.Group();
  const zones = [];
  const stripe = makeChevronTexture(colors.a ?? '#ffd84a', colors.b ?? '#ffffff');
  const topMat = toon(0xffffff, { map: stripe, ramp: 'terrain' });
  const sideMat = toon(colors.side ?? 0xff6fa8);
  for (const r of ramps) {
    const s0 = r.at * track.length;
    const len = r.length ?? 8;
    const w = r.width ?? 9;
    const h = r.height ?? 1.3;
    const n = Math.max(4, Math.ceil(len / track.spacing));
    const positions = [];
    const uvs = [];
    const idx = [];
    const side = [];
    const fr = {};
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const s = s0 + t * len;
      track.frameAtProgress(s, fr);
      const y = h * t * t * (1.2 - 0.2 * t);
      for (const [k, u] of [
        [-1, 0],
        [1, 1],
      ]) {
        const lat = r.lateral + (k * w) / 2;
        const p = fr.pos.clone().addScaledVector(fr.right, lat).addScaledVector(fr.up, y + 0.03);
        positions.push(p.x, p.y, p.z);
        uvs.push(u * 2, t * 2.5);
        const b = fr.pos.clone().addScaledVector(fr.right, lat).addScaledVector(fr.up, -0.1);
        side.push({ top: p, bottom: b, k });
      }
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const top = new THREE.Mesh(g, topMat);
    top.castShadow = true;
    top.receiveShadow = true;
    group.add(top);
    // боковины и задняя стенка
    const sp = [];
    const sIdx = [];
    const addQuad = (a, b, c, d) => {
      const base = sp.length / 3;
      sp.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
      sIdx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    };
    for (let i = 0; i < n; i++) {
      for (const k of [0, 1]) {
        const s1 = side[i * 2 + k];
        const s2 = side[(i + 1) * 2 + k];
        addQuad(s1.bottom, s1.top, s2.bottom, s2.top);
      }
    }
    const lastL = side[n * 2];
    const lastR = side[n * 2 + 1];
    addQuad(lastL.bottom, lastL.top, lastR.bottom, lastR.top);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setIndex(sIdx);
    sg.computeVertexNormals();
    const sm = new THREE.Mesh(sg, sideMat);
    sm.material.side = THREE.DoubleSide;
    sm.castShadow = true;
    group.add(sm);
    const ol = new THREE.Mesh(g, outlineMaterial(0x2a1a2a, 0.06));
    group.add(ol);
    zones.push({ s0, s1: s0 + len, lat: r.lateral, halfW: w / 2, height: h, len });
  }
  return { group, zones };
}

/** Высота трамплина в точке (для физики). */
export function rampHeightAt(zone, t) {
  return zone.height * t * t * (1.2 - 0.2 * t);
}

// ------------------------------------------------------------------ стартовая арка
export function buildStartGate(track, opts = {}) {
  const group = new THREE.Group();
  const fr = track.frameAt(0, {});
  const half = fr.hw + Math.min(fr.wall, 3) + 1.2;
  const height = opts.height ?? 8.5;
  const pillarMat = toon(opts.pillar ?? 0xffffff, { rim: 0.25 });
  const accentMat = toon(opts.accent ?? 0xff5d93);
  const olm = outlineMaterial(0x24142a, 0.06);
  const addOutlined = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    const o = new THREE.Mesh(geo, olm);
    m.add(o);
    group.add(m);
    return m;
  };
  for (const s of [-1, 1]) {
    const p = new THREE.CylinderGeometry(0.55, 0.7, height, 16);
    p.translate(s * half, height / 2, 0);
    addOutlined(p, pillarMat);
    const cap = new THREE.SphereGeometry(0.8, 16, 10);
    cap.translate(s * half, height + 0.2, 0);
    addOutlined(cap, accentMat);
    const ring = new THREE.TorusGeometry(0.72, 0.14, 8, 20);
    ring.rotateX(Math.PI / 2);
    ring.translate(s * half, height * 0.35, 0);
    addOutlined(ring, accentMat);
  }
  // балка с баннером
  const beam = new THREE.BoxGeometry(half * 2 + 1.4, 1.9, 0.7);
  beam.translate(0, height - 0.6, 0);
  addOutlined(beam, accentMat);
  const bc = canvas(1024, 128);
  const g = bc.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 1024, 0);
  grd.addColorStop(0, opts.bannerA ?? '#ff5d93');
  grd.addColorStop(0.5, opts.bannerB ?? '#ffb3d1');
  grd.addColorStop(1, opts.bannerA ?? '#ff5d93');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 128);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#1b1b24';
    g.fillRect(i * 16, 0, 16, 16);
    g.fillRect(1024 - (i + 1) * 16, 112, 16, 16);
  }
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#2a1030';
  g.lineWidth = 10;
  g.font = '900 72px "Russo One", "M PLUS Rounded 1c", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = opts.text ?? 'SAKURA DRIFT GP';
  g.strokeText(text, 512, 68);
  g.fillText(text, 512, 68);
  const btex = new THREE.CanvasTexture(bc);
  btex.colorSpace = THREE.SRGBColorSpace;
  btex.anisotropy = 4;
  const bannerMat = new THREE.MeshBasicMaterial({ map: btex });
  for (const z of [-0.36, 0.36]) {
    const b = new THREE.PlaneGeometry(half * 2 + 0.8, 1.55);
    if (z < 0) b.rotateY(Math.PI);
    b.translate(0, height - 0.6, z);
    group.add(new THREE.Mesh(b, bannerMat));
  }
  // стартовые огни
  const lights = [];
  const lightGeo = new THREE.SphereGeometry(0.42, 16, 10);
  const housing = new THREE.BoxGeometry(5.4, 1.2, 0.5);
  housing.translate(0, height - 2.2, 0);
  addOutlined(housing, toon(0x2a2433));
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x3a1a1a });
    const m = new THREE.Mesh(lightGeo, mat);
    m.position.set(-1.95 + i * 1.3, height - 2.2, -0.2);
    m.scale.set(1, 1, 0.6);
    group.add(m);
    lights.push(m);
  }
  // ориентировать арку поперёк трассы
  const m = new THREE.Matrix4().makeBasis(fr.right.clone().negate(), new THREE.Vector3(0, 1, 0), fr.tan.clone());
  group.quaternion.setFromRotationMatrix(m);
  group.position.copy(fr.pos);
  group.position.y -= 0.2;
  const off = new THREE.Color(0x3a1a1a);
  const red = new THREE.Color(0xff2a3a).multiplyScalar(3);
  const green = new THREE.Color(0x2aff6a).multiplyScalar(3);
  /** stage: 0 — выкл, 1..3 — красные, 4 — все зелёные */
  const setLights = (stage) => {
    lights.forEach((l, i) => {
      if (stage >= 4) l.material.color.copy(green);
      else if (i < stage) l.material.color.copy(red);
      else l.material.color.copy(off);
    });
  };
  return { group, setLights };
}

export { getGradientMap };
