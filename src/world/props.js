// Библиотека процедурных декораций: сакуры, сосны, бамбук, тории, фонари, пагода, камни, трава, цветы,
// флаги-нобори, перила мостов, падающие лепестки. Всё — через инстансинг (минимум draw calls).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, glow, outlineMaterial, outlineGeometry, normalizeGeometry } from './toon.js';
import { taperedTube, rod } from './geom.js';
import { mulberry32 } from './sky.js';

const OUT = 0x2a1a24;

function vgrad(geo, bottom, top, y0, y1) {
  const c0 = new THREE.Color(bottom);
  const c1 = new THREE.Color(top);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) - y0) / (y1 - y0), 0, 1);
    c.copy(c0).lerp(c1, t);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function merge(list, color = false) {
  return mergeGeometries(list.map((g) => normalizeGeometry(g, { color })));
}

/**
 * Инстансинг набора деталей. parts: [{ geo, mat, outline?: thickness, shadow?: bool, tint?: bool }]
 * matrices: Matrix4[]; colors?: Color[] (на инстанс; применяется к деталям с tint: true).
 * Инстансы разбиваются на пространственные чанки (chunk — размер ячейки), чтобы работало
 * отсечение по камере и по камере теней. chunk: 0 — один InstancedMesh на деталь (индексы как в matrices).
 */
export function instanced(parts, matrices, { colors = null, castShadow = true, receiveShadow = false, name = 'props', chunk = 170 } = {}) {
  const group = new THREE.Group();
  group.name = name;
  if (!matrices.length) return group;
  const buckets = new Map();
  const v = new THREE.Vector3();
  const useChunks = chunk > 0 && matrices.length > 40;
  matrices.forEach((m, i) => {
    v.setFromMatrixPosition(m);
    const key = useChunks ? Math.floor(v.x / chunk) + ',' + Math.floor(v.z / chunk) : 'all';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  });
  const outlineGeos = parts.map((p) => (p.outline ? p.outlineGeo || outlineGeometry(p.geo) : null));
  for (const idx of buckets.values()) {
    parts.forEach((p, pi) => {
      const im = new THREE.InstancedMesh(p.geo, p.mat, idx.length);
      idx.forEach((src, j) => im.setMatrixAt(j, matrices[src]));
      if (colors && p.tint) idx.forEach((src, j) => im.setColorAt(j, colors[src]));
      im.castShadow = p.shadow ?? castShadow;
      im.receiveShadow = receiveShadow;
      im.computeBoundingSphere();
      group.add(im);
      if (p.outline) {
        const om = new THREE.InstancedMesh(outlineGeos[pi], outlineMaterial(p.outlineColor ?? OUT, p.outline, { instanced: true }), idx.length);
        om.instanceMatrix = im.instanceMatrix;
        om.castShadow = false;
        om.computeBoundingSphere();
        group.add(om);
      }
    });
  }
  return group;
}

export function trs(x, y, z, ry = 0, s = 1, rx = 0, rz = 0) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : s;
  return m.compose(new THREE.Vector3(x, y, z), q, sc);
}

