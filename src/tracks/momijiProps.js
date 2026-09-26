// Декорации "Кленового Перевала": клёны-момидзи, золотые гинкго, сусуки, море облаков с вершинами-островами,
// шевроны и выпуклые зеркала на шпильках, дорожные знаки, чайный домик на вершине и святилище над каруселью.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, outlineMaterial, outlineGeometry, normalizeGeometry } from '../world/toon.js';
import { taperedTube, rod } from '../world/geom.js';
import { mulberry32 } from '../world/sky.js';
import { instanced, trs } from '../world/props.js';

const OUT = 0x2a1418;
const JP_FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", "IPAGothic", "Noto Sans JP", sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

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

function box(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function addMesh(group, geo, mat, ol = 0, olColor = OUT) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  if (ol) m.add(new THREE.Mesh(outlineGeometry(geo), outlineMaterial(olColor, ol)));
  return m;
}

// ------------------------------------------------------------------ клён-момидзи
export const MAPLE_TINTS = [0xff3b2a, 0xe8203c, 0xff5424, 0xff7420, 0xff9a26, 0xffbe34];

/**
 * Японский клён: короткий ствол, раскидистые ветви и крона плоскими ярусами-"облачками".
 * lite — для дальних деревьев: по одному облачку на ветку и простые ветви (втрое меньше треугольников).
 */
export function mapleTreeParts(variant = 0, { lite = false } = {}) {
  const rnd = mulberry32(310 + variant * 23);
  const H = 3.2 + variant * 0.45; // высота развилки
  const lean = (rnd() - 0.5) * 0.8;
  const fork = new THREE.Vector3(lean * 0.5, H, (rnd() - 0.5) * 0.4);
  const trunk = [taperedTube([new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(lean * 0.2, H * 0.5, 0), fork], (t) => 0.36 * (1 - t * 0.45), lite ? 5 : 7, lite ? 3 : 6)];
  const canopy = [];
  const nb = 4 + (variant % 2);
  const a0 = rnd() * 6.28;
  for (let b = 0; b < nb; b++) {
    const a = a0 + (b / nb) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
    const reach = 2.3 + rnd() * 1.3;
    const rise = 1.1 + rnd() * 1.5;
    const mid = fork.clone().add(new THREE.Vector3(Math.cos(a) * reach * 0.45, rise * 0.62, Math.sin(a) * reach * 0.45));
    const end = fork.clone().add(new THREE.Vector3(Math.cos(a) * reach, rise, Math.sin(a) * reach));
    if (!lite || b < 3) trunk.push(taperedTube([fork.clone(), mid, end], (t) => 0.19 * (1 - t * 0.7), lite ? 4 : 5, lite ? 2 : 5));
    // ярус кроны на конце ветки
    for (let i = 0; i < 2; i++) {
      const r = 1.45 + rnd() * 0.75;
      const ox = (rnd() - 0.5) * 1.5;
      const oz = (rnd() - 0.5) * 1.5;
      if (lite && i) continue;
      const g = new THREE.IcosahedronGeometry(lite ? r * 1.2 : r, 1);
      g.scale(1.25, lite ? 0.75 : 0.62, 1.25);
      g.translate(end.x + ox, end.y + 0.25 + i * 0.75 + (lite ? 0.35 : 0), end.z + oz);
      canopy.push(g);
    }
  }
  // макушка
  for (let i = 0; i < 2; i++) {
    const r = 1.7 + rnd() * 0.7;
    const ox = (rnd() - 0.5) * 1.3;
    const oz = (rnd() - 0.5) * 1.3;
    if (lite && i) continue;
    const g = new THREE.IcosahedronGeometry(lite ? r * 1.25 : r, 1);
    g.scale(1.2, 0.72, 1.2);
    g.translate(fork.x + ox, fork.y + 2.5 + i * 0.9 + (lite ? 0.4 : 0), fork.z + oz);
    canopy.push(g);
  }
  const can = merge(
    canopy.map((g) => vgrad(g, 0x86504a, 0xfff4ea, H - 0.4, H + 4.4)),
    true
  );
  // редкая выборка точек кроны — проверять, не нависает ли дерево над дорогой
  const low = [];
  const p = can.getAttribute('position');
  for (let i = 0; i < p.count; i += 17) low.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
  return { trunk: merge(trunk), canopy: can, low };
}

/**
 * points: [{x,y,z, s?, color?}] — цвет листвы на инстанс (иначе из палитры).
 * opts.keep(worldPoints) — фильтр по точкам кроны в мире (например, крона не должна нависать над дорогой).
 */
export function makeMapleForest(points, opts = {}) {
  const group = new THREE.Group();
  group.name = 'maples';
  const variants = [0, 1, 2].map((v) => mapleTreeParts(v, { lite: !!opts.lite }));
  const trunkMat = toon(opts.trunk ?? 0x5a3634);
  const canopyMat = toon(0xffffff, { vertexColors: true, ramp: 'soft', rim: 0.4, rimColor: 0xffe2b0 });
  const rnd = mulberry32(opts.seed ?? 5);
  const palette = (opts.palette ?? MAPLE_TINTS).map((c) => new THREE.Color(c));
  const buckets = [[], [], []];
  const tints = [[], [], []];
  const world = variants[0].low.map(() => new THREE.Vector3());
  for (const p of points) {
    const v = Math.floor(rnd() * 3);
    const m = trs(p.x, p.y, p.z, rnd() * 6.28, p.s ?? 0.85 + rnd() * 0.4);
    const c = p.color !== undefined ? new THREE.Color(p.color) : palette[Math.floor(rnd() * palette.length)].clone();
    c.offsetHSL((rnd() - 0.5) * 0.02, 0, (rnd() - 0.5) * 0.06);
    if (opts.keep) {
      const low = variants[v].low;
      world.length = low.length;
      for (let i = 0; i < low.length; i++) (world[i] || (world[i] = new THREE.Vector3())).copy(low[i]).applyMatrix4(m);
      if (!opts.keep(world)) continue;
    }
    buckets[v].push(m);
    tints[v].push(c);
  }
  variants.forEach((v, i) => {
    group.add(
      instanced(
        [
          { geo: v.trunk, mat: trunkMat },
          { geo: v.canopy, mat: canopyMat, tint: true, outline: opts.outline ? 0.07 : 0, outlineColor: 0x5a1624 },
        ],
        buckets[i],
        // дальние деревья тень не отбрасывают: она всё равно за пределами коробки теней
        { colors: tints[i], name: 'maple-v' + i, chunk: opts.chunk ?? 220, castShadow: opts.shadow ?? true }
      )
    );
  });
  return group;
}

