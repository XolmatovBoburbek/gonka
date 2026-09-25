// Декорации "Неон-Токио": небоскрёбы с процедурными окнами (один InstancedMesh), неоновые вывески из атласа,
// голографические экраны, телебашня, мигающие огни, фонари, автоматы с напитками, бумажные фонарики и поезд.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, glow, outlineMaterial, outlineGeometry, normalizeGeometry, softCircleTexture } from '../world/toon.js';
import { mulberry32 } from '../world/sky.js';

export const NEON = ['#ff3ad0', '#35e8ff', '#ffe14a', '#4dff8a', '#ff8a3a', '#b06bff', '#ff4a6a'];
const JP_FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", "IPAGothic", "Noto Sans JP", sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function fogUniforms(extra) {
  return THREE.UniformsUtils.merge([THREE.UniformsLib.fog, extra]);
}

function merge(list) {
  return mergeGeometries(list.map((g) => normalizeGeometry(g)));
}

function box(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Прямоугольный брус между двумя точками (для решётчатых конструкций). */
function beam(a, b, t) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(t, len, t);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

const HASH = /* glsl */ `
  float h12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
`;

// ------------------------------------------------------------------ здания
const bVert = /* glsl */ `
  attribute vec4 aInfo;
  attribute vec3 aColor;
  varying vec3 vLocal;
  flat varying vec3 vSize;
  varying vec3 vN;
  varying vec3 vWN;
  flat varying vec4 vInfo;
  flat varying vec3 vCol;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vSize = sc;
    vLocal = position * sc;
    vN = normal;
    vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vInfo = aInfo;
    vCol = aColor;
    vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const bFrag = /* glsl */ `
  uniform vec3 uMoonDir;
  uniform vec3 uMoon;
  uniform vec3 uAmbient;
  uniform vec3 uWin[5];
  uniform vec3 uNeon[7];
  uniform float uTime;
  varying vec3 vLocal;
  flat varying vec3 vSize;
  varying vec3 vN;
  varying vec3 vWN;
  flat varying vec4 vInfo;
  flat varying vec3 vCol;
  #include <common>
  #include <fog_pars_fragment>
  ${HASH}
  void main() {
    float seed = vInfo.x;
    float type = vInfo.y;
    float lit = vInfo.z;
    int hue = int(vInfo.w + 0.5);
    vec3 neon = uNeon[hue];
    float lam = max(dot(normalize(vWN), uMoonDir), 0.0);
    vec3 wall = vCol * (uAmbient + uMoon * lam);
    vec3 col;
    float H = vSize.y;
    float y = vLocal.y;
    if (vN.y > 0.5) {
      // крыша: тёмная, с парапетом по краю
      vec2 q = abs(vLocal.xz) - vSize.xz * 0.5 + 0.7;
      float edge = step(0.0, max(q.x, q.y));
      col = vCol * 0.5 * (uAmbient + uMoon * 0.8);
      col = mix(col, wall * 1.2, edge);
      // вертолётная площадка на высоких башнях
      if (type > 1.5 && H > 70.0) {
        float r = length(vLocal.xz);
        float ring = smoothstep(0.35, 0.0, abs(r - min(vSize.x, vSize.z) * 0.32));
        col = mix(col, neon * 1.4, ring);
      }
    } else if (vN.y < -0.5) {
      col = vCol * 0.2;
    } else {
      bool sx = abs(vN.x) > 0.5;
      float W = sx ? vSize.z : vSize.x;
      float u = (sx ? vLocal.z : vLocal.x) + W * 0.5;
      float face = sx ? (vN.x > 0.0 ? 1.0 : 2.0) : (vN.z > 0.0 ? 3.0 : 4.0);
      float cw = type < 0.5 ? 2.8 : (type < 1.5 ? 3.4 : 2.0);
      float fh = type < 1.5 ? 3.4 : 2.8;
      float nc = max(1.0, floor((W - 1.2) / cw));
      float cwf = (W - 1.2) / nc;
      float base = 4.4;
      float uu = (u - 0.6) / cwf;
      float vv = (y - base) / fh;
      vec2 cell = floor(vec2(uu, vv));
      vec2 f = fract(vec2(uu, vv));
      float inside = step(0.6, u) * step(u, W - 0.6) * step(base, y) * step(y, H - 1.3);
      float win;
      if (type < 0.5) win = step(0.13, f.x) * step(f.x, 0.87) * step(0.2, f.y) * step(f.y, 0.82);
      else if (type < 1.5) win = step(0.22, f.x) * step(f.x, 0.78) * step(0.26, f.y) * step(f.y, 0.8);
      else win = step(0.04, f.x) * step(f.x, 0.96) * step(0.14, f.y) * step(f.y, 0.92);
      win *= inside;
      float area = (type < 0.5 ? 0.46 : (type < 1.5 ? 0.3 : 0.72)) * inside;
      // окна горят группами по 1-3 и целыми этажами
      float grp = 1.0 + floor(h12(vec2(seed, 1.7)) * 3.0);
      vec2 g = vec2(floor(cell.x / grp), cell.y);
      float r = h12(g * vec2(1.13, 2.71) + vec2(seed * 0.731 + face * 5.3, seed * 0.377));
      float r2 = h12(g * vec2(3.1, 0.7) + vec2(face, seed * 0.19));
      float rowOn = h12(vec2(cell.y * 0.37 + face, seed * 0.53));
      float on = step(r, lit * (0.25 + 1.2 * rowOn));
      float warm = step(0.42, h12(vec2(floor(cell.x / 4.0) + face * 7.0, seed * 0.29 + floor(cell.y / 3.0))));
      vec3 wc = mix(uWin[1], uWin[0], warm);
      if (r2 > 0.94) wc = r2 > 0.97 ? uWin[3] : uWin[4];
      wc *= 0.7 + 0.3 * r2;
      vec3 glass = mix(vec3(0.02, 0.025, 0.06), vec3(0.06, 0.05, 0.14), clamp(f.y, 0.0, 1.0));
      if (type > 1.5) glass = mix(glass, neon * 0.12 + vec3(0.03, 0.05, 0.12), y / H);
      vec3 nearCol = mix(wall, mix(glass, wc, on), win);
      // вдали — усреднённый цвет вместо мелкого узора (без ряби)
      vec3 avgWin = mix(uWin[1], uWin[0], 0.6) * 0.8;
      vec3 farCol = mix(wall, mix(vec3(0.04, 0.04, 0.1), avgWin, lit * 0.8), area);
      float fw = max(fwidth(uu), fwidth(vv));
      col = mix(nearCol, farCol, smoothstep(0.18, 0.5, fw));
      // межэтажные пояса у стеклянных башен
      if (type > 1.5) col = mix(col, wall * 1.4, (1.0 - win) * 0.4);
      // первый этаж: витрины и козырёк
      if (y < base) {
        float slot = floor(u / 6.5);
        float shopOn = step(0.3, h12(vec2(slot + face * 3.0, seed * 0.5)));
        vec3 sc = uNeon[int(mod(float(hue) + slot, 7.0))];
        float shop = step(0.5, y) * step(y, 3.1) * step(0.9, u) * step(u, W - 0.9) * step(0.08, fract(u / 6.5)) * step(fract(u / 6.5), 0.92);
        vec3 inner = mix(vec3(1.0, 0.84, 0.62), sc, 0.3) * (0.7 + 0.2 * h12(vec2(slot, seed)));
        col = mix(col, inner * shopOn + (1.0 - shopOn) * vec3(0.04, 0.035, 0.07), shop);
        float awning = step(3.3, y) * step(y, 3.8);
        col = mix(col, sc * (0.5 + 0.9 * shopOn), awning);
      }
      // цветная подсветка улицы снизу
      col += neon * 0.22 * exp(-y * 0.22);
      // неоновые контуры: верх фасада и углы
      float trimOn = step(0.55, fract(seed * 0.0731));
      float trim = step(H - 0.55, y) * step(y, H - 0.2) * trimOn;
      float cornerOn = step(0.82, fract(seed * 0.0377));
      float corner = (step(u, 0.25) + step(W - 0.25, u)) * cornerOn * step(base, y);
      col = mix(col, neon * 1.9, max(trim, corner));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * Все здания города — один InstancedMesh с процедурным фасадом.
 * list: [{x, y, z, w, d, h, ry, color, type(0 офис|1 жилой|2 стекло), lit(0..1), hue(0..6), seed}]
 */
export function makeBuildings(list, { moonDir, moon = 0x8a90d8, ambient = 0x4a4270 } = {}) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  geo.deleteAttribute('uv');
  const n = list.length;
  const info = new Float32Array(n * 4);
  const cols = new Float32Array(n * 3);
  const c = new THREE.Color();
  const mat = new THREE.ShaderMaterial({
    uniforms: fogUniforms({
      uMoonDir: { value: (moonDir || new THREE.Vector3(-0.4, 0.6, -0.7)).clone().normalize() },
      uMoon: { value: new THREE.Color(moon) },
      uAmbient: { value: new THREE.Color(ambient) },
      uWin: { value: [0xffc878, 0xc4d8ff, 0xffe8b0, 0x7ff0ff, 0xff8ad8].map((h) => new THREE.Color(h)) },
      uNeon: { value: NEON.map((h) => new THREE.Color(h)) },
      uTime: { value: 0 },
    }),
    vertexShader: bVert,
    fragmentShader: bFrag,
    fog: true,
  });
  const im = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  list.forEach((b, i) => {
    q.setFromAxisAngle(up, b.ry || 0);
    m.compose(new THREE.Vector3(b.x, b.y ?? -0.3, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
    im.setMatrixAt(i, m);
    info.set([Math.floor(b.seed ?? i * 7.3) % 1000, b.type ?? 0, b.lit ?? 0.5, b.hue ?? 0], i * 4);
    c.set(b.color ?? 0x2a2a48);
    cols.set([c.r, c.g, c.b], i * 3);
  });
  geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(cols, 3));
  im.castShadow = true;
  im.receiveShadow = false;
  im.computeBoundingSphere();
  im.name = 'buildings';
  im.userData.noShadow = true;
  return im;
}

// ------------------------------------------------------------------ атлас неоновых вывесок
const H_WORDS = ['ラーメン', 'カラオケ', 'ゲーム', '寿司', '東京', 'ネオン', 'アニメ', 'ホテル', '居酒屋', 'CAFE', 'SAKURA', '漫画', '24H', 'ゲーセン', '夜', 'たこ焼き'];
const V_WORDS = ['ラーメン', 'カラオケ', '居酒屋', 'ネオン', '夜桜', '寿司', 'アニメ', '喫茶', '東京', '花', '酒', 'ゲーム', '焼鳥', 'ホテル', 'たこ焼', '漫画'];

/** Один атлас на все вывески: слева 16 горизонтальных (512×128), справа 16 вертикальных (128×512). */
export function makeSignAtlas(seed = 5) {
  const W = 2048;
  const H = 1024;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#05030a';
  g.fillRect(0, 0, W, H);
  const rnd = mulberry32(seed);
  const rects = { h: [], v: [] };
  const drawSign = (x, y, w, h, word, vertical, k) => {
    const pad = 6;
    const col = NEON[k % NEON.length];
    const light = rnd() < 0.3; // "лайтбокс": яркий фон с тёмным текстом
    g.save();
    g.translate(x, y);
    const rr = 14;
    const path = () => {
      g.beginPath();
      g.roundRect(pad, pad, w - pad * 2, h - pad * 2, rr);
    };
    if (light) {
      const grd = g.createLinearGradient(0, 0, vertical ? w : 0, vertical ? 0 : h);
      const base = ['#fff6d8', '#ffffff', '#ffe14a', '#ff5a7a', '#8af0ff'][Math.floor(rnd() * 5)];
      grd.addColorStop(0, base);
      grd.addColorStop(1, '#ffffff');
      g.fillStyle = grd;
      path();
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = col;
      path();
      g.stroke();
    } else {
      g.fillStyle = ['#140a24', '#0a1224', '#1a0818', '#101010'][Math.floor(rnd() * 4)];
      path();
      g.fill();
      g.shadowColor = col;
      g.shadowBlur = 14;
      g.lineWidth = 5;
      g.strokeStyle = col;
      path();
      g.stroke();
      g.lineWidth = 2;
      g.strokeStyle = '#ffffff';
      path();
      g.stroke();
    }
    // текст
    g.shadowBlur = 0;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const chars = vertical ? [...word] : [word];
    const n = chars.length;
    const size = vertical ? Math.min(w * 0.68, ((h - 40) / n) * 0.86) : Math.min(h * 0.62, ((w - 60) / Math.max(2, [...word].length)) * 1.05);
    g.font = `900 ${Math.floor(size)}px ${JP_FONT}`;
    chars.forEach((ch, i) => {
      const tx = w / 2;
      const ty = vertical ? 20 + ((h - 40) * (i + 0.5)) / n : h / 2 + 4;
      if (light) {
        g.fillStyle = ['#1a0a20', '#c0102a', '#10204a'][Math.floor(rnd() * 3)];
        g.fillText(ch, tx, ty);
      } else {
        g.shadowColor = col;
        g.shadowBlur = 22;
        g.fillStyle = col;
        g.fillText(ch, tx, ty);
        g.shadowBlur = 8;
        g.fillText(ch, tx, ty);
        g.shadowBlur = 0;
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.font = `900 ${Math.floor(size * 0.94)}px ${JP_FONT}`;
        g.fillText(ch, tx, ty);
        g.font = `900 ${Math.floor(size)}px ${JP_FONT}`;
      }
    });
    g.restore();
  };
  // горизонтальные: 2 колонки × 8 рядов
  for (let i = 0; i < 16; i++) {
    const cx = (i % 2) * 512;
    const cy = Math.floor(i / 2) * 128;
    drawSign(cx, cy, 512, 128, H_WORDS[i], false, i);
    rects.h.push([cx / W, 1 - (cy + 128) / H, 512 / W, 128 / H]);
  }
  // вертикальные: 8 колонок × 2 ряда
  for (let i = 0; i < 16; i++) {
    const cx = 1024 + (i % 8) * 128;
    const cy = Math.floor(i / 8) * 512;
    drawSign(cx, cy, 128, 512, V_WORDS[i], true, i + 3);
    rects.v.push([cx / W, 1 - (cy + 512) / H, 128 / W, 512 / H]);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // половина текселя внутрь, чтобы не было швов
  const inset = (r) => [r[0] + 1 / W, r[1] + 1 / H, r[2] - 2 / W, r[3] - 2 / H];
  rects.h = rects.h.map(inset);
  rects.v = rects.v.map(inset);
  return { tex, rects };
}

const signVert = /* glsl */ `
  attribute vec4 aRect;
  attribute vec2 aFx;
  varying vec2 vUv;
  varying vec2 vFx;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vUv = aRect.xy + uv * aRect.zw;
    vFx = aFx;
    vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const signFrag = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  varying vec2 vUv;
  varying vec2 vFx;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float l = max(t.r, max(t.g, t.b));
    float fl = 1.0;
    if (vFx.y > 0.0) {
      float k = fract(uTime * 0.17 + vFx.y);
      if (k < 0.07) fl = 0.25 + 0.75 * step(0.5, fract(uTime * 13.0 + vFx.y * 5.0));
    }
    vec3 col = t.rgb * (0.75 + vFx.x * smoothstep(0.3, 1.0, l)) * fl;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * Вывески: list [{x,y,z, ry, w, h, kind:'h'|'v', index, bright, flicker}] — плоскости, смотрящие в +Z (после поворота ry).
 */
export function makeSigns(list, atlas) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const n = list.length;
  const rect = new Float32Array(n * 4);
  const fx = new Float32Array(n * 2);
  const uniforms = fogUniforms({ uMap: { value: null }, uTime: { value: 0 } });
  uniforms.uMap.value = atlas.tex;
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: signVert, fragmentShader: signFrag, fog: true });
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  list.forEach((s, i) => {
    q.setFromAxisAngle(up, s.ry);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.w, s.h, 1));
    im.setMatrixAt(i, m);
    const r = (s.kind === 'v' ? atlas.rects.v : atlas.rects.h)[s.index % 16];
    rect.set(r, i * 4);
    fx.set([s.bright ?? 2.2, s.flicker ? 0.05 + (i * 0.618) % 0.9 : 0], i * 2);
  });
  im.count = n;
  geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  geo.setAttribute('aFx', new THREE.InstancedBufferAttribute(fx, 2));
  im.computeBoundingSphere();
  im.name = 'signs';
  im.castShadow = false;
  im.userData.update = (dt) => (uniforms.uTime.value += dt);
  return im;
}

// ------------------------------------------------------------------ голографические экраны
const holoFrag = /* glsl */ `
  uniform float uTime;
  uniform float uMode;
  uniform float uAspect;
  uniform sampler2D uText;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  uniform float uBright;
  varying vec2 vUv;
  #include <common>
  #include <fog_pars_fragment>
  ${HASH}
  float heart(vec2 p) {
    p.y += 0.25;
    p.x = abs(p.x);
    if (p.y + p.x > 1.0) return sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
    return sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)), dot(p - 0.5 * max(p.x + p.y, 0.0), p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
  }
  void main() {
    vec2 uv = vUv;
    // глитч-полосы
    float gb = h12(vec2(floor(uTime * 9.0), floor(uv.y * 18.0)));
    uv.x += step(0.975, gb) * (gb - 0.975) * 3.0;
    vec3 col;
    if (uMode < 0.5) {
      // сердечки и бегущая строка
      col = mix(uA, uB, clamp(uv.y + 0.25 * sin(uTime * 0.8 + uv.x * 3.0), 0.0, 1.0));
      vec2 g = vec2(uv.x * 5.0 * uAspect, uv.y * 5.0 - uTime * 0.6);
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float rs = h12(id);
      f.x += sin(uTime * 2.0 + rs * 6.0) * 0.08;
      float hd = heart(f * (2.2 + rs * 1.2));
      float on = step(0.45, rs);
      col = mix(col, mix(uC, vec3(1.0), 0.35) * 1.4, smoothstep(0.03, -0.02, hd) * on);
      vec4 t = texture2D(uText, vec2(fract(uv.x * 0.55 / uAspect * 3.0 + uTime * 0.07), clamp((uv.y - 0.3) / 0.4, 0.0, 1.0)));
      col = mix(col, t.rgb * 1.3, t.a * step(0.3, uv.y) * step(uv.y, 0.7));
    } else {
      // синтвейв: полосатое солнце над неоновой сеткой
      col = mix(uA, uB, smoothstep(0.35, 1.0, uv.y));
      vec2 sp = vec2((uv.x - 0.5) * uAspect, uv.y - 0.5);
      float sd = length(sp) - 0.32;
      float stripes = step(0.45, fract(uv.y * 14.0 - uTime * 0.5)) + step(0.62, uv.y);
      float sun = step(sd, 0.0) * step(0.42, uv.y) * min(1.0, stripes);
      col = mix(col, mix(vec3(1.0, 0.85, 0.3), uC, smoothstep(0.82, 0.42, uv.y)) * 1.5, sun);
      col += uC * 0.5 * exp(-max(sd, 0.0) * 9.0) * step(0.42, uv.y);
      if (uv.y < 0.42) {
        float z = 0.42 / max(0.42 - uv.y, 0.01);
        vec2 gp = vec2((uv.x - 0.5) * uAspect * z, z + uTime * 1.6);
        vec2 gl = abs(fract(gp) - 0.5);
        float line = smoothstep(0.06 * z * 0.3 + 0.02, 0.0, min(gl.x, gl.y));
        col = mix(vec3(0.05, 0.0, 0.1), uB * 0.8, uv.y);
        col += uA * line * 1.5 * smoothstep(0.0, 0.42, uv.y);
      }
    }
    // строки развёртки и рамка
    col *= 0.82 + 0.18 * sin(vUv.y * 420.0 - uTime * 12.0);
    float ex = min(vUv.x, 1.0 - vUv.x) * uAspect;
    float ey = min(vUv.y, 1.0 - vUv.y);
    float edge = step(min(ex, ey), 0.025);
    col = mix(col * uBright, uC * 2.8, edge);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function marqueeTexture(text, color = '#ffffff') {
  const c = canvas(1024, 128);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 128);
  g.font = `900 84px ${JP_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 10;
  g.fillStyle = color;
  g.fillText(text, 512, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Голографический экран w×h (плоскость смотрит в +Z). mode 0 — сердечки + бегущая строка, 1 — синтвейв. */
export function makeHoloScreen(w, h, { mode = 0, text = 'ネオン東京 ♥ SAKURA DRIFT ♥', a = 0xff3ad0, b = 0x6a2cff, c = 0x35e8ff, bright = 1.1 } = {}) {
  const uniforms = fogUniforms({
    uTime: { value: Math.random() * 10 },
    uMode: { value: mode },
    uAspect: { value: w / h },
    uText: { value: marqueeTexture(text) },
    uA: { value: new THREE.Color(a) },
    uB: { value: new THREE.Color(b) },
    uC: { value: new THREE.Color(c) },
    uBright: { value: bright },
  });
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: holoFrag,
    fog: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.name = 'holo';
  mesh.userData.update = (dt) => (uniforms.uTime.value += dt);
  return mesh;
}

// ------------------------------------------------------------------ мигающие огни (билборды)
const blinkVert = /* glsl */ `
  attribute vec4 aB; // xyz — центр, w — фаза
  uniform float uTime;
  uniform float uSize;
  varying vec2 vUv;
  varying float vI;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 mvPosition = viewMatrix * vec4(aB.xyz, 1.0);
    float d = -mvPosition.z;
    float s = uSize * (1.0 + d * 0.006);
    mvPosition.xy += position.xy * s;
    float ph = aB.w;
    vI = ph < 0.0 ? 1.0 : 0.12 + 1.0 * pow(max(0.0, sin(uTime * 2.4 + ph * 6.2831)), 12.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const blinkFrag = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vI;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, r);
    float core = smoothstep(0.35, 0.0, r);
    vec3 col = uColor * (a * a * 0.8 + core * 2.5) * vI;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Огни-билборды (аддитивные). points: [{x,y,z, phase}] (phase < 0 — горит постоянно). */
export function makeBlinkers(points, { color = 0xff2a3a, size = 0.9 } = {}) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const arr = new Float32Array(points.length * 4);
  points.forEach((p, i) => arr.set([p.x, p.y, p.z, p.phase ?? i * 0.371], i * 4));
  geo.setAttribute('aB', new THREE.InstancedBufferAttribute(arr, 4));
  geo.instanceCount = points.length;
  const uniforms = fogUniforms({ uTime: { value: 0 }, uSize: { value: size }, uColor: { value: new THREE.Color(color) } });
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: blinkVert,
    fragmentShader: blinkFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = 'blinkers';
  mesh.userData.update = (dt) => (uniforms.uTime.value += dt);
  return mesh;
}

// ------------------------------------------------------------------ световые пятна на земле
/** Аддитивные "лужи света": list [{x,y,z, r, color, sx?, ry?}] */
export function makeLightPools(list, { opacity = 1 } = {}) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: softCircleTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
  });
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  list.forEach((p, i) => {
    q.setFromAxisAngle(up, p.ry ?? 0);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.r * 2 * (p.sx ?? 1), 1, p.r * 2));
    im.setMatrixAt(i, m);
    im.setColorAt(i, c.set(p.color).multiplyScalar(p.i ?? 1));
  });
  im.count = list.length;
  im.castShadow = false;
  im.renderOrder = 1;
  im.computeBoundingSphere();
  im.name = 'light-pools';
  return im;
}