// ------------------------------------------------------------------ сакура
export function sakuraTreeParts(variant = 0, opts = {}) {
  const rnd = mulberry32(100 + variant * 17);
  const trunkParts = [];
  const canopy = [];
  const H = 5.5 + variant * 0.8;
  const lean = (rnd() - 0.5) * 0.6;
  const top = new THREE.Vector3(lean, H, (rnd() - 0.5) * 0.5);
  trunkParts.push(
    taperedTube([new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(lean * 0.3, H * 0.45, 0.1), top], (t) => 0.5 * (1 - t * 0.55), 8, 10)
  );
  const nb = 4 + (variant % 2);
  for (let b = 0; b < nb; b++) {
    const a = (b / nb) * Math.PI * 2 + rnd() * 0.8;
    const len = 3 + rnd() * 2;
    const start = new THREE.Vector3(lean * 0.7, H * (0.62 + rnd() * 0.25), 0);
    const mid = start.clone().add(new THREE.Vector3(Math.cos(a) * len * 0.5, 0.9 + rnd(), Math.sin(a) * len * 0.5));
    const end = start.clone().add(new THREE.Vector3(Math.cos(a) * len, 1.4 + rnd() * 1.5, Math.sin(a) * len));
    trunkParts.push(taperedTube([start, mid, end], (t) => 0.26 * (1 - t * 0.7), 6, 8));
    // облако цветов на конце ветки
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const r = 1.5 + rnd() * 1.3;
      const g = new THREE.IcosahedronGeometry(r, opts.canopyDetail ?? 1);
      g.scale(1, 0.78, 1);
      g.translate(end.x + (rnd() - 0.5) * 2.2, end.y + (rnd() - 0.3) * 1.2, end.z + (rnd() - 0.5) * 2.2);
      canopy.push(g);
    }
  }
  // центральная крона
  for (let i = 0; i < 3; i++) {
    const r = 2.2 + rnd() * 1.3;
    const g = new THREE.IcosahedronGeometry(r, opts.canopyDetail ?? 1);
    g.scale(1.1, 0.75, 1.1);
    g.translate(top.x + (rnd() - 0.5) * 2.5, top.y + 1.2 + rnd() * 1.4, top.z + (rnd() - 0.5) * 2.5);
    canopy.push(g);
  }
  const trunk = merge(trunkParts);
  const can = merge(canopy.map((g) => vgrad(g, opts.low ?? 0xf08bb0, opts.high ?? 0xffe8f2, H - 1, H + 5)), true);
  return { trunk, canopy: can };
}

export function makeSakuraForest(points, opts = {}) {
  const group = new THREE.Group();
  group.name = 'sakura-trees';
  const variants = [0, 1, 2].map((v) => sakuraTreeParts(v, opts));
  const trunkMat = toon(opts.trunk ?? 0x6b4a3a);
  const canopyMat = toon(0xffffff, { vertexColors: true, ramp: 'soft', rim: 0.35, rimColor: 0xffffff });
  const buckets = [[], [], []];
  const tints = [[], [], []];
  const rnd = mulberry32(opts.seed ?? 5);
  for (const p of points) {
    const v = Math.floor(rnd() * 3);
    buckets[v].push(trs(p.x, p.y, p.z, rnd() * 6.28, p.s ?? 0.8 + rnd() * 0.5));
    const tint = new THREE.Color().setHSL(0.93 + rnd() * 0.05, 0.6 + rnd() * 0.3, 0.9 + rnd() * 0.1);
    if (rnd() < 0.12) tint.setRGB(1, 1, 1);
    tints[v].push(tint);
  }
  variants.forEach((v, i) => {
    group.add(
      instanced(
        [
          { geo: v.trunk, mat: trunkMat },
          { geo: v.canopy, mat: canopyMat, tint: true, outline: opts.outline ? 0.08 : 0, outlineColor: 0x7a2a52 },
        ],
        buckets[i],
        { colors: tints[i], name: 'sakura-v' + i, chunk: 170 }
      )
    );
  });
  return group;
}

// ------------------------------------------------------------------ сосна
export function makePines(points, opts = {}) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.25, 0.4, 3, 7);
  trunk.translate(0, 1.2, 0);
  const tiers = [];
  for (let i = 0; i < 4; i++) {
    const r = 3.2 - i * 0.65;
    const h = 3.6 - i * 0.4;
    const c = new THREE.ConeGeometry(r, h, 9);
    c.translate(0, 3 + i * 2.1, 0);
    tiers.push(c);
  }
  const leaves = merge(tiers.map((g) => vgrad(g, opts.low ?? 0x1e5a4a, opts.high ?? 0x4e9a62, 2, 11)), true);
  const rnd = mulberry32(opts.seed ?? 9);
  const mats = points.map((p) => trs(p.x, p.y, p.z, rnd() * 6.28, p.s ?? 0.8 + rnd() * 0.7));
  parts.push({ geo: normalizeGeometry(trunk), mat: toon(0x5a3e30), outline: 0 });
  parts.push({ geo: leaves, mat: toon(0xffffff, { vertexColors: true, rim: 0.2 }), outline: opts.outline ? 0.07 : 0, outlineColor: 0x12302a });
  return instanced(parts, mats, { name: 'pines', chunk: 320 });
}

