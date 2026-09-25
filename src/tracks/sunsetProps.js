// Декорации "Закатного Берега": пальмы, маяк с вращающимся лучом, пирс, фонари, пляжные домики,
// зонтики, спасательная вышка, колесо обозрения, яхты, чайки, небесные фонарики, острова.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, glow, outlineMaterial, outlineGeometry, normalizeGeometry, softCircleTexture } from '../world/toon.js';
import { taperedTube, rod } from '../world/geom.js';
import { mulberry32 } from '../world/sky.js';
import { instanced, trs, rockGeometry } from '../world/props.js';

const OUT = 0x2a1622;

function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function vgrad(geo, bottom, top, y0, y1) {
  const c0 = new THREE.Color(bottom);
  const c1 = new THREE.Color(top);
  const pos = geo.getAttribute('position');
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(c0).lerp(c1, THREE.MathUtils.clamp((pos.getY(i) - y0) / (y1 - y0), 0, 1));
    c.toArray(arr, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function merge(list, color = false) {
  return mergeGeometries(list.map((g) => normalizeGeometry(g, { color })));
}

function addMesh(group, geo, mat, ol = 0, olColor = OUT) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  if (ol) m.add(new THREE.Mesh(outlineGeometry(geo), outlineMaterial(olColor, ol)));
  return m;
}

// ------------------------------------------------------------------ пальмы
/** Закрытая "лента"-лист: сечение — ромб с килем, края опущены (V-образный лист). */
function frondGeometry(start, dir, len, lift, droop, width, segs, rnd) {
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, dir).normalize();
  const pos = [];
  const cols = [];
  const cBase = new THREE.Color(0x2c6a34);
  const cTip = new THREE.Color(0x8cc45a);
  const cUnder = new THREE.Color(0x1f4a2a);
  const c = new THREE.Color();
  for (let s = 0; s <= segs; s++) {
    const u = s / segs;
    const center = start
      .clone()
      .addScaledVector(dir, len * u)
      .addScaledVector(up, lift * Math.sin(Math.PI * u * 0.9) - droop * u * u);
    // зубчатый край — намёк на отдельные листочки
    const jag = s % 2 === 0 ? 1 : 0.55 + rnd() * 0.15;
    const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.12)), 0.7) * jag + 0.02;
    const fold = w * 0.45;
    const top = center.clone().addScaledVector(up, 0.06);
    const right = center.clone().addScaledVector(side, w).addScaledVector(up, -fold);
    const bottom = center.clone().addScaledVector(up, -0.07);
    const left = center.clone().addScaledVector(side, -w).addScaledVector(up, -fold);
    for (const p of [top, right, bottom, left]) pos.push(p.x, p.y, p.z);
    c.copy(cBase).lerp(cTip, Math.pow(u, 0.8));
    for (let k = 0; k < 4; k++) {
      const cc = k === 2 ? c.clone().lerp(cUnder, 0.6) : c;
      cols.push(cc.r, cc.g, cc.b);
    }
  }
  const idx = [];
  for (let s = 0; s < segs; s++) {
    for (let j = 0; j < 4; j++) {
      const a = s * 4 + j;
      const b = s * 4 + ((j + 1) % 4);
      const d = (s + 1) * 4 + j;
      const e = (s + 1) * 4 + ((j + 1) % 4);
      idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // проверка ориентации: нормаль верхней вершины середины листа должна смотреть вверх
  const mid = Math.floor(segs / 2) * 4;
  if (g.getAttribute('normal').getY(mid) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

export function palmGeometry(seed = 1, { height = 9, fronds = 7, segs = 7 } = {}) {
  const rnd = mulberry32(seed * 31 + 7);
  const H = height * (0.9 + rnd() * 0.2);
  const lean = 1.4 + rnd() * 1.8;
  const pts = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push(new THREE.Vector3(lean * t * t, H * t - 0.3 * (1 - t), 0));
  }
  const trunk = taperedTube(pts, (t) => 0.42 - t * 0.17, 5, 8, false);
  // кольца на стволе
  const uv = trunk.getAttribute('uv');
  const tc = new Float32Array(uv.count * 3);
  const dark = new THREE.Color(0x6e4a32);
  const light = new THREE.Color(0xa47a52);
  for (let i = 0; i < uv.count; i++) {
    const v = uv.getY(i);
    const c = (Math.floor(v * 13) % 2 ? dark : light).clone().lerp(new THREE.Color(0x8a6a48), v * 0.4);
    c.toArray(tc, i * 3);
  }
  trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  const parts = [trunk];
  const top = pts[4];
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rnd() * 0.5;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const len = 3.8 + rnd() * 1.4;
    const lift = 0.7 + rnd() * 0.9;
    const droop = 2.0 + rnd() * 1.4;
    parts.push(frondGeometry(top.clone().addScaledVector(dir, 0.2), dir, len, lift, droop, 0.62 + rnd() * 0.12, segs, rnd));
  }
  // 2 молодых листа, торчащих вверх
  for (let i = 0; i < 2; i++) {
    const a = rnd() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5).normalize();
    parts.push(frondGeometry(top.clone(), dir, 2.2, 2.2, 0.6, 0.4, 5, rnd));
  }
  const crown = new THREE.IcosahedronGeometry(0.55, 0);
  crown.translate(top.x, top.y - 0.1, top.z);
  parts.push(paint(crown, 0x5a6a2a));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const nut = new THREE.OctahedronGeometry(0.28, 0);
    nut.translate(top.x + Math.cos(a) * 0.38, top.y - 0.45, top.z + Math.sin(a) * 0.38);
    parts.push(paint(nut, 0x6a4424));
  }
  return merge(parts, true);
}

