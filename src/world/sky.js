// Аниме-небо: градиент, солнце/луна, рисованные облака с чёткими краями, звёзды.
// Плюс объёмные кучевые облака и слои гор на горизонте.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getGradientMap } from './toon.js';

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // всегда на дальней плоскости
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uGlowColor;
  uniform float uSunSize;
  uniform float uSunGlow;
  uniform float uHorizonGlow;
  uniform vec3 uCloudLight;
  uniform vec3 uCloudShade;
  uniform vec3 uCloudRim;
  uniform float uCloudCover;
  uniform float uCloudScale;
  uniform float uCloudOpacity;
  uniform float uTime;
  uniform float uStars;
  uniform vec3 uMoonDir;
  uniform float uMoonSize;
  uniform vec3 uMoonColor;
  uniform float uMidPos;
  varying vec3 vDir;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = rot * p * 2.03 + 11.7;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    float t1 = smoothstep(-0.03, uMidPos, h);
    float t2 = smoothstep(uMidPos * 0.6, 0.95, h);
    vec3 col = mix(uHorizon, uMid, t1);
    col = mix(col, uTop, t2);
    col = mix(uBottom, col, smoothstep(-0.2, 0.0, h));

    float sd = dot(d, uSunDir);
    float sdp = max(sd, 0.0);
    col += uGlowColor * (pow(sdp, 5.0) * 0.35 + pow(sdp, 48.0) * 0.6) * uSunGlow;

    vec2 dh = normalize(d.xz + 1e-5);
    vec2 sh = normalize(uSunDir.xz + 1e-5);
    float az = max(dot(dh, sh), 0.0);
    col += uGlowColor * exp(-abs(h) * 9.0) * (0.25 + 0.75 * pow(az, 3.0)) * uHorizonGlow;

    // звёзды
    if (uStars > 0.0 && h > -0.05) {
      vec2 sc = vec2(atan(d.z, d.x), asin(clamp(h, -1.0, 1.0))) * 110.0;
      vec2 cell = floor(sc);
      float rnd = hash12(cell);
      if (rnd > 0.975) {
        vec2 pos = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) * 0.6 + 0.2;
        float dist = length(fract(sc) - pos);
        float tw = 0.65 + 0.35 * sin(uTime * (1.5 + rnd * 4.0) + rnd * 40.0);
        float star = smoothstep(0.16, 0.0, dist) * tw * (0.5 + 0.5 * hash12(cell + 1.3));
        col += vec3(0.9, 0.93, 1.0) * star * uStars * 2.2 * smoothstep(-0.05, 0.25, h);
      }
    }

    // луна
    if (uMoonSize > 0.0) {
      float md = dot(d, uMoonDir);
      float moon = smoothstep(cos(uMoonSize), cos(uMoonSize * 0.93), md);
      vec3 mperp = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec2 muv = vec2(dot(d, mperp), d.y - uMoonDir.y) / uMoonSize;
      float crater = noise(muv * 3.0 + 4.0) * 0.5 + noise(muv * 7.0) * 0.25;
      vec3 mc = uMoonColor * (0.82 + 0.25 * crater);
      col += uMoonColor * pow(max(md, 0.0), 180.0) * 0.35;
      col += uMoonColor * pow(max(md, 0.0), 1400.0) * 0.8;
      col = mix(col, mc * 1.6, moon);
    }

    // рисованные облака: чёткие края + 2 тона освещения + светлая кайма
    if (uCloudCover > 0.0 && h > 0.0) {
      vec2 uv = d.xz / (h + 0.09) * uCloudScale;
      uv += vec2(uTime * 0.006, uTime * 0.002);
      vec2 warp = vec2(fbm(uv * 0.5 + 3.0), fbm(uv * 0.5 + 9.0));
      float n = fbm(uv + warp * 0.8);
      float thr = 1.0 - uCloudCover;
      float body = smoothstep(thr, thr + 0.025, n);
      vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.09;
      float n2 = fbm(uv + toSun + warp * 0.8);
      float lit = clamp((n - n2) * 9.0 + 0.55, 0.0, 1.0);
      float band = smoothstep(0.42, 0.46, lit);
      vec3 cc = mix(uCloudShade, uCloudLight, band);
      float edge = smoothstep(thr, thr + 0.025, n) - smoothstep(thr + 0.025, thr + 0.07, n);
      cc = mix(cc, uCloudRim, edge * 0.7 * (0.4 + 0.6 * pow(sdp, 2.0)));
      float fade = smoothstep(0.0, 0.14, h);
      col = mix(col, cc, body * fade * uCloudOpacity);
    }

    float sunDisc = smoothstep(cos(uSunSize), cos(uSunSize * 0.8), sd);
    col = mix(col, uSunColor, sunDisc);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function col(c) {
  return new THREE.Color(c);
}