// ------------------------------------------------------------------ бамбук
export function makeBamboo(points, opts = {}) {
  const rnd = mulberry32(opts.seed ?? 21);
  const stalks = [];
  for (let i = 0; i < 5; i++) {
    const x = (rnd() - 0.5) * 2.4;
    const z = (rnd() - 0.5) * 2.4;
    const h = 9 + rnd() * 6;
    const g = new THREE.CylinderGeometry(0.16, 0.2, h, 7, 6);
    g.translate(x, h / 2, z);
    g.rotateZ((rnd() - 0.5) * 0.08);
    stalks.push(vgrad(g, 0x5aa04a, 0x9ad86a, 0, h));
    for (let k = 1; k < 5; k++) {
      const ring = new THREE.TorusGeometry(0.2, 0.05, 4, 8);
      ring.rotateX(Math.PI / 2);
      ring.translate(x, (h * k) / 5, z);
      stalks.push(vgrad(ring, 0x3f7a3a, 0x3f7a3a, 0, 1));
    }
    for (let k = 0; k < 3; k++) {
      const leaf = new THREE.ConeGeometry(0.55, 2.2, 4);
      leaf.scale(1, 1, 0.25);
      leaf.rotateZ(Math.PI / 2 + (rnd() - 0.5));
      leaf.rotateY(rnd() * 6.28);
      leaf.translate(x + (rnd() - 0.5), h * (0.7 + rnd() * 0.3), z + (rnd() - 0.5));
      stalks.push(vgrad(leaf, 0x4f9a42, 0x86d060, -1, 1));
    }
  }
  const geo = merge(stalks, true);
  const mats = points.map((p) => trs(p.x, p.y, p.z, rnd() * 6.28, 0.9 + rnd() * 0.4));
  return instanced([{ geo, mat: toon(0xffffff, { vertexColors: true, rim: 0.2 }), outline: opts.outline ? 0.04 : 0, outlineColor: 0x1e3a1e }], mats, { name: 'bamboo' });
}

// ------------------------------------------------------------------ тории
export function toriiParts(span = 12, height = 8.5) {
  const red = [];
  const black = [];
  const half = span / 2;
  for (const s of [-1, 1]) {
    const pillar = new THREE.CylinderGeometry(0.42, 0.5, height, 12);
    pillar.translate(s * half, height / 2, 0);
    red.push(pillar);
    const base = new THREE.CylinderGeometry(0.62, 0.66, 0.8, 12);
    base.translate(s * half, 0.4, 0);
    black.push(base);
  }
  const nuki = new THREE.BoxGeometry(span + 2.2, 0.45, 0.42);
  nuki.translate(0, height * 0.72, 0);
  red.push(nuki);
  const shimaki = new THREE.BoxGeometry(span + 2.6, 0.5, 0.7);
  shimaki.translate(0, height - 0.15, 0);
  red.push(shimaki);
  // верхняя балка с загнутыми концами
  const kasagiPts = [];
  const segs = 12;
  const w = span / 2 + 2.4;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = -w + t * 2 * w;
    const y = height + 0.55 + Math.pow(Math.abs(x) / w, 3) * 0.7;
    kasagiPts.push(new THREE.Vector3(x, y, 0));
  }
  const kasagi = taperedTube(kasagiPts, 0.42, 6, 24);
  kasagi.scale(1, 1, 1.35);
  black.push(kasagi);
  const strut = new THREE.BoxGeometry(0.5, height * 0.28 - 0.4, 0.4);
  strut.translate(0, height * 0.86 - 0.1, 0);
  red.push(strut);
  return { red: merge(red), black: merge(black) };
}

export function makeToriiRow(matrices, span, height, opts = {}) {
  const p = toriiParts(span, height);
  return instanced(
    [
      { geo: p.red, mat: toon(opts.red ?? 0xe8402f, { rim: 0.3 }), outline: 0.07 },
      { geo: p.black, mat: toon(opts.black ?? 0x2a2230), outline: 0.07 },
    ],
    matrices,
    { name: 'torii' }
  );
}