// ------------------------------------------------------------------ уличные фонари
/** points: [{x,y,z, ry}] — ry: направление "к дороге" (локальная +Z). */
export function makeStreetLamps(points, { outline = true, color = 0xfff0d6 } = {}) {
  const pole = merge([
    box(0.5, 0.5, 0.5, 0, 0.25, 0),
    new THREE.CylinderGeometry(0.13, 0.17, 7.4, 6).translate(0, 3.7, 0),
    box(0.18, 0.18, 2.6, 0, 7.25, 1.2),
    box(0.5, 0.22, 1.1, 0, 7.2, 2.35),
  ]);
  const head = new THREE.BoxGeometry(0.42, 0.08, 0.95);
  head.translate(0, 7.07, 2.35);
  const mats = points.map((p) => {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry), new THREE.Vector3(1, 1, 1));
    return m;
  });
  const group = new THREE.Group();
  group.name = 'street-lamps';
  group.add(instancedParts([{ geo: pole, mat: toon(0x5a5878, { rim: 0.3 }), outline: outline ? 0.04 : 0 }], mats));
  group.add(instancedParts([{ geo: normalizeGeometry(head), mat: glow(color, 2.2), shadow: false }], mats));
  return group;
}

/** Мини-версия instanced() из props.js без разбиения на чанки (стабильные индексы, 1 draw call на деталь). */
export function instancedParts(parts, matrices, { colors = null, name = 'parts' } = {}) {
  const group = new THREE.Group();
  group.name = name;
  if (!matrices.length) return group;
  for (const p of parts) {
    const im = new THREE.InstancedMesh(p.geo, p.mat, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    if (colors && p.tint) colors.forEach((c, i) => im.setColorAt(i, c));
    im.castShadow = p.shadow ?? true;
    im.receiveShadow = false;
    im.computeBoundingSphere();
    group.add(im);
    if (p.outline) {
      const om = new THREE.InstancedMesh(p.outlineGeo || outlineGeometry(p.geo), outlineMaterial(p.outlineColor ?? 0x140a20, p.outline), matrices.length);
      om.instanceMatrix = im.instanceMatrix;
      om.castShadow = false;
      om.computeBoundingSphere();
      group.add(om);
    }
  }
  return group;
}

// ------------------------------------------------------------------ автоматы с напитками
function vendingTexture() {
  const c = canvas(128, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#e8f4ff';
  g.fillRect(0, 0, 128, 256);
  // верхняя подсвеченная панель
  const grd = g.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0, '#35e8ff');
  grd.addColorStop(1, '#ff6ad0');
  g.fillStyle = grd;
  g.fillRect(6, 6, 116, 34);
  g.fillStyle = '#ffffff';
  g.font = `900 22px ${JP_FONT}`;
  g.textAlign = 'center';
  g.fillText('つめた〜い', 64, 31);
  // ряды бутылок
  const cols = ['#ff4a5a', '#4a8aff', '#ffd23a', '#4adf7a', '#ff8a3a', '#b06bff', '#ffffff', '#3ad0ff'];
  const rnd = mulberry32(12);
  for (let r = 0; r < 4; r++) {
    g.fillStyle = '#c8d8f0';
    g.fillRect(6, 50 + r * 40 + 30, 116, 4);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      const x = 12 + i * 18.5;
      g.beginPath();
      g.roundRect(x, 50 + r * 40 + 4, 12, 26, 4);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillRect(x + 2, 50 + r * 40 + 8, 3, 16);
    }
  }
  g.fillStyle = '#1a1a2a';
  g.fillRect(20, 222, 88, 22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Автоматы: points [{x,y,z, ry, color}] — лицевая сторона смотрит в +Z. */
export function makeVending(points, { outline = true } = {}) {
  const body = merge([box(1.2, 2.0, 0.85, 0, 1.0, 0), box(1.28, 0.12, 0.95, 0, 2.06, 0.03)]);
  const front = new THREE.PlaneGeometry(1.0, 1.6);
  front.translate(0, 1.1, 0.43);
  const mats = [];
  const cols = [];
  for (const p of points) {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry), new THREE.Vector3(1, 1, 1));
    mats.push(m);
    cols.push(new THREE.Color(p.color ?? 0xffffff));
  }
  const group = new THREE.Group();
  group.name = 'vending';
  group.add(instancedParts([{ geo: body, mat: toon(0xffffff, { rim: 0.3 }), tint: true, outline: outline ? 0.035 : 0 }], mats, { colors: cols }));
  const fm = new THREE.MeshBasicMaterial({ map: vendingTexture(), color: new THREE.Color(1.15, 1.15, 1.15) });
  group.add(instancedParts([{ geo: normalizeGeometry(front), mat: fm, shadow: false }], mats));
  return group;
}