// ------------------------------------------------------------------ гинкго
export const GINKGO_TINTS = [0xffd23a, 0xffc41e, 0xffe266, 0xf6b41c];

/** Гинкго: прямой ствол и крона-веретено из облачков, крупных внизу и мелких к макушке. */
export function ginkgoTreeParts(variant = 0) {
  const rnd = mulberry32(520 + variant * 41);
  const H = 8.5 + variant * 1.3;
  const trunk = [
    taperedTube([new THREE.Vector3(0, -0.4, 0), new THREE.Vector3((rnd() - 0.5) * 0.3, H * 0.5, 0), new THREE.Vector3(0, H, 0)], (t) => 0.4 * (1 - t * 0.72), 7, 6),
  ];
  const canopy = [];
  const tiers = 4;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y = H * 0.4 + t * H * 0.58;
    const ring = k === tiers - 1 ? 1 : 3;
    const rad = (1 - t * 0.8) * 1.5;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + k * 0.9 + rnd() * 0.5;
      const r = (1.95 - t * 0.95) * (0.9 + rnd() * 0.22);
      const g = new THREE.IcosahedronGeometry(r, 1);
      g.scale(1, 1.18, 1);
      g.translate(Math.cos(a) * rad, y, Math.sin(a) * rad);
      canopy.push(g);
    }
  }
  return {
    trunk: merge(trunk),
    canopy: merge(
      canopy.map((g) => vgrad(g, 0x9c7a44, 0xfff8d4, H * 0.3, H + 1.6)),
      true
    ),
  };
}

export function makeGinkgo(points, opts = {}) {
  const group = new THREE.Group();
  group.name = 'ginkgo';
  const variants = [0, 1].map((v) => ginkgoTreeParts(v));
  const trunkMat = toon(0x6a4a3a);
  const canopyMat = toon(0xffffff, { vertexColors: true, ramp: 'soft', rim: 0.4, rimColor: 0xfff0c0 });
  const rnd = mulberry32(opts.seed ?? 8);
  const palette = GINKGO_TINTS.map((c) => new THREE.Color(c));
  const buckets = [[], []];
  const tints = [[], []];
  for (const p of points) {
    const v = Math.floor(rnd() * 2);
    buckets[v].push(trs(p.x, p.y, p.z, rnd() * 6.28, p.s ?? 0.85 + rnd() * 0.35));
    tints[v].push(palette[Math.floor(rnd() * palette.length)].clone());
  }
  variants.forEach((v, i) => {
    group.add(
      instanced(
        [
          { geo: v.trunk, mat: trunkMat },
          { geo: v.canopy, mat: canopyMat, tint: true, outline: opts.outline ? 0.07 : 0, outlineColor: 0x6a4a14 },
        ],
        buckets[i],
        { colors: tints[i], name: 'ginkgo-v' + i, chunk: opts.chunk ?? 260 }
      )
    );
  });
  return group;
}

// ------------------------------------------------------------------ сусуки (мискантус)
/** Кустик сусуки: узкие листья и серебристые метёлки, клонящиеся по ветру. */
export function makeSusuki(points, opts = {}) {
  const rnd = mulberry32(opts.seed ?? 61);
  const parts = [];
  for (let i = 0; i < 8; i++) {
    const h = 1.0 + rnd() * 0.7;
    const b = new THREE.ConeGeometry(0.07, h, 3, 1, true);
    b.translate(0, h / 2, 0);
    b.rotateZ(0.2 + rnd() * 0.4);
    b.rotateY(rnd() * 6.28);
    parts.push(vgrad(b, 0x5e6e36, 0xd8c47a, 0, 1.5));
  }
  for (let i = 0; i < 5; i++) {
    const h = 1.5 + rnd() * 0.5;
    const stem = new THREE.CylinderGeometry(0.014, 0.02, h, 3);
    stem.translate(0, h / 2, 0);
    const plume = new THREE.SphereGeometry(1, 4, 3);
    plume.scale(0.1, 0.4, 0.1);
    plume.rotateZ(-0.5);
    plume.translate(0.17, h + 0.24, 0);
    const g = mergeGeometries([normalizeGeometry(paint(stem, 0xb8a868), { color: true }), normalizeGeometry(vgrad(plume, 0xe0ccc0, 0xfffaf2, h, h + 0.6), { color: true })]);
    g.rotateZ(0.08 + rnd() * 0.25);
    g.rotateY(rnd() * 6.28);
    parts.push(g);
  }
  const geo = merge(parts, true);
  const mats = [];
  const cols = [];
  for (const p of points) {
    mats.push(trs(p.x, p.y - 0.05, p.z, rnd() * 6.28, p.s ?? 0.8 + rnd() * 0.5));
    cols.push(new THREE.Color().setHSL(0.1 + rnd() * 0.04, 0.3, 0.85 + rnd() * 0.15));
  }
  return instanced([{ geo, mat: toon(0xffffff, { vertexColors: true, ramp: 'soft', side: THREE.DoubleSide }), tint: true, shadow: false }], mats, {
    colors: cols,
    castShadow: false,
    name: 'susuki',
    chunk: opts.chunk ?? 170,
  });
}