// ------------------------------------------------------------------ каменный фонарь
export function makeStoneLanterns(points, opts = {}) {
  const stone = [];
  const base = new THREE.CylinderGeometry(0.7, 0.85, 0.4, 8);
  base.translate(0, 0.2, 0);
  const pillar = new THREE.CylinderGeometry(0.28, 0.34, 1.6, 8);
  pillar.translate(0, 1.2, 0);
  const plate = new THREE.CylinderGeometry(0.75, 0.6, 0.25, 6);
  plate.translate(0, 2.1, 0);
  const box = new THREE.BoxGeometry(0.85, 0.75, 0.85);
  box.translate(0, 2.6, 0);
  const roof = new THREE.ConeGeometry(1.15, 0.7, 6);
  roof.translate(0, 3.3, 0);
  const knob = new THREE.SphereGeometry(0.2, 8, 6);
  knob.translate(0, 3.75, 0);
  stone.push(base, pillar, plate, box, roof, knob);
  const lightG = new THREE.BoxGeometry(0.9, 0.42, 0.5);
  lightG.translate(0, 2.62, 0);
  const light2 = new THREE.BoxGeometry(0.5, 0.42, 0.9);
  light2.translate(0, 2.62, 0);
  const rnd = mulberry32(3);
  const mats = points.map((p) => trs(p.x, p.y, p.z, p.ry ?? rnd() * 6.28, p.s ?? 1));
  return instanced(
    [
      { geo: merge(stone), mat: toon(opts.color ?? 0xb8b4ae), outline: 0.04 },
      { geo: merge([lightG, light2]), mat: glow(opts.light ?? 0xffc86a, opts.lightIntensity ?? 1.2), shadow: false },
    ],
    mats,
    { name: 'lanterns' }
  );
}

// ------------------------------------------------------------------ пагода
export function makePagoda(opts = {}) {
  const levels = opts.levels ?? 5;
  const red = [];
  const white = [];
  const roof = [];
  const gold = [];
  let y = 0;
  const base = new THREE.BoxGeometry(12, 1.6, 12);
  base.translate(0, 0.8, 0);
  white.push(base);
  y = 1.6;
  for (let i = 0; i < levels; i++) {
    const s = 8.4 - i * 1.1;
    const h = 4.2 - i * 0.2;
    const body = new THREE.BoxGeometry(s, h, s);
    body.translate(0, y + h / 2, 0);
    white.push(body);
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) {
        const col = new THREE.BoxGeometry(0.5, h, 0.5);
        col.translate(cx * (s / 2 - 0.1), y + h / 2, cz * (s / 2 - 0.1));
        red.push(col);
      }
    }
    const beam = new THREE.BoxGeometry(s + 0.4, 0.5, s + 0.4);
    beam.translate(0, y + h - 0.1, 0);
    red.push(beam);
    // крыша с загнутыми углами
    const rw = s + 5.2 - i * 0.2;
    const r = new THREE.ConeGeometry(rw * 0.72, 2.2, 4, 1, false);
    r.rotateY(Math.PI / 4);
    r.scale(1, 1, 1);
    r.translate(0, y + h + 0.9, 0);
    roof.push(r);
    const eave = new THREE.CylinderGeometry(rw * 0.66, rw * 0.72, 0.5, 4);
    eave.rotateY(Math.PI / 4);
    eave.translate(0, y + h + 0.05, 0);
    roof.push(eave);
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) {
        const tip = new THREE.ConeGeometry(0.35, 1.4, 5);
        tip.rotateZ(-cx * 0.9);
        tip.rotateX(cz * 0.9);
        tip.translate(cx * rw * 0.5, y + h + 0.5, cz * rw * 0.5);
        roof.push(tip);
      }
    }
    y += h + 1.3;
  }
  const spire = new THREE.CylinderGeometry(0.18, 0.3, 7, 8);
  spire.translate(0, y + 3.2, 0);
  gold.push(spire);
  for (let i = 0; i < 6; i++) {
    const ring = new THREE.TorusGeometry(0.55 - i * 0.04, 0.12, 6, 12);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y + 1 + i * 0.8, 0);
    gold.push(ring);
  }
  const ball = new THREE.SphereGeometry(0.45, 10, 8);
  ball.translate(0, y + 7, 0);
  gold.push(ball);
  const g = new THREE.Group();
  g.name = 'pagoda';
  const add = (list, mat, ol = 0.06) => {
    const m = new THREE.Mesh(merge(list), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    if (ol) m.add(new THREE.Mesh(outlineGeometry(m.geometry), outlineMaterial(OUT, ol)));
  };
  add(white, toon(opts.wall ?? 0xfff4e6));
  add(red, toon(opts.red ?? 0xd9362b));
  add(roof, toon(opts.roof ?? 0x3a4a5e, { rim: 0.25 }), 0.08);
  add(gold, toon(opts.gold ?? 0xffc23a, { rim: 0.4 }), 0.03);
  return g;
}