// ------------------------------------------------------------------ бумажные фонарики-тётин
function lanternGeometry() {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const y = -0.5 + t;
    const r = 0.18 + 0.32 * Math.sin(Math.PI * (0.08 + 0.84 * t));
    pts.push(new THREE.Vector2(r, y));
  }
  const g = new THREE.LatheGeometry(pts, 10);
  // вертикальный градиент: светлая середина
  return g;
}

/**
 * Гирлянды фонариков: strings [{a: Vector3, b: Vector3, sag, count}] — провод между точками a и b.
 * Возвращает группу (провода + фонарики + колпачки).
 */
export function makeLanternStrings(strings, { color = 0xff4a2a, color2 = 0xffc05a } = {}) {
  const wires = [];
  const mats = [];
  const cols = [];
  const c1 = new THREE.Color(color);
  const c2 = new THREE.Color(color2);
  const rnd = mulberry32(8);
  for (const s of strings) {
    const n = 14;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = new THREE.Vector3().lerpVectors(s.a, s.b, t);
      p.y -= Math.sin(Math.PI * t) * (s.sag ?? 1.2);
      pts.push(p);
    }
    for (let i = 0; i < n; i++) wires.push(beam(pts[i], pts[i + 1], 0.06));
    const count = s.count ?? 6;
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count;
      const p = new THREE.Vector3().lerpVectors(s.a, s.b, t);
      p.y -= Math.sin(Math.PI * t) * (s.sag ?? 1.2) + 0.75;
      const m = new THREE.Matrix4();
      m.compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), new THREE.Vector3(1, 1.15, 1).multiplyScalar(s.scale ?? 1));
      mats.push(m);
      cols.push(rnd() < 0.8 ? c1.clone() : c2.clone());
    }
  }
  const group = new THREE.Group();
  group.name = 'lanterns';
  if (wires.length) {
    const w = new THREE.Mesh(merge(wires), toon(0x1a1420));
    w.castShadow = false;
    group.add(w);
  }
  const body = normalizeGeometry(lanternGeometry());
  const caps = merge([new THREE.CylinderGeometry(0.2, 0.22, 0.12, 8).translate(0, 0.52, 0), new THREE.CylinderGeometry(0.22, 0.2, 0.12, 8).translate(0, -0.52, 0), new THREE.CylinderGeometry(0.02, 0.02, 0.35, 4).translate(0, 0.72, 0)]);
  const lm = new THREE.MeshBasicMaterial({ color: 0xffffff });
  group.add(instancedParts([{ geo: body, mat: lm, tint: true, shadow: false, outline: 0.03, outlineColor: 0x3a0a10 }], mats, { colors: cols.map((c) => c.clone().multiplyScalar(1.5)) }));
  group.add(instancedParts([{ geo: caps, mat: toon(0x1a1018), shadow: false }], mats));
  return group;
}

