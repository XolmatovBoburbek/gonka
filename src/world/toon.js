// Аниме cel-shading: ступенчатое освещение, контуры (inverted hull), rim-свет и светящиеся материалы.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const gradientMaps = new Map();

// Каждая текстура — "лестница" освещения. Координата = dot(N, L) * 0.5 + 0.5,
// то есть первые 4 тексела из 8 — теневая сторона, дальше тонкая полутень и свет.
const RAMPS = {
  default: [0.4, 0.4, 0.4, 0.4, 0.7, 1, 1, 1],
  soft: [0.55, 0.55, 0.55, 0.62, 0.82, 1, 1, 1],
  hard: [0.34, 0.34, 0.34, 0.34, 1, 1, 1, 1],
  skin: [0.62, 0.62, 0.62, 0.66, 0.86, 1, 1, 1],
  terrain: [0.5, 0.5, 0.5, 0.56, 0.8, 0.94, 1, 1],
};

export function getGradientMap(kind = 'default') {
  if (gradientMaps.has(kind)) return gradientMaps.get(kind);
  const ramp = RAMPS[kind] || RAMPS.default;
  const data = new Uint8Array(ramp.length * 4);
  ramp.forEach((v, i) => {
    const b = Math.round(v * 255);
    data[i * 4] = b;
    data[i * 4 + 1] = b;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, ramp.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradientMaps.set(kind, tex);
  return tex;
}

/**
 * Тун-материал. opts: ramp, rim (0..1), rimColor, emissive, emissiveIntensity, map,
 * vertexColors, transparent, opacity, side, fog.
 */
export function toon(color = 0xffffff, opts = {}) {
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: getGradientMap(opts.ramp || 'default'),
    map: opts.map || null,
    vertexColors: !!opts.vertexColors,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    fog: opts.fog ?? true,
  });
  if (opts.rim) addRim(mat, opts.rim, opts.rimColor ?? 0xffffff);
  return mat;
}

/** Контровой (rim) свет — светлая кайма по силуэту, как в аниме. */
export function addRim(mat, strength = 0.5, color = 0xffffff, lo = 0.62, hi = 0.8) {
  const uniforms = {
    uRimColor: { value: new THREE.Color(color) },
    uRimStrength: { value: strength },
    uRimRange: { value: new THREE.Vector2(lo, hi) },
  };
  mat.userData.rim = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform vec2 uRimRange;'
      )
      .replace(
        '#include <opaque_fragment>',
        `float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        rimF = smoothstep(uRimRange.x, uRimRange.y, rimF);
        outgoingLight += uRimColor * rimF * uRimStrength * diffuseColor.rgb;
        #include <opaque_fragment>`
      );
  };
  mat.customProgramCacheKey = () => 'toon-rim';
  return mat;
}

const outlineMatCache = new Map();

/** Материал контура: задние грани, раздутые по нормали. */
export function outlineMaterial(color = 0x1c1024, thickness = 0.035, opts = {}) {
  const key = `${color}_${thickness}_${opts.fog ?? true}`;
  if (outlineMatCache.has(key)) return outlineMatCache.get(key);
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: opts.fog ?? true });
  const uniforms = { uOutline: { value: thickness } };
  mat.userData.outline = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace('#include <begin_vertex>', 'vec3 transformed = position + normalize(normal) * uOutline;');
  };
  mat.customProgramCacheKey = () => 'outline-hull';
  outlineMatCache.set(key, mat);
  return mat;
}

/** Геометрия контура: склеиваем вершины, чтобы нормали были гладкими и не рвались на углах. */
export function outlineGeometry(geometry) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geometry.getAttribute('position').clone());
  if (geometry.index) g.setIndex(geometry.index.clone());
  const merged = mergeVertices(g, 1e-3);
  merged.computeVertexNormals();
  return merged;
}

/** Добавляет контур к мешу (или InstancedMesh) и возвращает его. */
export function addOutline(mesh, thickness = 0.035, color = 0x1c1024, opts = {}) {
  const geo = opts.sharedGeometry || outlineGeometry(mesh.geometry);
  const mat = outlineMaterial(color, thickness, opts);
  let outline;
  if (mesh.isInstancedMesh) {
    outline = new THREE.InstancedMesh(geo, mat, mesh.count);
    outline.instanceMatrix = mesh.instanceMatrix;
    outline.frustumCulled = mesh.frustumCulled;
    outline.position.copy(mesh.position);
    outline.quaternion.copy(mesh.quaternion);
    outline.scale.copy(mesh.scale);
    if (mesh.parent) mesh.parent.add(outline);
    mesh.userData.outline = outline;
  } else {
    outline = new THREE.Mesh(geo, mat);
    mesh.add(outline);
  }
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.userData.isOutline = true;
  outline.renderOrder = mesh.renderOrder;
  return outline;
}

/** Светящийся (для bloom) материал: цвет может быть > 1. */
export function glow(color, intensity = 2.5, opts = {}) {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({
    color: c,
    fog: opts.fog ?? true,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: opts.depthWrite ?? !opts.additive,
    side: opts.side ?? THREE.FrontSide,
    map: opts.map || null,
    toneMapped: opts.toneMapped ?? true,
  });
}

/** Простая мягкая радиальная текстура (для спрайтов свечения и частиц). */
let _softTex = null;
export function softCircleTexture() {
  if (_softTex) return _softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _softTex = new THREE.CanvasTexture(c);
  _softTex.colorSpace = THREE.SRGBColorSpace;
  return _softTex;
}

/** Утилита: запечь трансформацию в геометрию (для слияния деталей). */
export function bake(geometry, { position, rotation, scale } = {}) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  if (rotation) q.setFromEuler(new THREE.Euler(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0));
  const p = position ? new THREE.Vector3(...position) : new THREE.Vector3();
  const s = scale
    ? typeof scale === 'number'
      ? new THREE.Vector3(scale, scale, scale)
      : new THREE.Vector3(...scale)
    : new THREE.Vector3(1, 1, 1);
  m.compose(p, q, s);
  geometry.applyMatrix4(m);
  return geometry;
}

/** Вершинные цвета одной заливкой (для слияния разноцветных деталей в один меш). */
export function paint(geometry, color) {
  const c = new THREE.Color(color);
  const n = geometry.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/** Оставляет у геометрии только position/normal/uv(+color) и делает её неиндексированной при необходимости — для mergeGeometries. */
export function normalizeGeometry(geometry, { color = false, uv = true } = {}) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  const keep = ['position', 'normal'];
  if (uv) keep.push('uv');
  if (color) keep.push('color');
  for (const name of Object.keys(g.attributes)) {
    if (!keep.includes(name)) g.deleteAttribute(name);
  }
  if (uv && !g.getAttribute('uv')) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}