// ------------------------------------------------------------------ камни, трава, цветы, кусты
export function rockGeometry(seed = 1, detail = 1) {
  const rnd = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const k = 0.75 + rnd() * 0.45;
    v.multiplyScalar(k);
    v.y *= 0.7;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  return ng;
}

export function makeRocks(points, opts = {}) {
  const geo = normalizeGeometry(rockGeometry(opts.seed ?? 4, 1));
  const rnd = mulberry32(opts.seed ?? 4);
  const mats = points.map((p) => {
    const s = p.s ?? 1 + rnd() * 2;
    return trs(p.x, p.y, p.z, rnd() * 6.28, new THREE.Vector3(s * (0.8 + rnd() * 0.5), s * (0.6 + rnd() * 0.5), s * (0.8 + rnd() * 0.5)));
  });
  return instanced([{ geo, mat: toon(opts.color ?? 0x9a948e), outline: opts.outline ?? 0.05, outlineColor: 0x2a2428 }], mats, { name: 'rocks', receiveShadow: true, chunk: opts.chunk ?? 170 });
}

export function makeGrass(points, opts = {}) {
  const blades = [];
  const rnd = mulberry32(opts.seed ?? 11);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.ConeGeometry(0.1, 0.7 + rnd() * 0.5, 3, 1, true);
    b.translate(0, 0.35, 0);
    b.rotateZ((rnd() - 0.5) * 0.7);
    b.rotateX((rnd() - 0.5) * 0.5);
    b.translate((rnd() - 0.5) * 0.5, 0, (rnd() - 0.5) * 0.5);
    blades.push(vgrad(b, opts.low ?? 0x3f8a3a, opts.high ?? 0xa6e070, 0, 1.1));
  }
  const geo = merge(blades, true);
  const mats = [];
  const cols = [];
  for (const p of points) {
    mats.push(trs(p.x, p.y, p.z, rnd() * 6.28, 0.8 + rnd() * 0.9));
    cols.push(new THREE.Color().setHSL(0.26 + rnd() * 0.06, 0.5, 0.75 + rnd() * 0.25));
  }
  return instanced([{ geo, mat: toon(0xffffff, { vertexColors: true, ramp: 'soft' }), tint: true, shadow: false }], mats, { colors: cols, castShadow: false, name: 'grass', chunk: opts.chunk ?? 170 });
}