// ------------------------------------------------------------------ телебашня (как Токийская)
export function makeTower({ height = 150, base = 19, outline = true } = {}) {
  const H = height;
  const legTop = H * 0.8;
  const half = (y) => {
    const t = y / legTop;
    return 1.6 + (base - 1.6) * Math.pow(1 - t, 2.1);
  };
  const red = new THREE.Color(0xff4a1a);
  const white = new THREE.Color(0xf6f0ea);
  const parts = [];
  const lights = [];
  const levels = 22;
  const ys = [];
  for (let i = 0; i <= levels; i++) ys.push(legTop * Math.pow(i / levels, 0.92));
  const corners = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  const P = (y, c) => new THREE.Vector3(c[0] * half(y), y, c[1] * half(y));
  for (let i = 0; i < levels; i++) {
    const y0 = ys[i];
    const y1 = ys[i + 1];
    const th = 1.5 * (1 - (i / levels) * 0.7);
    for (let k = 0; k < 4; k++) {
      const c = corners[k];
      const d = corners[(k + 1) % 4];
      parts.push(beam(P(y0, c), P(y1, c), th)); // ноги
      parts.push(beam(P(y1, c), P(y1, d), th * 0.45)); // пояс
      if (i > 1) {
        parts.push(beam(P(y0, c), P(y1, d), th * 0.3)); // раскосы
        parts.push(beam(P(y0, d), P(y1, c), th * 0.3));
      }
      if (i % 2 === 0) lights.push(P(y0, c).multiplyScalar(1.04));
    }
  }
  // арки между ногами у основания
  for (let k = 0; k < 4; k++) {
    const c = corners[k];
    const d = corners[(k + 1) % 4];
    const pts = [];
    for (let j = 0; j <= 12; j++) {
      const t = j / 12;
      const a = P(0, c).lerp(P(0, d), t);
      const yy = Math.sin(Math.PI * t) * 16;
      const hh = half(yy) / half(0);
      pts.push(new THREE.Vector3(a.x * hh, yy, a.z * hh));
    }
    for (let j = 0; j < 12; j++) parts.push(beam(pts[j], pts[j + 1], 1.1));
  }
  // главная и верхняя обзорные площадки
  const deck1 = new THREE.CylinderGeometry(half(H * 0.4) + 2.6, half(H * 0.4) + 1.8, 7, 8);
  deck1.rotateY(Math.PI / 8);
  deck1.translate(0, H * 0.4, 0);
  const deck2 = new THREE.CylinderGeometry(half(H * 0.66) + 2.0, half(H * 0.66) + 1.4, 4, 8);
  deck2.rotateY(Math.PI / 8);
  deck2.translate(0, H * 0.66, 0);
  parts.push(deck1, deck2);
  // антенна
  parts.push(new THREE.CylinderGeometry(0.7, 1.3, H - legTop + 2, 8).translate(0, (legTop + H) / 2 - 1, 0));
  parts.push(new THREE.CylinderGeometry(1.8, 1.8, 3, 8).translate(0, legTop + 6, 0));
  // полосы: красный/белый по высоте
  const geo = merge(parts);
  const pos = geo.getAttribute('position');
  const colArr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const band = Math.floor((pos.getY(i) / H) * 13);
    const cc = band % 2 === 0 || band === 5 ? red : white;
    colArr.set([cc.r, cc.g, cc.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  const group = new THREE.Group();
  group.name = 'tower';
  const mat = toon(0xffffff, { vertexColors: true, rim: 0.3, rimColor: 0xffc080, emissive: 0x6a2008, emissiveIntensity: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  group.add(mesh);
  if (outline) {
    const ol = new THREE.Mesh(outlineGeometry(merge([deck1, deck2])), outlineMaterial(0x2a0a10, 0.18));
    group.add(ol);
  }
  // окна обзорных площадок
  const win1 = new THREE.CylinderGeometry(half(H * 0.4) + 2.62, half(H * 0.4) + 2.2, 2.2, 8, 1, true);
  win1.rotateY(Math.PI / 8);
  win1.translate(0, H * 0.4 + 0.6, 0);
  const win2 = new THREE.CylinderGeometry(half(H * 0.66) + 2.02, half(H * 0.66) + 1.8, 1.4, 8, 1, true);
  win2.rotateY(Math.PI / 8);
  win2.translate(0, H * 0.66, 0);
  group.add(new THREE.Mesh(merge([win1, win2]), glow(0xffe0a0, 2.4)));
  // подсветка: тёплые точки вдоль ног + огни на вершине
  const blink = [];
  blink.push({ x: 0, y: H + 1.2, z: 0, phase: 0 });
  for (const c of corners) blink.push({ x: c[0] * 2.2, y: legTop + 7.8, z: c[1] * 2.2, phase: 0.5 });
  const warm = lights.map((p) => ({ x: p.x, y: p.y, z: p.z, phase: -1 }));
  return { group, blink, warm };
}

// ------------------------------------------------------------------ поезд на эстакаде
/** Электричка, бегущая туда-обратно по прямой a→b на высоте. Возвращает {group, update}. */
export function makeTrain(a, b, { cars = 7, speed = 26, outline = true } = {}) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  dir.normalize();
  const ry = Math.atan2(dir.x, dir.z);
  const carLen = 13;
  const bodyGeo = new THREE.BoxGeometry(2.9, 3.2, carLen - 0.6);
  bodyGeo.translate(0, 1.9, 0);
  // окна-полосы по бокам (светятся)
  const winGeo = merge([box(0.04, 1.1, carLen - 2, 1.47, 2.3, 0), box(0.04, 1.1, carLen - 2, -1.47, 2.3, 0)]);
  const bodyMat = toon(0xf0f4f8, { rim: 0.25 });
  const winMat = glow(0xffe6b0, 2.2);
  const stripe = merge([box(2.95, 0.3, carLen - 0.6, 0, 1.2, 0)]);
  const stripeMat = toon(0x4ad06a);
  const n = cars;
  const group = new THREE.Group();
  group.name = 'train';
  const meshes = [];
  for (const [g, m, ol] of [
    [normalizeGeometry(bodyGeo), bodyMat, outline],
    [winGeo, winMat, false],
    [stripe, stripeMat, false],
  ]) {
    const im = new THREE.InstancedMesh(g, m, n);
    im.frustumCulled = false;
    im.castShadow = false;
    group.add(im);
    meshes.push(im);
    if (ol) {
      const om = new THREE.InstancedMesh(outlineGeometry(g), outlineMaterial(0x141020, 0.07), n);
      om.instanceMatrix = im.instanceMatrix;
      om.frustumCulled = false;
      group.add(om);
    }
  }
  const span = n * carLen;
  const run = Math.max(1, len - span);
  let t = Math.random() * run * 2;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const update = (dt) => {
    // туда-обратно по эстакаде
    t = (t + dt * speed) % (run * 2);
    const head = span / 2 + (t < run ? t : run * 2 - t);
    for (let i = 0; i < n; i++) {
      p.copy(a).addScaledVector(dir, head + ((n - 1) / 2 - i) * carLen);
      m.compose(p, q, one);
      for (const im of meshes) im.setMatrixAt(i, m);
    }
    for (const im of meshes) im.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { group, update };
}