export function createSky(opts = {}) {
  const sunDir = (opts.sunDir || new THREE.Vector3(0.3, 0.5, -0.8)).clone().normalize();
  const moonDir = (opts.moonDir || new THREE.Vector3(-0.4, 0.45, -0.8)).clone().normalize();
  const uniforms = {
    uTop: { value: col(opts.top ?? 0x2f7bff) },
    uMid: { value: col(opts.mid ?? 0x7fbaff) },
    uHorizon: { value: col(opts.horizon ?? 0xffe0ef) },
    uBottom: { value: col(opts.bottom ?? opts.horizon ?? 0xffe0ef) },
    uMidPos: { value: opts.midPos ?? 0.3 },
    uSunDir: { value: sunDir },
    uSunColor: { value: col(opts.sunColor ?? 0xfff6d8).multiplyScalar(opts.sunBright ?? 3.0) },
    uGlowColor: { value: col(opts.glowColor ?? 0xffe6b0) },
    uSunSize: { value: opts.sunSize ?? 0.045 },
    uSunGlow: { value: opts.sunGlow ?? 0.8 },
    uHorizonGlow: { value: opts.horizonGlow ?? 0.2 },
    uCloudLight: { value: col(opts.cloudLight ?? 0xffffff) },
    uCloudShade: { value: col(opts.cloudShade ?? 0xc9d8f5) },
    uCloudRim: { value: col(opts.cloudRim ?? 0xffffff) },
    uCloudCover: { value: opts.cloudCover ?? 0.42 },
    uCloudScale: { value: opts.cloudScale ?? 1.4 },
    uCloudOpacity: { value: opts.cloudOpacity ?? 1.0 },
    uTime: { value: 0 },
    uStars: { value: opts.stars ?? 0 },
    uMoonDir: { value: moonDir },
    uMoonSize: { value: opts.moonSize ?? 0 },
    uMoonColor: { value: col(opts.moonColor ?? 0xfff4d6) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const geo = new THREE.SphereGeometry(1000, 48, 24);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  mesh.userData.update = (dt, camera) => {
    uniforms.uTime.value += dt;
    mesh.position.copy(camera.position);
  };
  mesh.userData.uniforms = uniforms;
  return mesh;
}

/** Освещение сцены: солнце с тенями, которые "едут" за игроком, + небесный свет. */
export function createLights(scene, opts = {}) {
  const hemi = new THREE.HemisphereLight(opts.hemiSky ?? 0xcfe3ff, opts.hemiGround ?? 0x8a7a70, opts.hemiIntensity ?? 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(opts.sunColor ?? 0xfff1dd, opts.sunIntensity ?? 2.6);
  const sunDir = (opts.sunDir || new THREE.Vector3(0.3, 0.6, -0.7)).clone().normalize();
  sun.userData.dir = sunDir;
  sun.castShadow = true;
  const s = opts.shadowExtent ?? 70;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);
  scene.add(sun.target);
  const lights = { hemi, sun, sunDir };
  lights.follow = (target) => {
    // привязка к сетке текселей тени убирает "мерцание" краёв теней
    const texel = (2 * s) / sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    sun.target.position.set(tx, target.y, tz);
    sun.position.set(tx + sunDir.x * 200, target.y + sunDir.y * 200, tz + sunDir.z * 200);
  };
  lights.setShadowSize = (n) => {
    if (sun.shadow.mapSize.x === n) return;
    sun.shadow.mapSize.set(n, n);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  };
  return lights;
}

// ---------- Объёмные кучевые облака (как в летнем аниме) ----------
export function createCumulus(opts = {}) {
  const {
    count = 14,
    radius = 620,
    radiusJitter = 160,
    minY = 60,
    maxY = 160,
    scale = [40, 90],
    color = 0xffffff,
    shade = 0xb9cdf0,
    seed = 1,
    arc = null, // [fromAngle, toAngle] — ограничить сектор
    tint = null, // {color, amount} — дымка
  } = opts;
  const rnd = mulberry32(seed);
  const geos = [];
  for (let c = 0; c < count; c++) {
    const a = arc ? arc[0] + (arc[1] - arc[0]) * rnd() : rnd() * Math.PI * 2;
    const r = radius + (rnd() - 0.5) * 2 * radiusJitter;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const cy = minY + rnd() * (maxY - minY);
    const sc = scale[0] + rnd() * (scale[1] - scale[0]);
    const puffs = 7 + Math.floor(rnd() * 6);
    for (let i = 0; i < puffs; i++) {
      const t = i / (puffs - 1) - 0.5;
      const pr = sc * (0.35 + 0.3 * rnd()) * (1 - Math.abs(t) * 0.8);
      const g = new THREE.IcosahedronGeometry(pr, 2);
      const px = t * sc * 1.6 + (rnd() - 0.5) * sc * 0.2;
      const py = (0.25 - Math.abs(t) * 0.4) * sc * 0.9 + rnd() * sc * 0.25;
      const pz = (rnd() - 0.5) * sc * 0.35;
      // повернуть облако лицом к центру
      const cosA = Math.cos(-a + Math.PI / 2);
      const sinA = Math.sin(-a + Math.PI / 2);
      g.translate(px * cosA - pz * sinA + cx, py + cy, px * sinA + pz * cosA + cz);
      g.deleteAttribute('uv');
      geos.push(g.index ? g.toNonIndexed() : g);
    }
    // плоское основание (сплющенный эллипсоид)
    const base = new THREE.SphereGeometry(sc * 0.9, 16, 8);
    base.scale(1.3, 0.28, 0.5);
    base.rotateY(a - Math.PI / 2);
    base.translate(cx, cy - sc * 0.05, cz);
    base.deleteAttribute('uv');
    geos.push(base.toNonIndexed());
  }
  const geo = mergeGeometries(geos);
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: getGradientMap('soft'),
    fog: false,
    emissive: new THREE.Color(shade).multiplyScalar(0.35),
  });
  if (tint) {
    mat.color.lerp(new THREE.Color(tint.color), tint.amount);
    mat.emissive.lerp(new THREE.Color(tint.color), tint.amount * 0.6);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'cumulus';
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- Горные хребты на горизонте ----------
export function createMountainRing(opts = {}) {
  const {
    radius = 700,
    height = 120,
    baseY = -10,
    segments = 256,
    color = 0x7c86c8,
    topColor = null,
    snowLine = null,
    snowColor = 0xffffff,
    seed = 3,
    roughness = 1,
    peaks = 9,
    fogColor = null,
    fogAmount = 0,
    arc = null,
  } = opts;
  const rnd = mulberry32(seed);
  const offs = Array.from({ length: 6 }, () => rnd() * 100);
  const heightAt = (a) => {
    let h = 0;
    h += Math.pow(Math.max(0, Math.sin(a * peaks + offs[0])), 1.6) * 0.55;
    h += Math.pow(Math.max(0, Math.sin(a * peaks * 2.3 + offs[1])), 2) * 0.25 * roughness;
    h += (Math.sin(a * peaks * 5.1 + offs[2]) * 0.5 + 0.5) * 0.12 * roughness;
    h += (Math.sin(a * peaks * 11.7 + offs[3]) * 0.5 + 0.5) * 0.06 * roughness;
    h += 0.12;
    return h;
  };
  const positions = [];
  const colors = [];
  const indices = [];
  const cBase = new THREE.Color(color);
  const cTop = new THREE.Color(topColor ?? color);
  const cSnow = new THREE.Color(snowColor);
  const cFog = fogColor ? new THREE.Color(fogColor) : null;
  const a0 = arc ? arc[0] : 0;
  const a1 = arc ? arc[1] : Math.PI * 2;
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    const hh = heightAt(a) * height;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    const rows = 5;
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      // профиль склона: у подножия шире (к центру ближе)
      const rr = radius - (1 - t) * 0 + t * 0;
      const y = baseY + hh * (t === 0 ? 0 : Math.pow(t, 0.9));
      const inward = (1 - t) * 0.0;
      positions.push(x * (rr / radius) * (1 - inward), y, z * (rr / radius) * (1 - inward));
      const c = cBase.clone().lerp(cTop, t);
      if (snowLine !== null && y - baseY > snowLine * height && t > 0.6) c.lerp(cSnow, 0.85);
      if (cFog) c.lerp(cFog, fogAmount * (1 - t * 0.35));
      colors.push(c.r, c.g, c.b);
    }
  }
  const rows = 6;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j;
      const b = (i + 1) * rows + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'mountains';
  return mesh;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