export function makeFlowers(points, palette = [0xffffff, 0xffe066, 0xff8fc1, 0xb58cff], opts = {}) {
  const petals = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = new THREE.CircleGeometry(0.16, 6);
    p.rotateX(-Math.PI / 2);
    p.translate(Math.cos(a) * 0.16, 0.45, Math.sin(a) * 0.16);
    petals.push(p);
  }
  const stem = new THREE.CylinderGeometry(0.02, 0.02, 0.45, 3);
  stem.translate(0, 0.22, 0);
  const center = new THREE.CircleGeometry(0.09, 6);
  center.rotateX(-Math.PI / 2);
  center.translate(0, 0.46, 0);
  const rnd = mulberry32(opts.seed ?? 13);
  const mats = points.map((p) => trs(p.x, p.y, p.z, rnd() * 6.28, 0.8 + rnd() * 0.8));
  const cols = points.map(() => new THREE.Color(palette[Math.floor(rnd() * palette.length)]));
  return instanced(
    [
      { geo: merge(petals), mat: toon(0xffffff, { side: THREE.DoubleSide, ramp: 'soft' }), tint: true, shadow: false },
      { geo: merge([stem]), mat: toon(0x4f9a42), shadow: false },
      { geo: merge([center]), mat: toon(0xffd23a, { side: THREE.DoubleSide }), shadow: false },
    ],
    mats,
    { colors: cols, castShadow: false, name: 'flowers', chunk: opts.chunk ?? 170 }
  );
}

export function makeBushes(points, opts = {}) {
  const rnd = mulberry32(opts.seed ?? 17);
  const balls = [];
  for (let i = 0; i < 5; i++) {
    const r = 0.9 + rnd() * 0.7;
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.translate((rnd() - 0.5) * 2.2, r * 0.7 + rnd() * 0.4, (rnd() - 0.5) * 2.2);
    balls.push(vgrad(g, opts.low ?? 0x2f7a3a, opts.high ?? 0x7cc860, 0, 2.5));
  }
  const geo = merge(balls, true);
  const mats = points.map((p) => trs(p.x, p.y, p.z, rnd() * 6.28, p.s ?? 0.8 + rnd() * 0.6));
  const cols = points.map(() => new THREE.Color().setHSL(0.3, 0.3, 0.85 + rnd() * 0.15));
  return instanced([{ geo, mat: toon(0xffffff, { vertexColors: true, rim: 0.25, ramp: 'soft' }), tint: true, outline: opts.outline ? 0.05 : 0, outlineColor: 0x1a3a22 }], mats, {
    colors: cols,
    name: 'bushes',
    chunk: opts.chunk ?? 170,
  });
}

// ------------------------------------------------------------------ флаги-нобори
export function makeNobori(points, palette = [0xff5d93, 0xffd23f, 0x39c6ff, 0xffffff]) {
  const pole = new THREE.CylinderGeometry(0.07, 0.08, 6.5, 6);
  pole.translate(0, 3.25, 0);
  const bar = new THREE.CylinderGeometry(0.05, 0.05, 1.3, 5);
  bar.rotateZ(Math.PI / 2);
  bar.translate(0.6, 6.2, 0);
  const cloth = new THREE.PlaneGeometry(1.2, 4.2, 1, 6);
  const pos = cloth.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getY(i) * 1.3) * 0.12);
  cloth.computeVertexNormals();
  cloth.translate(0.65, 4.05, 0);
  const rnd = mulberry32(31);
  const mats = points.map((p) => trs(p.x, p.y, p.z, p.ry ?? 0, 1));
  const cols = points.map(() => new THREE.Color(palette[Math.floor(rnd() * palette.length)]));
  return instanced(
    [
      { geo: merge([pole, bar]), mat: toon(0x3a2a2a) },
      { geo: normalizeGeometry(cloth), mat: toon(0xffffff, { side: THREE.DoubleSide }), tint: true, outline: 0.03 },
    ],
    mats,
    { colors: cols, name: 'nobori' }
  );
}