// ------------------------------------------------------------------ море облаков
/**
 * Бесшовная карта "облачных куполов": R — высота (сумма октав "перевёрнутого" шума Ворлея — круглые клубы),
 * G/B — наклон по x/z (для освещения без лишних выборок в шейдере). Считается один раз при загрузке.
 */
function cloudTexture(size = 256, seed = 7) {
  const rnd = mulberry32(seed);
  const h = new Float32Array(size * size);
  for (const [cells, wgt, rad] of [
    [4, 0.62, 0.85],
    [9, 0.28, 0.8],
    [19, 0.1, 0.75],
  ]) {
    const pts = new Float32Array(cells * cells * 2);
    for (let i = 0; i < pts.length; i++) pts[i] = 0.15 + rnd() * 0.7;
    const cs = size / cells;
    const inv = 1 / (rad * rad);
    for (let y = 0; y < size; y++) {
      const fy = y / cs;
      const iy = Math.floor(fy);
      for (let x = 0; x < size; x++) {
        const fx = x / cs;
        const ix = Math.floor(fx);
        let best = 9;
        for (let oy = -1; oy <= 1; oy++) {
          const cy = (iy + oy + cells) % cells;
          for (let ox = -1; ox <= 1; ox++) {
            const cx = (ix + ox + cells) % cells;
            const k = (cy * cells + cx) * 2;
            const dx = ix + ox + pts[k] - fx;
            const dy = iy + oy + pts[k + 1] - fy;
            const d = dx * dx + dy * dy;
            if (d < best) best = d;
          }
        }
        h[y * size + x] += Math.sqrt(Math.max(0, 1 - best * inv)) * wgt;
      }
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const data = new Uint8Array(size * size * 4);
  const GS = 6; // масштаб наклона: 1 тексель высоты 1/GS … хватает для крутых краёв клубов
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const n = (h[i] - lo) / (hi - lo);
      const gx = (h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)]) / (2 * (hi - lo));
      const gz = (h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x]) / (2 * (hi - lo));
      data[i * 4] = Math.round(n * 255);
      data[i * 4 + 1] = Math.round(THREE.MathUtils.clamp(0.5 + gx * GS, 0, 1) * 255);
      data[i * 4 + 2] = Math.round(THREE.MathUtils.clamp(0.5 + gz * GS, 0, 1) * 255);
      data[i * 4 + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  // наклон в текселях → на единицу UV: × size / GS
  return { tex, gradScale: size / GS };
}

const seaVert = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uTime;
  uniform float uAmp;
  uniform vec2 uCenter;
  uniform float uTileA;
  varying vec3 vWorld;
  varying float vFade;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // у склонов клубы пониже, в сотнях метров — высокие (видны с дороги над отбойником), у горизонта — плоскость
    float dist = length(wp.xz - uCenter);
    float fade = mix(0.55, 1.0, smoothstep(250.0, 480.0, dist)) * (1.0 - smoothstep(1100.0, 1700.0, dist));
    vec2 uv = wp.xz / uTileA + vec2(uTime * 0.0016, uTime * 0.0007);
    float h = texture2D(uTex, uv).r;
    wp.y += (h - 0.45) * uAmp * fade;
    vFade = fade;
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const seaFrag = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uTime;
  uniform float uAmp;
  uniform float uTileA;
  uniform float uTileB;
  uniform float uGrad;
  uniform vec3 uSunDir;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform vec3 uDeep;
  uniform vec3 uGlow;
  uniform sampler2D uHeight;
  uniform vec2 uHOrigin;
  uniform float uHSize;
  uniform float uHasHeight;
  uniform float uFogScale;
  varying vec3 vWorld;
  varying float vFade;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = vWorld.xz;
    vec4 a = texture2D(uTex, p / uTileA + vec2(uTime * 0.0016, uTime * 0.0007));
    vec4 b = texture2D(uTex, p / uTileB + vec2(-uTime * 0.0029, uTime * 0.0018));
    float h = a.r * 0.7 + b.r * 0.3;
    // наклон поверхности в мировых единицах: крупные клубы (с учётом вытеснения) + мелкая рябь
    vec2 gA = (a.gb * 2.0 - 1.0) * uGrad / uTileA * uAmp * max(vFade, 0.35);
    vec2 gB = (b.gb * 2.0 - 1.0) * uGrad / uTileB * uAmp * 0.18;
    vec3 n = normalize(vec3(-(gA.x + gB.x), 1.0, -(gA.y + gB.y)));
    float ndl = dot(n, uSunDir);
    // мягкие 2 тона + светлые шапки на верхушках, лавандовые впадины между клубами
    vec3 col = mix(uShade, uLit, smoothstep(-0.12, 0.3, ndl));
    col = mix(uDeep, col, smoothstep(0.08, 0.5, h));
    col += uLit * smoothstep(0.6, 0.92, h) * smoothstep(0.0, 0.4, ndl) * 0.1;
    // золотая кайма клубов со стороны солнца (свет сквозь края)
    vec3 V = normalize(cameraPosition - vWorld);
    vec2 sh = normalize(uSunDir.xz + 1e-4);
    vec2 vh = V.xz / max(length(V.xz), 1e-4);
    float toSun = max(dot(-vh, sh), 0.0);
    float rim = 1.0 - clamp(dot(n, V), 0.0, 1.0);
    col += uGlow * (toSun * toSun * toSun) * (0.18 + 0.5 * rim * rim);
    // у склонов гор облака тают: сквозь край видно подножие
    float alpha = 1.0;
    if (uHasHeight > 0.5) {
      vec2 huv = (p - uHOrigin) / uHSize;
      if (huv.x > 0.0 && huv.y > 0.0 && huv.x < 1.0 && huv.y < 1.0) {
        float gap = vWorld.y - texture2D(uHeight, huv).r;
        alpha = smoothstep(-1.0, 12.0, gap + (h - 0.5) * 8.0);
        col = mix(uLit * 1.04, col, smoothstep(0.0, 22.0, gap));
      }
    }
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // свой (более прозрачный) туман: море облаков видно до самого горизонта
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fd = fogDensity * uFogScale * vFogDepth;
        float fogFactor = 1.0 - exp(-fd * fd);
      #else
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
    #endif
  }