/** points: [{x,y,z, ry?, s?}] — ry задаёт направление наклона (к морю). */
export function makePalms(points, opts = {}) {
  const group = new THREE.Group();
  group.name = 'palms';
  const variants = opts.variants ?? 3;
  const geos = [];
  for (let v = 0; v < variants; v++) geos.push(palmGeometry(v + (opts.seed ?? 0) * 5, { height: 8.5 + v * 0.9, fronds: opts.fronds ?? 7, segs: opts.segs ?? 7 }));
  const mat = toon(0xffffff, { vertexColors: true, rim: 0.35, rimColor: 0xffc890 });
  const rnd = mulberry32(opts.seed ?? 3);
  const buckets = geos.map(() => []);
  for (const p of points) {
    const v = Math.floor(rnd() * variants);
    buckets[v].push(trs(p.x, p.y - 0.2, p.z, p.ry ?? rnd() * Math.PI * 2, p.s ?? 0.85 + rnd() * 0.35));
  }
  geos.forEach((g, i) => {
    group.add(instanced([{ geo: g, mat, outline: opts.outline ? 0.05 : 0, outlineColor: 0x1c2418 }], buckets[i], { name: 'palm-v' + i, chunk: opts.chunk ?? 300 }));
  });
  return group;
}

// ------------------------------------------------------------------ маяк
export function makeLighthouse(opts = {}) {
  const group = new THREE.Group();
  group.name = 'lighthouse';
  const H = opts.height ?? 18;
  const r0 = 2.9;
  const r1 = 1.9;
  const white = [];
  const red = [];
  const dark = [];
  const bands = 6;
  const radiusAt = (y) => r0 + (r1 - r0) * (y / H);
  for (let b = 0; b < bands; b++) {
    const y0 = (b / bands) * H;
    const y1 = ((b + 1) / bands) * H;
    const prof = [new THREE.Vector2(radiusAt(y0), y0), new THREE.Vector2(radiusAt(y1), y1)];
    const g = new THREE.LatheGeometry(prof, 20);
    (b % 2 ? red : white).push(g);
  }
  // цоколь
  const base = new THREE.CylinderGeometry(r0 + 0.6, r0 + 0.9, 1.4, 20);
  base.translate(0, 0.3, 0);
  white.push(base);
  // окна-щели
  for (let i = 0; i < 4; i++) {
    const y = H * (0.18 + i * 0.2);
    const w = new THREE.BoxGeometry(0.5, 1.0, 0.3);
    w.translate(0, y, radiusAt(y) - 0.05);
    w.rotateY(i * 1.7);
    dark.push(w);
  }
  // галерея
  const deck = new THREE.CylinderGeometry(r1 + 1.1, r1 + 0.6, 0.45, 20);
  deck.translate(0, H + 0.2, 0);
  dark.push(deck);
  const rail = new THREE.TorusGeometry(r1 + 1.0, 0.07, 4, 24);
  rail.rotateX(Math.PI / 2);
  rail.translate(0, H + 1.25, 0);
  dark.push(rail);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    dark.push(rod([Math.cos(a) * (r1 + 1.0), H + 0.4, Math.sin(a) * (r1 + 1.0)], [Math.cos(a) * (r1 + 1.0), H + 1.25, Math.sin(a) * (r1 + 1.0)], 0.05, 0.05, 4));
  }
  // фонарная комната: стойки + стекло
  const lampY = H + 1.7;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    dark.push(rod([Math.cos(a) * 1.35, H + 0.4, Math.sin(a) * 1.35], [Math.cos(a) * 1.35, H + 3.0, Math.sin(a) * 1.35], 0.09, 0.09, 4));
  }
  const roof = new THREE.ConeGeometry(2.0, 1.8, 16);
  roof.translate(0, H + 3.8, 0);
  red.push(roof);
  const cap = new THREE.SphereGeometry(0.35, 10, 8);
  cap.translate(0, H + 4.85, 0);
  dark.push(cap);
  const vane = rod([0, H + 4.8, 0], [0, H + 6.0, 0], 0.05, 0.03, 4);
  dark.push(vane);

  addMesh(group, merge(white), toon(0xfff6ec, { rim: 0.35, rimColor: 0xffd0a0 }), 0.07);
  addMesh(group, merge(red), toon(0xe0333a, { rim: 0.3, rimColor: 0xffb080 }), 0.07);
  addMesh(group, merge(dark), toon(0x2e2a3a), 0.03);
  // стекло с лампой (светится)
  const glass = new THREE.CylinderGeometry(1.25, 1.25, 2.4, 12, 1, true);
  glass.translate(0, lampY, 0);
  const glassMesh = new THREE.Mesh(glass, glow(0xffd890, 1.6, { side: THREE.DoubleSide }));
  group.add(glassMesh);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), glow(0xfff2c8, 5));
  bulb.position.y = lampY;
  group.add(bulb);
  // ореол
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: softCircleTexture(), color: new THREE.Color(0xffc870).multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  );
  halo.scale.setScalar(11);
  halo.position.y = lampY;
  group.add(halo);

  // домик смотрителя
  const house = new THREE.Group();
  const body = new THREE.BoxGeometry(6, 3.2, 4.4);
  body.translate(0, 1.4, 0);
  const hr = new THREE.CylinderGeometry(0.01, 3.9, 2.0, 4, 1);
  hr.rotateY(Math.PI / 4);
  hr.scale(1.1, 1, 0.82);
  hr.translate(0, 4.0, 0);
  const door = new THREE.BoxGeometry(1.0, 1.9, 0.2);
  door.translate(0, 0.9, 2.25);
  addMesh(house, merge([paint(body, 0xfff1e2), paint(hr, 0xd8383e), paint(door, 0x3a6ac8)], true), toon(0xffffff, { vertexColors: true, rim: 0.3, rimColor: 0xffd0a0 }), 0.05);
  const win = new THREE.BoxGeometry(1.1, 0.9, 0.12);
  win.translate(-1.8, 1.8, 2.22);
  const win2 = win.clone().translate(3.6, 0, 0);
  house.add(new THREE.Mesh(merge([win, win2]), glow(0xffb860, 1.5)));
  house.position.set(opts.housePos?.x ?? 7, 0, opts.housePos?.z ?? 3);
  house.rotation.y = opts.houseRot ?? 0.3;
  group.add(house);

  // вращающийся луч: два конуса с затуханием к концу
  const beam = new THREE.Group();
  beam.position.y = lampY;
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xffe6b0).multiplyScalar(0.6) } },
    vertexShader: /* glsl */ `
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vT = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
        float a = pow(vT, 2.2) * (0.25 + 0.75 * edge);
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const len = opts.beamLength ?? 80;
  for (const s of [1, -1]) {
    const cone = new THREE.ConeGeometry(5, len, 20, 1, true);
    cone.translate(0, -len / 2, 0);
    cone.rotateZ((s * Math.PI) / 2);
    const m = new THREE.Mesh(cone, beamMat);
    m.rotation.z = s * -0.05; // чуть вниз, к морю
    m.renderOrder = 5;
    m.userData.noShadow = true;
    m.frustumCulled = false;
    beam.add(m);
  }
  group.add(beam);
  let t = 0;
  const update = (dt) => {
    t += dt;
    beam.rotation.y = t * 0.9;
    const pulse = 1 + Math.sin(t * 2.3) * 0.08;
    halo.scale.setScalar(11 * pulse);
  };
  return { group, update };
}

// ------------------------------------------------------------------ сваи пирса, фонари, гирлянды
export function makePilings(points, opts = {}) {
  const g = new THREE.CylinderGeometry(0.32, 0.38, 1, 7);
  g.translate(0, 0.5, 0);
  const mats = points.map((p) => {
    const h = Math.max(0.5, p.top - p.bottom);
    return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.bottom, p.z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
  });
  return instanced([{ geo: normalizeGeometry(g), mat: toon(opts.color ?? 0x6a4a36), shadow: false }], mats, { name: 'pilings', castShadow: false });
}

/** Фонарный столб с тёплым светом. points: [{x,y,z,ry}] (ry — поворот кронштейна). */
export function makeLampPosts(points, opts = {}) {
  const h = opts.height ?? 5.2;
  const pole = new THREE.CylinderGeometry(0.1, 0.15, h, 6);
  pole.translate(0, h / 2, 0);
  const foot = new THREE.CylinderGeometry(0.28, 0.32, 0.5, 6);
  foot.translate(0, 0.25, 0);
  const arm = rod([0, h - 0.2, 0], [0.9, h + 0.15, 0], 0.06, 0.06, 4);
  const hood = new THREE.ConeGeometry(0.42, 0.35, 8);
  hood.translate(0.95, h + 0.1, 0);
  const lamp = new THREE.SphereGeometry(0.28, 8, 6);
  lamp.translate(0.95, h - 0.18, 0);
  const mats = points.map((p) => trs(p.x, p.y - 0.1, p.z, p.ry ?? 0, p.s ?? 1));
  return instanced(
    [
      { geo: merge([pole, foot, arm, hood]), mat: toon(opts.color ?? 0x2e3448), outline: opts.outline ? 0.03 : 0 },
      { geo: normalizeGeometry(lamp), mat: glow(opts.light ?? 0xffc878, opts.intensity ?? 3.2), shadow: false },
    ],
    mats,
    { name: 'lamps', chunk: 300 }
  );
}

/** Гирлянда лампочек, провисающая между точками пар [a, b]. */
export function makeStringLights(pairs, opts = {}) {
  const bulbs = [];
  const colors = [];
  const wire = [];
  const palette = (opts.palette ?? [0xffd27a, 0xff8a6a, 0xfff0c0, 0xff9ad0]).map((c) => new THREE.Color(c));
  let k = 0;
  for (const [a, b] of pairs) {
    const n = Math.max(3, Math.round(a.distanceTo(b) / (opts.spacing ?? 1.6)));
    const sag = opts.sag ?? 0.9;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(Math.PI * t) * sag;
      if (i > 0 && i < n) {
        bulbs.push(trs(p.x, p.y - 0.12, p.z, 0, 1));
        colors.push(palette[k++ % palette.length]);
      }
      if (prev) wire.push(prev, p);
      prev = p;
    }
  }
  const group = new THREE.Group();
  const bg = new THREE.IcosahedronGeometry(opts.size ?? 0.16, 0);
  group.add(
    instanced([{ geo: normalizeGeometry(bg), mat: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(opts.intensity ?? 3) }), tint: true, shadow: false }], bulbs, {
      colors,
      castShadow: false,
      name: 'bulbs',
    })
  );
  if (wire.length) {
    const lg = new THREE.BufferGeometry().setFromPoints(wire);
    group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2030 })));
  }
  return group;
}

// ------------------------------------------------------------------ пляж: домики, зонтики, полотенца, вышка
export function makeBeachHuts(points, opts = {}) {
  const body = new THREE.BoxGeometry(3.0, 2.8, 2.6);
  body.translate(0, 1.4 + 0.4, 0);
  const stilts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) stilts.push(rod([sx * 1.3, 0, sz * 1.1], [sx * 1.3, 0.5, sz * 1.1], 0.12, 0.12, 4));
  const roof = new THREE.CylinderGeometry(0.01, 2.6, 1.3, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.scale(1.0, 1, 0.85);
  roof.translate(0, 3.9, 0);
  const door = new THREE.BoxGeometry(1.1, 1.9, 0.12);
  door.translate(0, 1.4, 1.32);
  const trim = new THREE.BoxGeometry(3.2, 0.25, 2.8);
  trim.translate(0, 3.2, 0);
  const rnd = mulberry32(opts.seed ?? 5);
  const palette = (opts.palette ?? [0x6fd0e8, 0xffd04a, 0xff8aa8, 0x8ae0a0, 0xffa060, 0xb8a0ff]).map((c) => new THREE.Color(c));
  const mats = points.map((p) => trs(p.x, p.y, p.z, p.ry ?? 0, 1));
  const cols = points.map(() => palette[Math.floor(rnd() * palette.length)]);
  return instanced(
    [
      { geo: normalizeGeometry(body), mat: toon(0xffffff, { rim: 0.3, rimColor: 0xffd0a0 }), tint: true, outline: 0.04 },
      { geo: merge([roof, trim]), mat: toon(0xfff4ea, { rim: 0.2 }), outline: 0.04 },
      { geo: merge([door, ...stilts]), mat: toon(0x7a5238) },
    ],
    mats,
    { colors: cols, name: 'huts' }
  );
}

/** Пляжный зонтик: полосатый купол + стойка. Цвета — варианты. */
export function makeUmbrellas(points, opts = {}) {
  const palette = opts.palette ?? [0xff4a5a, 0x3a9aff, 0xffc02a, 0x2ac8a8, 0xff7ac0];
  const group = new THREE.Group();
  group.name = 'umbrellas';
  const rnd = mulberry32(opts.seed ?? 9);
  const buckets = palette.map(() => []);
  for (const p of points) {
    const tilt = (rnd() - 0.5) * 0.3;
    buckets[Math.floor(rnd() * palette.length)].push(trs(p.x, p.y - 0.1, p.z, rnd() * Math.PI * 2, 1, tilt, (rnd() - 0.5) * 0.3));
  }
  const mat = toon(0xffffff, { vertexColors: true, rim: 0.3, rimColor: 0xffd0a0, side: THREE.DoubleSide });
  palette.forEach((col, vi) => {
    const segs = 8;
    const parts = [];
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const R = 2.3;
      const top = new THREE.Vector3(0, 3.05, 0);
      const p0 = new THREE.Vector3(Math.cos(a0) * R, 2.35, Math.sin(a0) * R);
      const p1 = new THREE.Vector3(Math.cos(a1) * R, 2.35, Math.sin(a1) * R);
      const g = new THREE.BufferGeometry().setFromPoints([top, p1, p0]);
      g.computeVertexNormals();
      parts.push(paint(g, i % 2 ? 0xfff8ee : col));
    }
    const pole = new THREE.CylinderGeometry(0.05, 0.05, 3.1, 4);
    pole.translate(0, 1.55, 0);
    parts.push(paint(pole, 0xf0f0f0));
    const towel = new THREE.PlaneGeometry(1.1, 2.0);
    towel.rotateX(-Math.PI / 2);
    towel.translate(1.4, 0.12, 0.3);
    parts.push(paint(towel, col));
    group.add(instanced([{ geo: merge(parts, true), mat, outline: 0 }], buckets[vi], { name: 'umbrella-' + vi, castShadow: true }));
  });
  return group;
}

export function makeLifeguardTower() {
  const group = new THREE.Group();
  group.name = 'lifeguard';
  const parts = [];
  const wood = (g) => parts.push(paint(g, 0xf4ecdc));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wood(rod([sx * 1.4, 0, sz * 1.4], [sx * 1.0, 3.2, sz * 1.0], 0.13, 0.13, 5));
  wood(rod([-1.2, 1.4, 1.2], [1.2, 1.4, 1.2], 0.08, 0.08, 4));
  wood(rod([-1.2, 1.4, -1.2], [1.2, 1.4, -1.2], 0.08, 0.08, 4));
  // лестница
  for (let i = 0; i < 6; i++) wood(rod([-0.5, i * 0.55, 2.4 - i * 0.2], [0.5, i * 0.55, 2.4 - i * 0.2], 0.06, 0.06, 4));
  wood(rod([-0.55, 0, 2.5], [-0.55, 3.2, 1.2], 0.07, 0.07, 4));
  wood(rod([0.55, 0, 2.5], [0.55, 3.2, 1.2], 0.07, 0.07, 4));
  const floor = new THREE.BoxGeometry(2.8, 0.25, 2.8);
  floor.translate(0, 3.3, 0);
  wood(floor);
  const cabin = new THREE.BoxGeometry(2.4, 1.1, 2.4);
  cabin.translate(0, 3.95, 0);
  parts.push(paint(cabin, 0xe8423a));
  const roof = new THREE.CylinderGeometry(0.01, 2.4, 1.1, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 5.6, 0);
  parts.push(paint(roof, 0xfff4e8));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wood(rod([sx * 1.1, 4.4, sz * 1.1], [sx * 1.1, 5.1, sz * 1.1], 0.06, 0.06, 4));
  parts.push(paint(rod([1.3, 5.0, -1.3], [1.3, 8.0, -1.3], 0.05, 0.05, 4), 0xdddddd));
  const flag = new THREE.BoxGeometry(1.4, 0.8, 0.04);
  flag.translate(2.0, 7.6, -1.3);
  parts.push(paint(flag, 0xffd02a));
  addMesh(group, merge(parts, true), toon(0xffffff, { vertexColors: true, rim: 0.3, rimColor: 0xffd0a0 }), 0.035);
  return group;
}

// ------------------------------------------------------------------ камни (крупные чанки — меньше draw calls)
export function makeRocks(points, opts = {}) {
  const geo = normalizeGeometry(rockGeometry(opts.seed ?? 4, 1));
  const rnd = mulberry32(opts.seed ?? 4);
  const mats = points.map((p) => {
    const s = p.s ?? 1 + rnd() * 2;
    const sy = p.sy ?? 1;
    return trs(p.x, p.y, p.z, rnd() * 6.28, new THREE.Vector3(s * (0.8 + rnd() * 0.5), s * sy * (0.6 + rnd() * 0.5), s * (0.8 + rnd() * 0.5)));
  });
  return instanced([{ geo, mat: toon(opts.color ?? 0x9a948e, { rim: 0.25, rimColor: 0xffb080 }), outline: opts.outline ?? 0.05, outlineColor: 0x2a2024 }], mats, { name: 'rocks', receiveShadow: true, chunk: 420 });
}

// ------------------------------------------------------------------ цветы гибискуса (одна деталь, крупные чанки)
export function makeHibiscus(points, palette = [0xff4a6a, 0xffd84a, 0xff8ac0, 0xffffff, 0xff7a3a], opts = {}) {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = new THREE.CircleGeometry(0.2, 5);
    p.rotateX(-Math.PI / 2 + 0.35);
    p.rotateY(-a + Math.PI / 2);
    p.translate(Math.cos(a) * 0.2, 0.5, Math.sin(a) * 0.2);
    parts.push(paint(p, 0xffffff));
  }
  const center = new THREE.CircleGeometry(0.08, 5);
  center.rotateX(-Math.PI / 2);
  center.translate(0, 0.53, 0);
  parts.push(paint(center, 0xffe27a));
  const stem = new THREE.CylinderGeometry(0.025, 0.025, 0.5, 3);
  stem.translate(0, 0.25, 0);
  parts.push(paint(stem, 0x4a8a3a));
  const leaf = new THREE.CircleGeometry(0.16, 4);
  leaf.rotateX(-Math.PI / 2 + 0.5);
  leaf.translate(0.12, 0.22, 0);
  parts.push(paint(leaf, 0x4a8a3a));
  const rnd = mulberry32(opts.seed ?? 13);
  const mats = points.map((p) => trs(p.x, p.y, p.z, rnd() * 6.28, 0.8 + rnd() * 0.7));
  const cols = points.map(() => new THREE.Color(palette[Math.floor(rnd() * palette.length)]));
  // белые лепестки тонируются цветом инстанса; стебель и серединка остаются тёмными/жёлтыми за счёт вершинных цветов
  return instanced([{ geo: merge(parts, true), mat: toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide, ramp: 'soft' }), tint: true, shadow: false }], mats, {
    colors: cols,
    castShadow: false,
    name: 'flowers',
    chunk: 420,
  });
}

// ------------------------------------------------------------------ дома на холмах
export function makeHouses(points, opts = {}) {
  const body = new THREE.BoxGeometry(6, 4, 5);
  body.translate(0, 1.8, 0);
  const roof = new THREE.CylinderGeometry(0.01, 4.6, 2.2, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.scale(1.05, 1, 0.9);
  roof.translate(0, 4.9, 0);
  const wins = [];
  for (const sx of [-1.6, 1.6]) {
    const w = new THREE.BoxGeometry(1.1, 1.1, 0.15);
    w.translate(sx, 2.3, 2.52);
    wins.push(w);
  }
  const w2 = new THREE.BoxGeometry(0.15, 1.1, 1.1);
  w2.translate(3.02, 2.3, 0);
  wins.push(w2);
  const rnd = mulberry32(opts.seed ?? 12);
  const walls = [0xfff4e6, 0xfde8d0, 0xf0f4ff, 0xffe0d8, 0xe8fff0].map((c) => new THREE.Color(c));
  const roofs = [0xd8483e, 0x3a6ac8, 0x2aa8a0, 0xe07a3a, 0x7a58c8].map((c) => new THREE.Color(c));
  const mats = points.map((p) => trs(p.x, p.y - 0.4, p.z, p.ry ?? rnd() * Math.PI * 2, p.s ?? 0.9 + rnd() * 0.3));
  const wc = points.map(() => walls[Math.floor(rnd() * walls.length)]);
  const rc = points.map(() => roofs[Math.floor(rnd() * roofs.length)]);
  const group = new THREE.Group();
  group.name = 'houses';
  const ol = opts.outline ? 0.05 : 0;
  group.add(instanced([{ geo: normalizeGeometry(body), mat: toon(0xffffff, { rim: 0.3, rimColor: 0xffc8a0 }), tint: true, outline: ol }], mats, { colors: wc, name: 'house-body' }));
  group.add(instanced([{ geo: normalizeGeometry(roof), mat: toon(0xffffff, { rim: 0.2 }), tint: true, outline: ol }], mats, { colors: rc, name: 'house-roof' }));
  group.add(instanced([{ geo: merge(wins), mat: glow(0xffb45a, 1.8), shadow: false }], mats, { name: 'house-win', castShadow: false }));
  return group;
}

// ------------------------------------------------------------------ колесо обозрения
export function makeFerrisWheel(opts = {}) {
  const group = new THREE.Group();
  group.name = 'ferris';
  const R = opts.radius ?? 24;
  const hubY = R + 4;
  const frame = [];
  // опоры (А-образные)
  for (const sz of [-1.6, 1.6]) {
    frame.push(rod([-R * 0.45, 0, sz * 2.2], [0, hubY, sz], 0.45, 0.35, 6));
    frame.push(rod([R * 0.45, 0, sz * 2.2], [0, hubY, sz], 0.45, 0.35, 6));
  }
  frame.push(rod([0, hubY, -2], [0, hubY, 2], 0.8, 0.8, 8));
  const base = new THREE.BoxGeometry(R * 1.2, 1.2, 7);
  base.translate(0, 0.6, 0);
  frame.push(base);
  const fmat = toon(0xf4f0ff, { rim: 0.3, rimColor: 0xffc0a0 });
  addMesh(group, merge(frame), fmat, 0);
  const wheel = new THREE.Group();
  wheel.position.y = hubY;
  group.add(wheel);
  const wparts = [];
  for (const z of [-1, 1]) {
    const ring = new THREE.TorusGeometry(R, 0.28, 4, 48);
    ring.translate(0, 0, z);
    wparts.push(ring);
    const inner = new THREE.TorusGeometry(R * 0.35, 0.2, 4, 20);
    inner.translate(0, 0, z);
    wparts.push(inner);
  }
  const spokes = 16;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    for (const z of [-1, 1]) wparts.push(rod([0, 0, z], [Math.cos(a) * R, Math.sin(a) * R, z], 0.1, 0.1, 3));
  }
  addMesh(wheel, merge(wparts), fmat, 0);
  // лампочки по ободу (разноцветные, светятся)
  const bulbs = [];
  const cols = [0xff6ab0, 0xffd24a, 0x6ae8ff, 0xfff0d0].map((c) => new THREE.Color(c));
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const g = new THREE.IcosahedronGeometry(0.42, 0);
    g.translate(Math.cos(a) * (R + 0.2), Math.sin(a) * (R + 0.2), 1.35);
    bulbs.push(paint(g, cols[i % 4]));
  }
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    for (let k = 1; k < 5; k++) {
      const g = new THREE.IcosahedronGeometry(0.28, 0);
      g.translate(Math.cos(a) * R * (k / 5), Math.sin(a) * R * (k / 5), 1.2);
      bulbs.push(paint(g, cols[(i + k) % 4]));
    }
  }
  const bulbMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1).multiplyScalar(3.2) });
  const bm = new THREE.Mesh(merge(bulbs, true), bulbMat);
  wheel.add(bm);
  // кабинки (инстансы, остаются вертикальными)
  const cab = new THREE.CylinderGeometry(1.1, 0.9, 1.8, 6);
  cab.translate(0, -1.6, 0);
  const cabRoof = new THREE.ConeGeometry(1.3, 0.7, 6);
  cabRoof.translate(0, -0.45, 0);
  const cabGeo = merge([paint(cab, 0xffffff), paint(cabRoof, 0xfff4e8)], true);
  const cabColors = [0xff6a8a, 0x5ab8ff, 0xffc84a, 0x6ad8a8].map((c) => new THREE.Color(c));
  const cabs = new THREE.InstancedMesh(cabGeo, toon(0xffffff, { vertexColors: true }), spokes);
  for (let i = 0; i < spokes; i++) cabs.setColorAt(i, cabColors[i % 4]);
  cabs.frustumCulled = false;
  group.add(cabs);
  const m4 = new THREE.Matrix4();
  let angle = 0;
  const place = () => {
    for (let i = 0; i < spokes; i++) {
      const a = angle + (i / spokes) * Math.PI * 2;
      m4.makeTranslation(Math.cos(a) * R, hubY + Math.sin(a) * R, 0);
      cabs.setMatrixAt(i, m4);
    }
    cabs.instanceMatrix.needsUpdate = true;
  };
  place();
  let t = 0;
  const update = (dt) => {
    t += dt;
    angle += dt * 0.07;
    wheel.rotation.z = angle;
    place();
    // бегущие огни
    bulbMat.color.setScalar(2.6 + Math.sin(t * 3) * 0.6);
  };
  return { group, update };
}

// ------------------------------------------------------------------ яхты
export function makeSailboats(list, opts = {}) {
  const hull = new THREE.BoxGeometry(1.6, 0.9, 6, 1, 1, 2);
  const hp = hull.getAttribute('position');
  for (let i = 0; i < hp.count; i++) {
    const z = hp.getZ(i);
    const y = hp.getY(i);
    if (z > 2.9) hp.setX(i, hp.getX(i) * 0.05);
    if (y < 0) hp.setX(i, hp.getX(i) * 0.55);
  }
  hull.computeVertexNormals();
  hull.translate(0, 0.25, 0);
  const deck = new THREE.BoxGeometry(1.2, 0.5, 2.0);
  deck.translate(0, 0.9, -0.8);
  const mast = new THREE.CylinderGeometry(0.06, 0.08, 8.5, 4);
  mast.translate(0, 4.8, 0.4);
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0);
  sailShape.lineTo(0, 7.6);
  sailShape.quadraticCurveTo(-1.6, 3.2, -3.6, 0);
  sailShape.lineTo(0, 0);
  const sail = new THREE.ShapeGeometry(sailShape, 4);
  sail.rotateY(-Math.PI / 2);
  sail.translate(0.05, 1.2, 0.4);
  const jibShape = new THREE.Shape();
  jibShape.moveTo(0, 0);
  jibShape.lineTo(0, 6.4);
  jibShape.lineTo(2.6, 0);
  jibShape.lineTo(0, 0);
  const jib = new THREE.ShapeGeometry(jibShape, 1);
  jib.rotateY(-Math.PI / 2);
  jib.translate(0.05, 1.3, 0.55);
  const geo = merge([paint(hull, 0xf8f4ff), paint(deck, 0xc89a6a), paint(mast, 0xe8e0d8), paint(sail, 0xfff6ea), paint(jib, 0xffe0c8)], true);
  const mat = toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide, rim: 0.4, rimColor: 0xffc080 });
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  im.frustumCulled = false;
  im.castShadow = false;
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const m4 = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let t = 0;
  const place = () => {
    list.forEach((b, i) => {
      const ph = i * 1.7;
      const drift = t * (b.speed ?? 0.6);
      v.set(b.x + Math.sin(b.ry) * drift, (opts.level ?? 0) + Math.sin(t * 1.1 + ph) * 0.12, b.z + Math.cos(b.ry) * drift);
      e.set(Math.sin(t * 0.9 + ph) * 0.05, b.ry, Math.sin(t * 0.7 + ph) * 0.08 + 0.1);
      q.setFromEuler(e);
      sc.setScalar(b.s ?? 1.6);
      m4.compose(v, q, sc);
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
  };
  place();
  const update = (dt) => {
    t += dt;
    place();
  };
  return { mesh: im, update };
}

// ------------------------------------------------------------------ чайки
export function makeSeagulls(flocks, opts = {}) {
  // тело + два изогнутых крыла; взмах — масштаб по Y
  const pts = [];
  const wing = (s) => {
    const shoulderF = new THREE.Vector3(0, 0, 0.35);
    const shoulderB = new THREE.Vector3(0, 0, -0.35);
    const elbow = new THREE.Vector3(s * 1.1, 0.45, 0.1);
    const elbowB = new THREE.Vector3(s * 1.1, 0.45, -0.45);
    const tip = new THREE.Vector3(s * 2.3, 0.1, -0.55);
    const tris = [shoulderF, elbow, shoulderB, shoulderB, elbow, elbowB, elbow, tip, elbowB];
    if (s < 0) for (let i = 0; i < tris.length; i += 3) [tris[i + 1], tris[i + 2]] = [tris[i + 2], tris[i + 1]];
    pts.push(...tris);
  };
  wing(1);
  wing(-1);
  const wg = new THREE.BufferGeometry().setFromPoints(pts);
  wg.computeVertexNormals();
  const body = new THREE.OctahedronGeometry(0.3, 0);
  body.scale(0.7, 0.6, 2.0);
  const geo = merge([paint(wg, 0xffffff), paint(body, 0xf4f0ec)], true);
  const mat = toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide, ramp: 'soft' });
  const birds = [];
  const rnd = mulberry32(opts.seed ?? 71);
  for (const f of flocks) {
    for (let i = 0; i < f.count; i++) {
      birds.push({
        cx: f.x + (rnd() - 0.5) * 20,
        cy: f.y + (rnd() - 0.5) * 8,
        cz: f.z + (rnd() - 0.5) * 20,
        r: f.r * (0.6 + rnd() * 0.6),
        w: (0.25 + rnd() * 0.2) * (rnd() < 0.5 ? -1 : 1),
        ph: rnd() * Math.PI * 2,
        fl: 6 + rnd() * 3,
        s: 0.8 + rnd() * 0.4,
      });
    }
  }
  const im = new THREE.InstancedMesh(geo, mat, birds.length);
  im.frustumCulled = false;
  im.castShadow = false;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let t = 0;
  const place = () => {
    birds.forEach((b, i) => {
      const a = b.ph + t * b.w;
      v.set(b.cx + Math.cos(a) * b.r, b.cy + Math.sin(a * 2.3 + b.ph) * 2, b.cz + Math.sin(a) * b.r);
      // направление полёта — касательная к окружности
      const heading = Math.atan2(-Math.sin(a) * Math.sign(b.w), Math.cos(a) * Math.sign(b.w));
      e.set(0, heading, -Math.sign(b.w) * 0.35);
      q.setFromEuler(e);
      // взмахи с периодами планирования
      const glide = Math.sin(t * 0.5 + b.ph) > 0.3 ? 0.25 : 1;
      const flap = 0.35 + Math.sin(t * b.fl + b.ph) * 0.75 * glide;
      sc.set(b.s, b.s * flap, b.s);
      m4.compose(v, q, sc);
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
  };
  place();
  return {
    mesh: im,
    update: (dt) => {
      t += dt;
      place();
    },
  };
}

// ------------------------------------------------------------------ небесные фонарики
const lanternVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform vec3 uCam;
  uniform vec3 uBox;
  uniform float uRise;
  uniform float uBaseY;
  uniform float uSize;
  varying float vAlpha;
  varying float vV;
  #include <fog_pars_vertex>
  void main() {
    vV = uv.y;
    float t = uTime * (0.7 + aSeed.w * 0.6);
    vec2 base = aSeed.xz * uBox.xz;
    vec2 sway = vec2(sin(t * 0.35 + aSeed.w * 30.0), cos(t * 0.3 + aSeed.x * 20.0)) * 2.5 + vec2(t * 0.5, t * 0.2);
    vec2 p = mod(base + sway - uCam.xz, uBox.xz) - uBox.xz * 0.5;
    float hy = mod(aSeed.y * uBox.y + t * uRise, uBox.y);
    vec3 wp = vec3(uCam.x + p.x, uBaseY + hy, uCam.z + p.y);
    float s = uSize * (0.75 + aSeed.w * 0.5);
    vec3 local = position * s;
    // лёгкое покачивание
    float rz = sin(t * 1.3 + aSeed.x * 40.0) * 0.12;
    local.xy = mat2(cos(rz), sin(rz), -sin(rz), cos(rz)) * local.xy;
    vec4 mvPosition = viewMatrix * vec4(wp + local, 1.0);
    float edge = max(abs(p.x), abs(p.y)) / (uBox.x * 0.5);
    vAlpha = (1.0 - smoothstep(0.8, 1.0, edge)) * smoothstep(0.0, 0.08, hy / uBox.y) * (1.0 - smoothstep(0.75, 1.0, hy / uBox.y));
    vAlpha *= smoothstep(7.0, 16.0, length(wp - uCam));
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const lanternFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uColor2;
  uniform float uGlow;
  varying float vAlpha;
  varying float vV;
  #include <fog_pars_fragment>
  void main() {
    vec3 c = mix(uColor, uColor2, smoothstep(0.0, 1.0, vV)) * uGlow;
    gl_FragColor = vec4(c, vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Светящиеся фонарики, медленно поднимающиеся в небо (коробка вокруг камеры, высота — мировая). */
export function createSkyLanterns(opts = {}) {
  const count = opts.count ?? 200;
  const base = new THREE.CylinderGeometry(0.5, 0.38, 0.95, 6, 1, true);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const seeds = new Float32Array(count * 4);
  const rnd = mulberry32(opts.seed ?? 5);
  for (let i = 0; i < count * 4; i++) seeds[i] = rnd();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = count;
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(...(opts.box ?? [600, 180, 600])) },
      uRise: { value: opts.rise ?? 1.2 },
      uBaseY: { value: opts.baseY ?? 6 },
      uSize: { value: opts.size ?? 1.6 },
      uColor: { value: new THREE.Color(opts.color ?? 0xffc860) },
      uColor2: { value: new THREE.Color(opts.color2 ?? 0xff6a2a) },
      uGlow: { value: opts.glow ?? 2.4 },
    },
  ]);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: lanternVert,
    fragmentShader: lanternFrag,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = 'sky-lanterns';
  mesh.userData.update = (dt, camera) => {
    uniforms.uTime.value += dt;
    uniforms.uCam.value.copy(camera.position);
  };
  mesh.userData.setCount = (n) => (geo.instanceCount = Math.min(count, n));
  return mesh;
}

// ------------------------------------------------------------------ острова на горизонте (силуэты)
export function makeIslands(list, opts = {}) {
  const geos = [];
  const rnd = mulberry32(opts.seed ?? 4);
  const cLow = new THREE.Color(opts.low ?? 0x8a5a8e);
  const cHigh = new THREE.Color(opts.high ?? 0xb07aa0);
  for (const is of list) {
    const g = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const bump = 1 + Math.sin(a * 3 + rnd()) * 0.08;
      pos.setY(i, Math.pow(Math.max(0, pos.getY(i)), 0.8) * bump);
    }
    g.scale(is.w, is.h, is.d ?? is.w * 0.6);
    g.rotateY(is.ry ?? 0);
    g.translate(is.x, opts.baseY ?? -1, is.z);
    geos.push(vgrad(g, cLow, cHigh, 0, is.h));
  }
  const m = new THREE.Mesh(merge(geos, true), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  m.name = 'islands';
  m.frustumCulled = false;
  return m;
}

export { trs };