// ------------------------------------------------------------------ перила моста (японский стиль)
export function makeBridgeRails(track, opts = {}) {
  const group = new THREE.Group();
  const ranges = track.ranges((i) => (track.flags[i] & 1) !== 0);
  const railMat = toon(opts.color ?? 0xe23a2e, { rim: 0.3 });
  const goldMat = toon(opts.gold ?? 0xffc23a, { rim: 0.4 });
  const posts = [];
  const caps = [];
  const h = opts.height ?? 1.4;
  for (const [a, b] of ranges) {
    for (const s of [-1, 1]) {
      const prof = [
        { k: s, w: s, c: s * -0.1, y: h - 0.18 },
        { k: s, w: s, c: s * -0.1, y: h },
        { k: s, w: s, c: s * 0.2, y: h },
        { k: s, w: s, c: s * 0.2, y: h - 0.18 },
      ];
      if (s < 0) prof.reverse();
      const g = track.extrude(prof, { from: a, to: b });
      const m = new THREE.Mesh(g, railMat);
      m.material.side = THREE.DoubleSide;
      m.castShadow = true;
      group.add(m);
      const g2 = track.extrude(
        prof.map((p) => ({ ...p, y: p.y - h * 0.5 })),
        { from: a, to: b }
      );
      group.add(new THREE.Mesh(g2, railMat));
      const step = Math.max(1, Math.round(3 / track.spacing));
      for (let i = a; i <= b; i += step) {
        const j = i % track.count;
        const P = track.pos[j];
        const R = track.right[j];
        const lat = s * (track.hw[j] + track.wall[j] + 0.05);
        posts.push(new THREE.Vector3(P.x + R.x * lat, P.y + R.y * lat, P.z + R.z * lat));
      }
      for (const i of [a, b]) {
        const j = i % track.count;
        const P = track.pos[j];
        const R = track.right[j];
        const lat = s * (track.hw[j] + track.wall[j] + 0.05);
        caps.push(new THREE.Vector3(P.x + R.x * lat, P.y + R.y * lat, P.z + R.z * lat));
      }
    }
  }
  const postG = new THREE.BoxGeometry(0.26, h + 0.3, 0.26);
  postG.translate(0, (h + 0.3) / 2 - 0.2, 0);
  const capG = new THREE.SphereGeometry(0.3, 10, 8);
  capG.scale(1, 1.3, 1);
  const tipG = new THREE.ConeGeometry(0.12, 0.4, 8);
  tipG.translate(0, 0.45, 0);
  const cg = merge([capG, tipG]);
  group.add(instanced([{ geo: normalizeGeometry(postG), mat: railMat, outline: 0.03 }], posts.map((p) => trs(p.x, p.y, p.z)), { name: 'posts' }));
  group.add(instanced([{ geo: cg, mat: goldMat, outline: 0.03 }], caps.map((p) => trs(p.x, p.y + h + 0.3, p.z)), { name: 'caps' }));
  return group;
}