`;

/**
 * Море облаков: огромная плоскость с клубами (вытеснение вершин по карте куполов + освещение по наклону),
 * тающая у склонов (карта высот рельефа) и в тумане у горизонта. Сетка сгущается к центру.
 */
export function makeCloudSea(opts = {}) {
  const size = opts.size ?? 9000;
  const seg = opts.segments ?? 170;
  const geo = new THREE.PlaneGeometry(2, 2, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  // шаг сетки ~12 м в центре и сотни метров у края: x = t·(0.2 + 0.8·t³)
  const warp = (u) => {
    const t = Math.abs(u);
    return Math.sign(u) * (size / 2) * t * (0.2 + 0.8 * t * t * t);
  };
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, warp(pos.getX(i)), 0, warp(pos.getZ(i)));
  geo.computeBoundingSphere();
  const { tex, gradScale } = cloudTexture(128, opts.seed ?? 7);
  const center = opts.center ?? new THREE.Vector3();
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTex: { value: null },
      uTime: { value: 0 },
      uAmp: { value: opts.amp ?? 26 },
      uCenter: { value: new THREE.Vector2(center.x, center.z) },
      uTileA: { value: opts.tileA ?? 640 },
      uTileB: { value: opts.tileB ?? 190 },
      uGrad: { value: gradScale },
      uSunDir: { value: (opts.sunDir ?? new THREE.Vector3(0.5, 0.4, -0.6)).clone().normalize() },
      uLit: { value: new THREE.Color(opts.lit ?? 0xfff8f0) },
      uShade: { value: new THREE.Color(opts.shade ?? 0xc8bce8) },
      uDeep: { value: new THREE.Color(opts.deep ?? 0xa496d6) },
      uGlow: { value: new THREE.Color(opts.glow ?? 0xffc98a) },
      uHeight: { value: null },
      uHOrigin: { value: new THREE.Vector2() },
      uHSize: { value: 1 },
      uHasHeight: { value: 0 },
      uFogScale: { value: opts.fogScale ?? 0.55 },
    },
  ]);
  uniforms.uTex.value = tex; // после merge: UniformsUtils.merge клонирует текстуры
  if (opts.heightMap) {
    uniforms.uHeight.value = opts.heightMap.tex;
    uniforms.uHOrigin.value.copy(opts.heightMap.origin);
    uniforms.uHSize.value = opts.heightMap.size;
    uniforms.uHasHeight.value = 1;
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: seaVert,
    fragmentShader: seaFrag,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(center.x, opts.level ?? 0, center.z);
  mesh.frustumCulled = false;
  mesh.name = 'cloud-sea';
  mesh.userData.noShadow = true;
  mesh.userData.update = (dt) => {
    uniforms.uTime.value += dt;
  };
  return mesh;
}

/** Отдельные клубы у подножия склонов: сплюснутые шары, один меш. list: [{x,y,z,s}] */
export function makeCloudPuffs(list, opts = {}) {
  const rnd = mulberry32(opts.seed ?? 12);
  const geos = [];
  for (const c of list) {
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const r = c.s * (0.55 + rnd() * 0.45);
      const g = new THREE.IcosahedronGeometry(r, 1);
      g.scale(1.35, 0.62, 1.1);
      g.rotateY(rnd() * 6.28);
      g.translate(c.x + (rnd() - 0.5) * c.s * 1.8, c.y + (rnd() - 0.2) * c.s * 0.35, c.z + (rnd() - 0.5) * c.s * 1.8);
      g.deleteAttribute('uv');
      geos.push(g);
    }
  }
  if (!geos.length) return new THREE.Group();
  const mat = toon(opts.color ?? 0xfffaf4, { ramp: 'soft', emissive: new THREE.Color(opts.shade ?? 0xa89ad0).multiplyScalar(0.3) });
  const m = new THREE.Mesh(mergeGeometries(geos), mat);
  m.name = 'cloud-puffs';
  m.userData.noShadow = true;
  return m;
}

// ------------------------------------------------------------------ вершины над облаками
/**
 * Далёкие горы, торчащие из моря облаков: неровные конусы с гребнями, два тона освещения,
 * снежные шапки на самых высоких и дымка к подножию. list: [{x,z,r,h, snow?, haze (0..1)}]
 */
export function makePeaks(list, opts = {}) {
  const sun = (opts.sunDir ?? new THREE.Vector3(0.6, 0.4, -0.6)).clone().normalize();
  const baseY = opts.baseY ?? 0;
  const geos = [];
  const rnd = mulberry32(opts.seed ?? 21);
  const cLit = new THREE.Color();
  const cShade = new THREE.Color();
  const c = new THREE.Color();
  const haze = new THREE.Color(opts.haze ?? 0xf0dcd4);
  const mist = new THREE.Color(opts.mist ?? 0xfff4ee);
  const snow = new THREE.Color(0xfbf8ff);
  for (const pk of list) {
    const segs = 40;
    const rows = 12;
    // главная вершина и 2–3 плеча: высота — максимум из "конусов" (неровный силуэт с седловинами)
    const subs = [{ dx: 0, dz: 0, h: 1, r: 1 }];
    for (let s = 0; s < 3; s++) {
      const a = rnd() * Math.PI * 2;
      const d = 0.25 + rnd() * 0.35;
      subs.push({ dx: Math.cos(a) * d, dz: Math.sin(a) * d, h: 0.4 + rnd() * 0.38, r: 0.45 + rnd() * 0.3 });
    }
    const phase = Array.from({ length: 3 }, () => rnd() * 6.28);
    const hf = (u, v, a) => {
      let h = 0;
      for (const s of subs) {
        const d = Math.hypot(u - s.dx, v - s.dz) / s.r;
        h = Math.max(h, s.h * Math.pow(Math.max(0, 1 - d), 1.2));
      }
      // гребни и отроги
      const q = Math.hypot(u, v);
      return h + (0.05 * Math.sin(a * 5 + phase[0]) + 0.03 * Math.sin(a * 11 + phase[1])) * q * (1 - q) * 2;
    };
    const pos = [];
    const idx = [];
    for (let j = 0; j <= rows; j++) {
      const q = (j / rows) * 1.2;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2 + (j % 2) * (Math.PI / segs);
        const u = Math.cos(a) * q;
        const v = Math.sin(a) * q;
        const y = j === rows ? 0 : Math.max(0, hf(u, v, a + phase[2])) * pk.h;
        pos.push(pk.x + u * pk.r, baseY + y, pk.z + v * pk.r);
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * (segs + 1) + i;
        const b = a + segs + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1); // кольца идут от вершины наружу — грани смотрят вверх
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const ng = g.toNonIndexed();
    ng.computeVertexNormals(); // плоские грани — рубленые скалы
    const p = ng.getAttribute('position');
    const nrm = ng.getAttribute('normal');
    const cols = new Float32Array(p.count * 3);
    cLit.set(pk.lit ?? 0x9a8ad8);
    cShade.set(pk.shade ?? 0x6a64b4);
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) - baseY) / pk.h;
      const l = nrm.getX(i) * sun.x + nrm.getY(i) * sun.y + nrm.getZ(i) * sun.z;
      c.copy(l > 0.08 ? cLit : cShade);
      if (pk.snow && t > pk.snow + Math.sin(p.getX(i) * 0.05) * 0.04) c.lerp(snow, l > 0.08 ? 0.9 : 0.6);
      c.lerp(haze, pk.haze ?? 0.3);
      c.lerp(mist, Math.pow(1 - THREE.MathUtils.clamp(t / 0.35, 0, 1), 2) * 0.85); // подножие тонет в облаках
      c.toArray(cols, i * 3);
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geos.push(ng);
  }
  const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  m.name = 'peaks';
  m.frustumCulled = false;
  m.userData.noShadow = true;
  return m;
}

// ------------------------------------------------------------------ шевроны на шпильках
function chevronTexture() {
  const c = canvas(128, 96);
  const g = c.getContext('2d');
  g.fillStyle = '#1c1620';
  g.fillRect(0, 0, 128, 96);
  g.fillStyle = '#ffd21e';
  g.fillRect(5, 5, 118, 86);
  g.fillStyle = '#1c1620';
  g.beginPath();
  // ">" — стрелка в сторону поворота
  g.moveTo(34, 14);
  g.lineTo(70, 14);
  g.lineTo(100, 48);
  g.lineTo(70, 82);
  g.lineTo(34, 82);
  g.lineTo(64, 48);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Щиты-стрелки по внешней стороне крутых поворотов. Щит целиком за стеной (≥ hw + wall + 1.5 от оси):
 * камера и машинки не проезжают сквозь него. heightAt — высота земли под стойкой.
 */
export function makeChevronBoards(track, heightAt, { minCurv = 0.03, step = 8, from = 0, to = 1 } = {}) {
  const mats = [];
  const posts = [];
  const fr = {};
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  for (let s = from * track.length; s < to * track.length; s += step) {
    track.frameAtProgress(s, fr);
    if (Math.abs(fr.curv) < minCurv) continue;
    const side = Math.sign(fr.curv); // внешняя сторона поворота
    const lat = side * (fr.hw + fr.wall + 2.7);
    const x = fr.pos.x + fr.right.x * lat;
    const z = fr.pos.z + fr.right.z * lat;
    const y = Math.max(heightAt(x, z), fr.pos.y - 1);
    const ry = Math.atan2(-fr.tan.x, -fr.tan.z);
    q.setFromAxisAngle(up, ry);
    // стрелка указывает внутрь поворота: для левых — зеркально
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + 1.75, z), q, new THREE.Vector3(side < 0 ? 1.5 : -1.5, 1.15, 1)));
    posts.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
  }
  const group = new THREE.Group();
  group.name = 'chevrons';
  if (!mats.length) return group;
  const board = new THREE.PlaneGeometry(1, 1);
  const bm = new THREE.MeshBasicMaterial({ map: chevronTexture(), color: new THREE.Color(1.08, 1.08, 1.08), side: THREE.DoubleSide });
  group.add(instanced([{ geo: normalizeGeometry(board), mat: bm, shadow: false }], mats, { name: 'chevron-boards', chunk: 0 }));
  const back = box(1.06, 1.08, 0.06, 0, 0, -0.045);
  group.add(instanced([{ geo: normalizeGeometry(back), mat: toon(0x3a3440), shadow: false }], mats, { name: 'chevron-backs', chunk: 0 }));
  const post = new THREE.CylinderGeometry(0.06, 0.07, 1.3, 5);
  post.translate(0, 0.62, -0.1);
  group.add(instanced([{ geo: normalizeGeometry(post), mat: toon(0xd8dce4), shadow: false }], posts, { name: 'chevron-posts', chunk: 0 }));
  return group;
}

// ------------------------------------------------------------------ выпуклые зеркала на поворотах
/** Оранжевая стойка с круглым зеркалом (カーブミラー). points: [{x,y,z,ry}] — зеркало смотрит по ry. */
export function makeCurveMirrors(points, opts = {}) {
  const pole = new THREE.CylinderGeometry(0.075, 0.09, 3.3, 6);
  pole.translate(0, 1.65, 0);
  const arm = rod([0, 3.2, 0], [0, 3.35, 0.35], 0.05, 0.05, 5);
  const rim = new THREE.TorusGeometry(0.48, 0.07, 6, 18);
  rim.translate(0, 3.45, 0.42);
  const hood = new THREE.CylinderGeometry(0.5, 0.5, 0.14, 18, 1, true, -Math.PI / 2, Math.PI);
  hood.rotateX(Math.PI / 2);
  hood.translate(0, 3.49, 0.36);
  const face = new THREE.CircleGeometry(0.45, 18);
  face.translate(0, 3.45, 0.44);
  const mats = points.map((p) => trs(p.x, p.y, p.z, p.ry ?? 0, 1));
  return instanced(
    [
      { geo: merge([pole, arm, rim, hood]), mat: toon(opts.color ?? 0xff6a1a, { rim: 0.3 }), outline: 0.03, shadow: false },
      { geo: normalizeGeometry(face), mat: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8ecff).multiplyScalar(1.15) }), shadow: false },
    ],
    mats,
    { name: 'curve-mirrors', chunk: 0 }
  );
}

// ------------------------------------------------------------------ дорожные знаки
const SIGN_TILES = 8;

/** Атлас знаков 8×1: 0 — "шпилька", 1..4 — таблички поворотов い/ろ/は/に, 5 — указатель перевала, 6 — "30", 7 — "камнепад". */
function signAtlas() {
  const T = 128;
  const c = canvas(T * SIGN_TILES, T);
  const g = c.getContext('2d');
  const diamond = (x0, draw) => {
    g.save();
    g.translate(x0 + T / 2, T / 2);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#1c1620';
    g.fillRect(-44, -44, 88, 88);
    g.fillStyle = '#ffd21e';
    g.fillRect(-39, -39, 78, 78);
    g.restore();
    g.save();
    g.translate(x0 + T / 2, T / 2);
    draw();
    g.restore();
  };
  g.clearRect(0, 0, c.width, c.height);
  // 0: крутой поворот-шпилька
  diamond(0, () => {
    g.strokeStyle = '#1c1620';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-16, 30);
    g.lineTo(-16, -6);
    g.arc(2, -6, 18, Math.PI, 0);
    g.lineTo(20, 16);
    g.stroke();
    g.fillStyle = '#1c1620';
    g.beginPath();
    g.moveTo(20, 34);
    g.lineTo(8, 14);
    g.lineTo(32, 14);
    g.closePath();
    g.fill();
  });
  // 1..4: таблички шпилек, как на Ироха-дзака
  ['い', 'ろ', 'は', 'に'].forEach((ch, k) => {
    const x0 = (k + 1) * T;
    g.fillStyle = '#f4f4f8';
    g.fillRect(x0 + 8, 8, T - 16, T - 16);
    g.fillStyle = '#1f5fb8';
    g.fillRect(x0 + 13, 13, T - 26, T - 26);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x0 + T / 2, 56, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1f5fb8';
    g.font = `900 40px ${JP_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, x0 + T / 2, 58);
    g.fillStyle = '#ffffff';
    g.font = `800 17px ${JP_FONT}`;
    g.fillText(`${k + 1} / 4`, x0 + T / 2, 102);
  });
  // 5: деревянный указатель перевала
  {
    const x0 = 5 * T;
    g.fillStyle = '#5a3424';
    g.fillRect(x0 + 6, 16, T - 12, T - 32);
    g.fillStyle = '#8a5638';
    g.fillRect(x0 + 11, 21, T - 22, T - 42);
    g.fillStyle = '#fff4e0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 30px ${JP_FONT}`;
    g.fillText('紅葉峠', x0 + T / 2, 52);
    g.font = `800 15px ${JP_FONT}`;
    g.fillText('標高 1280 m', x0 + T / 2, 84);
  }
  // 6: ограничение скорости
  {
    const x0 = 6 * T;
    g.fillStyle = '#e02a2a';
    g.beginPath();
    g.arc(x0 + T / 2, T / 2, 56, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x0 + T / 2, T / 2, 42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1f4fa8';
    g.font = `900 46px ${JP_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('30', x0 + T / 2, T / 2 + 2);
  }
  // 7: камнепад
  diamond(7 * T, () => {
    g.fillStyle = '#1c1620';
    g.beginPath();
    g.moveTo(-30, 30);
    g.lineTo(30, 30);
    g.lineTo(30, -26);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffd21e';
    for (const [x, y, r] of [
      [-2, 4, 7],
      [10, -8, 5],
      [-12, 16, 5],
    ]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Знаки на стойках: щиты из атласа — одним мешем (UV тайла запекаются в геометрию), стойки — другим.
 * list: [{x,y,z, ry (куда смотрит лицо), tile, w, h, post (высота низа щита)}]
 */
export function makeRoadSigns(list) {
  const faces = [];
  const backs = [];
  const posts = [];
  for (const s of list) {
    const w = s.w ?? 1.3;
    const h = s.h ?? 1.3;
    const bottom = s.post ?? 1.6;
    const face = new THREE.PlaneGeometry(w, h);
    const uv = face.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, (s.tile + uv.getX(i)) / SIGN_TILES);
    face.translate(0, bottom + h / 2, 0.05);
    face.rotateY(s.ry);
    face.translate(s.x, s.y, s.z);
    faces.push(face);
    const b = box(w * 0.98, h * 0.98, 0.05, 0, bottom + h / 2, 0);
    b.rotateY(s.ry);
    b.translate(s.x, s.y, s.z);
    backs.push(b);
    const n = s.wide ? [-w * 0.35, w * 0.35] : [0];
    for (const off of n) {
      const p = new THREE.CylinderGeometry(0.055, 0.065, bottom + h * 0.8, 6);
      p.translate(off, (bottom + h * 0.8) / 2, -0.06);
      p.rotateY(s.ry);
      p.translate(s.x, s.y, s.z);
      posts.push(p);
    }
  }
  const group = new THREE.Group();
  group.name = 'road-signs';
  if (!list.length) return group;
  const fm = new THREE.Mesh(merge(faces), new THREE.MeshBasicMaterial({ map: signAtlas(), transparent: true, alphaTest: 0.5, side: THREE.FrontSide }));
  const bm = new THREE.Mesh(merge(backs), toon(0x9aa0aa));
  const pm = new THREE.Mesh(merge(posts), toon(0xc8ccd4));
  group.add(fm, bm, pm);
  return group;
}

// ------------------------------------------------------------------ ручей и водопад
const streamVert = /* glsl */ `
  attribute float aFoam;
  varying vec2 vUv;
  varying float vFoam;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vFoam = aFoam;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const streamFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uLight;
  uniform vec3 uFoam;
  varying vec2 vUv;
  varying float vFoam;
  #include <fog_pars_fragment>
  float h12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vn(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), u.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    // струи бегут вдоль ленты (v — метры по течению), на перекатах и в падении — быстрее и белее
    float flow = vUv.y * 0.4 - uTime * (1.1 + vFoam * 2.2);
    float n = vn(vec2(vUv.x * 6.0, flow * 2.5));
    float streak = smoothstep(0.52, 0.8, n);
    float bank = smoothstep(0.3, 0.48, abs(vUv.x - 0.5));
    vec3 col = mix(uDeep, uLight, 0.3 + 0.45 * n);
    col = mix(col, uFoam, clamp(streak * (0.3 + vFoam) + bank * 0.55 + vFoam * 0.5, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * Лента воды вдоль ручья: pts — [{x, y, z, w (ширина), foam (0..1)}] по течению. Один меш, свой шейдер с туманом.
 */
export function makeStream(pts, opts = {}) {
  const pos = [];
  const uv = [];
  const foam = [];
  const idx = [];
  let v = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    if (i) v += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y, p.z - pts[i - 1].z);
    const hw = p.w / 2;
    pos.push(p.x - dz * hw, p.y, p.z + dx * hw, p.x + dz * hw, p.y, p.z - dx * hw);
    uv.push(0, v, 1, v);
    foam.push(p.foam, p.foam);
    if (i) {
      const k = (i - 1) * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(foam, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(opts.deep ?? 0x2f86c4) },
      uLight: { value: new THREE.Color(opts.light ?? 0x86e2f2) },
      uFoam: { value: new THREE.Color(opts.foam ?? 0xffffff) },
    },
  ]);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: streamVert, fragmentShader: streamFrag, side: THREE.DoubleSide, fog: true });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'stream';
  m.userData.noShadow = true;
  m.userData.update = (dt) => {
    uniforms.uTime.value += dt;
  };
  return m;
}

