// Частицы (искры дрифта, пламя, пыль, звёзды, конфетти) и аниме-надписи "БАХ!" над событиями.
import * as THREE from 'three';

let _sparkTex = null;
function sparkleTexture() {
  if (_sparkTex) return _sparkTex;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S * 2;
  c.height = S;
  const g = c.getContext('2d');
  // левая половина — мягкий круг
  let grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  // правая половина — четырёхлучевая звёздочка
  const cx = S * 1.5;
  const cy = S / 2;
  grd = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.22);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(S, 0, S, S);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath();
  const r1 = S * 0.48;
  const r2 = S * 0.07;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? r1 : r2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  _sparkTex = new THREE.CanvasTexture(c);
  _sparkTex.colorSpace = THREE.SRGBColorSpace;
  return _sparkTex;
}

const pVert = /* glsl */ `
  attribute vec4 aColor;
  attribute vec2 aSizeShape;
  attribute float aRot;
  uniform float uScale;
  varying vec4 vColor;
  varying float vShape;
  varying float vRot;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSizeShape.x * uScale / max(0.1, -mvPosition.z);
    vColor = aColor;
    vShape = aSizeShape.y;
    vRot = aRot;
    #include <fog_vertex>
  }
`;
const pFrag = /* glsl */ `
  uniform sampler2D uTex;
  varying vec4 vColor;
  varying float vShape;
  varying float vRot;
  #include <fog_pars_fragment>
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
    if (vShape > 1.5) {
      // конфетти — прямоугольник
      if (abs(uv.x - 0.5) > 0.42 || abs(uv.y - 0.5) > 0.22) discard;
      gl_FragColor = vColor;
    } else {
      vec2 tuv = vec2(uv.x * 0.5 + (vShape > 0.5 ? 0.5 : 0.0), uv.y);
      vec4 t = texture2D(uTex, tuv);
      gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
    }
    if (gl_FragColor.a < 0.01) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class ParticleSystem {
  constructor(max = 2000, { additive = true } = {}) {
    this.max = max;
    this.count = 0;
    this.cursor = 0;
    this.firstFree = 0; // все слоты ниже — живые: частицы лежат плотно, в видеокарту уходит только начало буфера
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 4);
    this.sizes = new Float32Array(max * 2);
    this.rots = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSizeShape', new THREE.BufferAttribute(this.sizes, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rots, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    this.alive = new Uint8Array(max);
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 }, uTex: { value: null } }]);
    this.uniforms.uTex.value = sparkleTexture();
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: pVert,
      fragmentShader: pFrag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.budget = 1;
  }

  emit(o) {
    if (this.budget < 1 && Math.random() > this.budget) return;
    let i = -1;
    for (let j = this.firstFree; j < this.max; j++) {
      if (!this.alive[j]) {
        i = j;
        break;
      }
    }
    if (i < 0) {
      // пул полон — перезаписываем по кругу
      i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
    } else this.firstFree = i + 1;
    this.alive[i] = 1;
    const p = o.pos;
    this.positions[i * 3] = p.x;
    this.positions[i * 3 + 1] = p.y;
    this.positions[i * 3 + 2] = p.z;
    const v = o.vel || { x: 0, y: 0, z: 0 };
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    const c = o.color;
    this.base[i * 3] = c.r;
    this.base[i * 3 + 1] = c.g;
    this.base[i * 3 + 2] = c.b;
    this.alpha0[i] = o.alpha ?? 1;
    this.life[i] = 0;
    this.maxLife[i] = o.life ?? 0.6;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.size0[i] = o.size ?? 0.4;
    this.size1[i] = o.sizeEnd ?? (o.size ?? 0.4) * 0.3;
    this.sizes[i * 2 + 1] = o.shape ?? 0;
    this.rots[i] = o.rot ?? Math.random() * 6.28;
    this.spin[i] = o.spin ?? 0;
    if (i + 1 > this.count) this.count = i + 1;
  }

  update(dt, camera, viewportHeight) {
    const fovRad = (camera.fov * Math.PI) / 180;
    this.uniforms.uScale.value = viewportHeight / (2 * Math.tan(fovRad / 2));
    let last = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) {
        this.colors[i * 4 + 3] = 0;
        this.sizes[i * 2] = 0;
        continue;
      }
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      if (t >= 1) {
        this.alive[i] = 0;
        if (i < this.firstFree) this.firstFree = i;
        this.colors[i * 4 + 3] = 0;
        this.sizes[i * 2] = 0;
        continue;
      }
      last = i + 1;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= dr;
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.rots[i] += this.spin[i] * dt;
      const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      this.colors[i * 4] = this.base[i * 3];
      this.colors[i * 4 + 1] = this.base[i * 3 + 1];
      this.colors[i * 4 + 2] = this.base[i * 3 + 2];
      this.colors[i * 4 + 3] = this.alpha0[i] * Math.max(0, fade);
      this.sizes[i * 2] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
    }
    this.count = last;
    this.geo.setDrawRange(0, this.count);
    if (!this.count) return;
    // загружаем только живую часть буфера, а не весь пул
    const g = this.geo.attributes;
    for (const a of [g.position, g.aColor, g.aSizeShape, g.aRot]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  clear() {
    this.alive.fill(0);
    this.firstFree = 0;
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }
}

// ------------------------------------------------------------- аниме-надписи
const popupCache = new Map();
function popupTexture(text, color, stroke) {
  const key = text + color + stroke;
  if (popupCache.has(key)) return popupCache.get(key);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.translate(256, 128);
  g.rotate(-0.12);
  g.font = '900 120px "Russo One", "M PLUS Rounded 1c", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 26;
  g.strokeStyle = '#ffffff';
  g.strokeText(text, 0, 0);
  g.lineWidth = 14;
  g.strokeStyle = stroke;
  g.strokeText(text, 0, 0);
  const grd = g.createLinearGradient(0, -60, 0, 60);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.45, color);
  grd.addColorStop(1, color);
  g.fillStyle = grd;
  g.fillText(text, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  popupCache.set(key, tex);
  return tex;
}

export class Popups {
  constructor(scene, n = 8) {
    this.items = [];
    for (let i = 0; i < n; i++) {
      // карта-заглушка сразу: смена одной текстуры на другую не требует новой шейдерной программы посреди гонки
      const mat = new THREE.SpriteMaterial({ map: sparkleTexture(), transparent: true, depthTest: false, depthWrite: false, fog: false });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.renderOrder = 20;
      scene.add(s);
      this.items.push({ sprite: s, t: 0, life: 0, target: null, offset: new THREE.Vector3() });
    }
    this.cursor = 0;
  }
  show(text, target, { color = '#ffcf33', stroke = '#ff3a6a', life = 0.9, scale = 3, offsetY = 2.6 } = {}) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.sprite.material.map = popupTexture(text, color, stroke);
    it.sprite.visible = true;
    it.t = 0;
    it.life = life;
    it.scale = scale;
    it.target = target;
    it.offset.set((Math.random() - 0.5) * 0.8, offsetY, 0);
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.sprite.visible) continue;
      it.t += dt;
      const u = it.t / it.life;
      if (u >= 1) {
        it.sprite.visible = false;
        continue;
      }
      const pop = u < 0.15 ? 0.4 + (u / 0.15) * 0.8 : u < 0.25 ? 1.2 - ((u - 0.15) / 0.1) * 0.2 : 1;
      it.sprite.scale.set(it.scale * pop * 2, it.scale * pop, 1);
      it.sprite.material.opacity = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
      if (it.target) it.sprite.position.copy(it.target).add(it.offset).add(new THREE.Vector3(0, u * 1.2, 0));
    }
  }
  clear() {
    for (const it of this.items) it.sprite.visible = false;
  }
}

// ------------------------------------------------------------- набор эффектов
const C = (hex) => new THREE.Color(hex);
export const DRIFT_COLORS = [C(0xffffff), C(0x55b8ff).multiplyScalar(2.2), C(0xffa53a).multiplyScalar(2.2), C(0xff55e0).multiplyScalar(2.4)];

export class Effects {
  constructor(scene) {
    this.glowFx = new ParticleSystem(2600, { additive: true });
    this.puffFx = new ParticleSystem(1400, { additive: false });
    scene.add(this.glowFx.points, this.puffFx.points);
    this.popups = new Popups(scene);
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
  }

  setBudget(b) {
    this.glowFx.budget = b;
    this.puffFx.budget = b;
  }

  sparks(pos, dirX, dirZ, level, count = 2) {
    const col = DRIFT_COLORS[level] || DRIFT_COLORS[0];
    for (let i = 0; i < count; i++) {
      this.glowFx.emit({
        pos,
        vel: { x: dirX * (2 + Math.random() * 4) + (Math.random() - 0.5) * 4, y: 2 + Math.random() * 4, z: dirZ * (2 + Math.random() * 4) + (Math.random() - 0.5) * 4 },
        color: col,
        size: 0.35 + Math.random() * 0.3 + level * 0.06,
        sizeEnd: 0.05,
        life: 0.25 + Math.random() * 0.25,
        gravity: 14,
        shape: Math.random() < 0.35 ? 1 : 0,
      });
    }
  }

  flame(pos, back, color = C(0xff8a3c).multiplyScalar(2.5)) {
    this.glowFx.emit({
      pos,
      vel: { x: back.x * 6 + (Math.random() - 0.5), y: 0.5 + Math.random(), z: back.z * 6 + (Math.random() - 0.5) },
      color,
      size: 0.7 + Math.random() * 0.4,
      sizeEnd: 0.1,
      life: 0.22,
      drag: 3,
    });
  }

  dust(pos, color = C(0xcbb89a), amount = 1) {
    this.puffFx.emit({
      pos,
      vel: { x: (Math.random() - 0.5) * 2, y: 0.8 + Math.random() * 1.2, z: (Math.random() - 0.5) * 2 },
      color,
      alpha: 0.55 * amount,
      size: 0.8,
      sizeEnd: 2.4,
      life: 0.7 + Math.random() * 0.4,
      drag: 1.5,
    });
  }

  smoke(pos, color = C(0xffffff)) {
    this.puffFx.emit({
      pos,
      vel: { x: (Math.random() - 0.5) * 1.5, y: 1 + Math.random(), z: (Math.random() - 0.5) * 1.5 },
      color,
      alpha: 0.6,
      size: 1.2,
      sizeEnd: 3.5,
      life: 0.9,
      drag: 1.2,
    });
  }

  burst(pos, color, n = 24, speed = 9, { shape = 1, size = 0.6, gravity = 6, life = 0.7 } = {}) {
    const c = color.isColor ? color : C(color);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.5 + Math.random() * 0.6);
      this.glowFx.emit({
        pos,
        vel: { x: Math.sin(ph) * Math.cos(th) * sp, y: Math.abs(Math.cos(ph)) * sp * 0.8 + 2, z: Math.sin(ph) * Math.sin(th) * sp },
        color: c,
        size: size * (0.6 + Math.random() * 0.8),
        sizeEnd: 0.05,
        life: life * (0.7 + Math.random() * 0.6),
        gravity,
        drag: 1.6,
        shape,
        spin: (Math.random() - 0.5) * 8,
      });
    }
  }

  rainbowBurst(pos, n = 26) {
    for (let i = 0; i < n; i++) {
      const c = new THREE.Color().setHSL(Math.random(), 0.9, 0.6).multiplyScalar(2.2);
      const th = Math.random() * Math.PI * 2;
      const sp = 5 + Math.random() * 6;
      this.glowFx.emit({
        pos,
        vel: { x: Math.cos(th) * sp, y: 2 + Math.random() * 6, z: Math.sin(th) * sp },
        color: c,
        size: 0.5 + Math.random() * 0.5,
        sizeEnd: 0.05,
        life: 0.6 + Math.random() * 0.4,
        gravity: 10,
        drag: 1.2,
        shape: 1,
        spin: 6,
      });
    }
  }

  confetti(pos, n = 60, spread = 6) {
    const cols = [0xff5d93, 0xffd23f, 0x39f3ff, 0x7dff7a, 0xb77dff, 0xffffff];
    for (let i = 0; i < n; i++) {
      this.puffFx.emit({
        pos: { x: pos.x + (Math.random() - 0.5) * spread, y: pos.y + Math.random() * 2, z: pos.z + (Math.random() - 0.5) * spread },
        vel: { x: (Math.random() - 0.5) * 6, y: 6 + Math.random() * 7, z: (Math.random() - 0.5) * 6 },
        color: C(cols[i % cols.length]),
        alpha: 1,
        size: 0.45,
        sizeEnd: 0.4,
        life: 2.2 + Math.random(),
        gravity: 6,
        drag: 1.6,
        shape: 2,
        spin: (Math.random() - 0.5) * 12,
      });
    }
  }

  update(dt, camera, viewportHeight) {
    this.glowFx.update(dt, camera, viewportHeight);
    this.puffFx.update(dt, camera, viewportHeight);
    this.popups.update(dt);
  }

  clear() {
    this.glowFx.clear();
    this.puffFx.clear();
    this.popups.clear();
  }
}