// ------------------------------------------------------------------ окружающие частицы (лепестки и т.п.)
const ambVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform vec3 uCam;
  uniform vec3 uBox;
  uniform float uFall;
  uniform float uSway;
  uniform float uSize;
  varying float vShade;
  varying float vAlpha;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  mat3 rotm(vec3 a) {
    float cx = cos(a.x), sx = sin(a.x), cy = cos(a.y), sy = sin(a.y), cz = cos(a.z), sz = sin(a.z);
    return mat3(cy * cz, cy * sz, -sy, sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy, cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy);
  }
  void main() {
    vUv = uv;
    float t = uTime * (0.6 + aSeed.w * 0.8);
    vec3 base = aSeed.xyz * uBox;
    vec3 drift = vec3(sin(t * 0.9 + aSeed.w * 20.0) * uSway + t * uSway * 0.6, -t * uFall, cos(t * 0.7 + aSeed.x * 30.0) * uSway);
    vec3 p = base + drift - uCam;
    p = mod(p, uBox) - uBox * 0.5;
    vec3 wp = uCam + p;
    mat3 R = rotm(vec3(t * 1.7 + aSeed.x * 10.0, t * 1.1 + aSeed.y * 10.0, t * 0.8));
    vec3 local = R * (position * uSize * (0.7 + aSeed.w * 0.6));
    vec4 mvPosition = viewMatrix * vec4(wp + local, 1.0);
    vShade = 0.75 + 0.25 * abs((R * vec3(0.0, 0.0, 1.0)).y);
    float d = length(p) / (uBox.x * 0.5);
    // не закрывать обзор: у самой камеры частицы растворяются
    vAlpha = (1.0 - smoothstep(0.75, 1.0, d)) * smoothstep(2.5, 6.0, length(p));
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const ambFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uColor2;
  uniform float uGlow;
  varying float vShade;
  varying float vAlpha;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    vec3 c = mix(uColor2, uColor, vUv.y) * vShade * (1.0 + uGlow);
    gl_FragColor = vec4(c, vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function createAmbientParticles(opts = {}) {
  const count = opts.count ?? 600;
  let base;
  if (opts.shape === 'streak') {
    base = new THREE.PlaneGeometry(0.03, 0.8);
  } else if (opts.shape === 'dot') {
    base = new THREE.IcosahedronGeometry(0.12, 0);
  } else {
    // лепесток сакуры: вытянутая капля с выемкой
    const s = new THREE.Shape();
    s.moveTo(0, -0.18);
    s.quadraticCurveTo(0.16, -0.05, 0.1, 0.14);
    s.lineTo(0, 0.09);
    s.lineTo(-0.1, 0.14);
    s.quadraticCurveTo(-0.16, -0.05, 0, -0.18);
    base = new THREE.ShapeGeometry(s, 3);
    const uv = base.getAttribute('uv');
    const pos = base.getAttribute('position');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, (pos.getY(i) + 0.18) / 0.32);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const seeds = new Float32Array(count * 4);
  const rnd = mulberry32(opts.seed ?? 77);
  for (let i = 0; i < count * 4; i++) seeds[i] = rnd();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = count;
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(...(opts.box ?? [70, 40, 70])) },
      uFall: { value: opts.fall ?? 1.4 },
      uSway: { value: opts.sway ?? 1.2 },
      uSize: { value: opts.size ?? 1.3 },
      uColor: { value: new THREE.Color(opts.color ?? 0xffc2dc) },
      uColor2: { value: new THREE.Color(opts.color2 ?? 0xff8fbf) },
      uGlow: { value: opts.glow ?? 0 },
    },
  ]);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: ambVert,
    fragmentShader: ambFrag,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = 'ambient';
  mesh.userData.update = (dt, camera) => {
    uniforms.uTime.value += dt;
    uniforms.uCam.value.copy(camera.position);
  };
  mesh.userData.setCount = (n) => (geo.instanceCount = Math.min(count, n));
  return mesh;
}

// ------------------------------------------------------------------ раскладка точек вокруг трассы
/**
 * Разбрасывает точки вокруг трассы, избегая дорогу. heightAt(x,z) — высота рельефа.
 * opts: { count, minDist, maxDist, seed, avoid(x,z)->bool, region: {x0,x1,z0,z1} }
 */
export function scatterAround(track, heightAt, opts = {}) {
  const rnd = mulberry32(opts.seed ?? 1);
  const out = [];
  const count = opts.count ?? 100;
  const minD = opts.minDist ?? 14;
  const maxD = opts.maxDist ?? 60;
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    let x;
    let z;
    if (opts.region) {
      const r = opts.region;
      x = r.x0 + rnd() * (r.x1 - r.x0);
      z = r.z0 + rnd() * (r.z1 - r.z0);
    } else {
      const i = Math.floor(rnd() * track.count);
      const P = track.pos[i];
      const R = track.right[i];
      const side = rnd() < 0.5 ? -1 : 1;
      const d = track.hw[i] + track.wall[i] + minD * 0.5 + rnd() * (maxD - minD * 0.5);
      x = P.x + R.x * side * d + (rnd() - 0.5) * 6;
      z = P.z + R.z * side * d + (rnd() - 0.5) * 6;
    }
    const { dist, index } = track.distanceTo(x, z, maxD + 30);
    const edge = index >= 0 ? track.hw[index] + track.wall[index] : 10;
    if (index >= 0 && dist < edge + minD) continue;
    if (!opts.region && dist > edge + maxD) continue;
    if (opts.avoid && opts.avoid(x, z)) continue;
    const y = heightAt(x, z);
    if (opts.minY !== undefined && y < opts.minY) continue;
    if (opts.maxY !== undefined && y > opts.maxY) continue;
    out.push(new THREE.Vector3(x, y, z));
  }
  return out;
}

export { rod };