// ------------------------------------------------------------------ подпорные стенки из камня
function stoneTexture() {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#5e5664';
  g.fillRect(0, 0, S, S);
  const rnd = mulberry32(41);
  // кладка исигаки: ряды неровных камней со смещением
  let y = 0;
  while (y < S) {
    const h = 30 + rnd() * 22;
    let x = -rnd() * 40;
    while (x < S) {
      const w = 36 + rnd() * 44;
      const tone = 150 + rnd() * 50;
      g.fillStyle = `rgb(${tone + 8},${tone},${tone - 6})`;
      const r = 7;
      const x0 = x + 3;
      const y0 = y + 3;
      const w0 = w - 6;
      const h0 = Math.min(h, S - y) - 6;
      g.beginPath();
      g.moveTo(x0 + r, y0);
      g.arcTo(x0 + w0, y0, x0 + w0, y0 + h0, r);
      g.arcTo(x0 + w0, y0 + h0, x0, y0 + h0, r);
      g.arcTo(x0, y0 + h0, x0, y0, r);
      g.arcTo(x0, y0, x0 + w0, y0, r);
      g.fill();
      // светлая грань сверху — объём камня
      g.fillStyle = 'rgba(255,250,240,0.18)';
      g.fillRect(x0 + 4, y0 + 2, w0 - 8, 5);
      x += w;
    }
    y += h;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * Каменная облицовка крутых откосов у дороги (там, где склон поднимается выше minRise за несколько метров):
 * лента от кромки у полки (hw + wall + 1.5) до склона, лежит на рельефе — со стороны дороги видна кладка.
 */
export function makeRetainingWalls(track, heightAt, { minRise = 2.4, minRun = 8 } = {}) {
  const N = track.count;
  const pos = [];
  const uv = [];
  const idx = [];
  for (const s of [-1, 1]) {
    const ok = new Uint8Array(N);
    const data = [];
    for (let i = 0; i < N; i++) {
      const P = track.pos[i];
      const R = track.right[i];
      const c = track.hw[i] + track.wall[i];
      const l0 = s * (c + 1.5);
      const l1 = s * (c + 4.5);
      const x0 = P.x + R.x * l0;
      const z0 = P.z + R.z * l0;
      const x1 = P.x + R.x * l1;
      const z1 = P.z + R.z * l1;
      const road = P.y + R.y * l0;
      const y0 = Math.min(heightAt(x0, z0), road) - 0.25;
      const y1 = heightAt(x1, z1) + 0.3;
      data.push([x0, y0, z0, x1, y1, z1]);
      ok[i] = y1 - road > minRise ? 1 : 0;
    }
    // убрать короткие куски и залатать мелкие разрывы
    for (let i = 0; i < N; i++) if (!ok[i] && ok[(i - 1 + N) % N] && (ok[(i + 1) % N] || ok[(i + 2) % N])) ok[i] = 2;
    const runs = track.ranges((i) => ok[i] > 0);
    for (const [a, b] of runs) {
      if (b - a < minRun) continue;
      let u = 0;
      let prev = null;
      for (let k = a; k <= b; k++) {
        const d = data[k % N];
        if (prev) u += Math.hypot(d[0] - prev[0], d[2] - prev[2]) / 3;
        prev = d;
        const base = pos.length / 3;
        pos.push(d[0], d[1], d[2], d[3], d[4], d[5]);
        const hgt = Math.hypot(d[3] - d[0], d[4] - d[1], d[5] - d[2]) / 3;
        uv.push(u, 0, u, hgt);
        if (k > a) {
          const p0 = base - 2;
          // лицом к дороге
          if (s > 0) idx.push(p0, p0 + 1, base, base, p0 + 1, base + 1);
          else idx.push(p0, base, p0 + 1, base, base + 1, p0 + 1);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, toon(0xffffff, { map: stoneTexture(), ramp: 'terrain' }));
  m.name = 'stone-walls';
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ чайный домик на вершине
/** Чайный домик (тяя): деревянный павильон под черепицей, норэн, скамьи с красным сукном и зонт-нодатэгаса. */
export function makeTeaHouse(opts = {}) {
  const group = new THREE.Group();
  group.name = 'tea-house';
  const wood = [];
  const dark = [];
  const plaster = [];
  const roof = [];
  const red = [];
  const cloth = [];
  // помост и каркас
  wood.push(box(7.4, 0.5, 5.2, 0, 0.25, 0));
  for (const x of [-3.3, -1.1, 1.1, 3.3]) for (const z of [-2.2, 2.2]) dark.push(box(0.26, 3.2, 0.26, x, 2.1, z));
  plaster.push(box(6.6, 2.6, 0.18, 0, 1.8, -2.25));
  plaster.push(box(0.18, 2.6, 4.4, -3.3, 1.8, 0));
  plaster.push(box(0.18, 2.6, 4.4, 3.3, 1.8, 0));
  dark.push(box(7, 0.22, 0.3, 0, 3.55, 2.2));
  dark.push(box(7, 0.22, 0.3, 0, 3.55, -2.2));
  // двускатная крыша с напуском
  const slope = (sz) => {
    const g = box(8.6, 0.28, 3.5, 0, 0, 0);
    g.rotateX(sz * 0.42);
    g.translate(0, 4.35, sz * 1.55);
    return g;
  };
  roof.push(slope(1), slope(-1));
  roof.push(box(8.8, 0.35, 0.4, 0, 5.05, 0));
  // норэн — полотнища над входом
  for (let i = 0; i < 4; i++) cloth.push(box(1.35, 1.0, 0.04, -2.1 + i * 1.4, 3.0, 2.34));
  // скамьи с красным сукном
  for (const x of [-2.2, 2.2]) {
    wood.push(box(2.4, 0.12, 0.8, x, 0.95, 4.0));
    for (const dx of [-1, 1]) wood.push(box(0.12, 0.9, 0.7, x + dx * 1.05, 0.45, 4.0));
    red.push(box(2.5, 0.06, 0.9, x, 1.04, 4.0));
  }
  // большой красный зонт
  const pole = new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6);
  pole.translate(0, 1.7, 4.3);
  wood.push(pole);
  const umb = new THREE.ConeGeometry(2.3, 0.85, 16, 1, true);
  umb.translate(0, 3.25, 4.3);
  red.push(umb);
  const under = new THREE.ConeGeometry(2.25, 0.8, 16, 1, true);
  under.rotateX(Math.PI);
  under.scale(1, 0.12, 1);
  under.translate(0, 2.84, 4.3);
  red.push(under);
  addMesh(group, merge(wood), toon(0x9a6a44), 0.04);
  addMesh(group, merge(dark), toon(0x4a2e24), 0.03);
  addMesh(group, merge(plaster), toon(0xf4ead8), 0.04);
  addMesh(group, merge(roof), toon(0x464e66, { rim: 0.2 }), 0.05);
  addMesh(group, merge(red), toon(0xe02e2a, { side: THREE.DoubleSide, rim: 0.2 }), 0);
  addMesh(group, merge(cloth), toon(opts.noren ?? 0x2a3c78), 0.02);
  return group;
}

// ------------------------------------------------------------------ святилище на смотровой
/** Маленькое святилище-хокора на каменном постаменте. */
export function makeShrine() {
  const group = new THREE.Group();
  group.name = 'shrine';
  const stone = [box(4.2, 0.7, 4.2, 0, 0.35, 0), box(3.2, 0.5, 3.2, 0, 0.95, 0)];
  const wood = [box(2.0, 1.7, 1.8, 0, 2.05, 0)];
  const red = [];
  for (const x of [-1, 1]) for (const z of [-0.9, 0.9]) red.push(box(0.18, 1.8, 0.18, x, 2.1, z));
  const roof = [];
  for (const sz of [1, -1]) {
    const g = box(3.0, 0.2, 1.7, 0, 0, 0);
    g.rotateX(sz * 0.5);
    g.translate(0, 3.25, sz * 0.72);
    roof.push(g);
  }
  roof.push(box(3.1, 0.24, 0.3, 0, 3.66, 0));
  const gold = [box(0.5, 0.35, 0.06, 0, 2.3, 0.93)];
  addMesh(group, merge(stone), toon(0xb8b2aa), 0.04);
  addMesh(group, merge(wood), toon(0x9a6440), 0.03);
  addMesh(group, merge(red), toon(0xe0402e, { rim: 0.2 }), 0.03);
  addMesh(group, merge(roof), toon(0x3e4a5e, { rim: 0.2 }), 0.04);
  addMesh(group, merge(gold), toon(0xffc23a, { rim: 0.4 }), 0);
  return group;
}

export { trs };
