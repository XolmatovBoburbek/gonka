// Предметы: радужные кристаллы-"гатя" на трассе, рулетка, Турбо, Звёздная сфера (самонаведение),
// Барьер (щит) и Ледяная ловушка (заморозка). Визуальные эффекты щита, льда и "звёздочек" после удара.
import * as THREE from 'three';
import { toon, glow, outlineMaterial, softCircleTexture } from '../world/toon.js';

export const ITEMS = {
  turbo: { id: 'turbo', name: 'Турбо', desc: 'Мощный рывок вперёд' },
  orb: { id: 'orb', name: 'Звёздная сфера', desc: 'Самонаводится на соперника впереди и закручивает его' },
  shield: { id: 'shield', name: 'Барьер', desc: 'Защищает от одного попадания' },
  ice: { id: 'ice', name: 'Ледяная ловушка', desc: 'Оставьте позади — замораживает того, кто наедет' },
};
export const ITEM_IDS = Object.keys(ITEMS);

/** Выбор предмета с учётом места (лидерам — защита, отстающим — атака и турбо). */
export function rollItem(placeFrac, rnd = Math.random) {
  const f = Math.max(0, Math.min(1, placeFrac));
  const w = {
    turbo: 0.12 + 0.34 * f,
    orb: 0.05 + 0.36 * f,
    shield: 0.4 - 0.28 * f,
    ice: 0.43 - 0.32 * f,
  };
  let total = 0;
  for (const k in w) total += w[k];
  let r = rnd() * total;
  for (const k in w) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return 'turbo';
}

// ------------------------------------------------------------ материалы
function questionTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.font = '900 96px "Russo One", "M PLUS Rounded 1c", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(80,20,120,0.9)';
  g.strokeText('?', S / 2, S / 2 + 6);
  g.fillStyle = '#ffffff';
  g.fillText('?', S / 2, S / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const boxVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  varying float vHue;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * wp;
    vN = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vV = -mvPosition.xyz;
    vHue = float(gl_InstanceID) * 0.17;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const boxFrag = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uQ;
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  varying float vHue;
  #include <fog_pars_fragment>
  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    float f = 1.0 - abs(dot(N, V));
    float hue = fract(f * 0.9 + uTime * 0.25 + vHue + vUv.x * 0.3);
    vec3 rb = hsv2rgb(vec3(hue, 0.6, 1.0));
    float e = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5));
    float edge = smoothstep(0.38, 0.47, e);
    vec4 q = texture2D(uQ, vUv);
    vec3 col = rb * (0.45 + f * 1.1) + vec3(1.0) * edge * 1.6;
    col = mix(col, vec3(2.2), q.a * 0.95);
    float a = clamp(0.4 + f * 0.45 + edge * 0.6 + q.a, 0.0, 1.0);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const shieldVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    vP = position;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;
const shieldFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    float f = clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
    // гексагональная сетка по сферическим координатам
    vec3 p = normalize(vP);
    vec2 uv = vec2(atan(p.z, p.x) * 3.0, p.y * 6.0);
    vec2 g = abs(fract(uv + vec2(uTime * 0.2, 0.0)) - 0.5);
    float grid = smoothstep(0.42, 0.5, max(g.x, g.y));
    float band = smoothstep(0.8, 1.0, sin(p.y * 10.0 - uTime * 4.0));
    float a = (pow(f, 2.2) * 0.9 + grid * 0.35 + band * 0.15) * uAlpha;
    gl_FragColor = vec4(uColor * (0.6 + f * 1.8 + grid), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class ItemSystem {
  constructor(scene, track, fx, opts = {}) {
    this.scene = scene;
    this.track = track;
    this.fx = fx;
    this.group = new THREE.Group();
    this.group.name = 'items';
    scene.add(this.group);
    this.time = 0;

    // --- кристаллы с предметами
    this.boxes = [];
    for (const row of opts.itemRows || []) {
      const s = row * track.length;
      const fr = track.frameAtProgress(s, {});
      const n = 5;
      for (let i = 0; i < n; i++) {
        const lat = (i / (n - 1) - 0.5) * 2 * fr.hw * 0.62;
        const p = fr.pos.clone().addScaledVector(fr.right, lat).addScaledVector(fr.up, 1.25);
        this.boxes.push({ s, lat, pos: p, active: true, timer: 0, scale: 1 });
      }
    }
    const boxMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uQ: { value: null } }]),
      vertexShader: boxVert,
      fragmentShader: boxFrag,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.boxUniforms = boxMat.uniforms;
    this.boxUniforms.uQ.value = questionTexture();
    const boxGeo = new THREE.BoxGeometry(1.35, 1.35, 1.35);
    this.boxMesh = new THREE.InstancedMesh(boxGeo, boxMat, Math.max(1, this.boxes.length));
    this.boxMesh.count = this.boxes.length;
    this.boxMesh.frustumCulled = false;
    this.boxMesh.renderOrder = 3;
    this.group.add(this.boxMesh);
    // светящиеся ореолы вокруг кристаллов — одним объектом Points
    const hg = new THREE.BufferGeometry();
    this.haloPos = new Float32Array(Math.max(1, this.boxes.length) * 3);
    this.boxes.forEach((b, i) => b.pos.toArray(this.haloPos, i * 3));
    hg.setAttribute('position', new THREE.BufferAttribute(this.haloPos, 3));
    this.halos = new THREE.Points(
      hg,
      new THREE.PointsMaterial({ map: softCircleTexture(), color: new THREE.Color(1.5, 1.3, 2.1), size: 3.4, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.halos.frustumCulled = false;
    this.group.add(this.halos);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();

    // --- снаряды и ловушки
    this.orbs = [];
    this.traps = [];
    this.orbGeo = new THREE.SphereGeometry(0.55, 20, 14);
    this.orbCoreMat = glow(0xff7ae6, 2.6);
    this.orbHaloMat = new THREE.SpriteMaterial({ map: softCircleTexture(), color: new THREE.Color(2.4, 0.9, 2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.starGeo = makeStarGeometry(0.28, 0.12, 0.1);
    this.starMat = glow(0xfff38a, 2.2);
    this.iceMat = toon(0xaeefff, { transparent: true, opacity: 0.88, emissive: 0x3aa8ff, emissiveIntensity: 0.55, rim: 0.8 });
    this.iceGeo = makeCrystalCluster();

    // --- визуальные состояния картов
    this.shieldMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x49d8ff) }, uAlpha: { value: 1 } },
      vertexShader: shieldVert,
      fragmentShader: shieldFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.shieldGeo = new THREE.IcosahedronGeometry(2.05, 3);
    this.cubeMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x9fe8ff) }, uAlpha: { value: 1 } },
      vertexShader: shieldVert,
      fragmentShader: shieldFrag.replace('float a = (', 'float a = 0.35 + ('),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.cubeGeo = new THREE.BoxGeometry(2.6, 2.4, 3.3, 2, 2, 2);
    this.kartFx = new Map();
  }

  // ---------------------------------------------------------------- логика
  update(dt, race) {
    this.time += dt;
    this.boxUniforms.uTime.value = this.time;
    this.shieldMat.uniforms.uTime.value = this.time;
    this.cubeMat.uniforms.uTime.value = this.time;

    // кристаллы: вращение, подбор, восстановление
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.active) {
        b.timer -= dt;
        if (b.timer <= 0) {
          b.active = true;
          b.scale = 0.01;
        }
      } else {
        b.scale = Math.min(1, b.scale + dt * 3);
        for (const k of race.karts) {
          const dx = k.pos.x - b.pos.x;
          const dz = k.pos.z - b.pos.z;
          const dy = k.pos.y + 0.8 - b.pos.y;
          if (dx * dx + dz * dz < 2.3 * 2.3 && Math.abs(dy) < 2.4) {
            b.active = false;
            b.timer = 2.6;
            this.fx.rainbowBurst(b.pos, 22);
            k.emit('itemBox');
            if (!k.item && k.roulette <= 0) {
              k.roulette = k.isPlayer ? 1.35 : 0.9 + Math.random() * 0.5;
              k.pendingItem = rollItem((k.place - 1) / Math.max(1, race.karts.length - 1));
              k.emit('rouletteStart');
            }
            break;
          }
        }
      }
      const s = b.active ? b.scale : 0;
      this._e.set(this.time * 0.9 + i, this.time * 1.3 + i * 0.7, 0.4);
      this._q.setFromEuler(this._e);
      const bob = Math.sin(this.time * 2.4 + i) * 0.15;
      this._m.compose(new THREE.Vector3(b.pos.x, b.pos.y + bob, b.pos.z), this._q, new THREE.Vector3(s, s, s));
      this.boxMesh.setMatrixAt(i, this._m);
      this.haloPos[i * 3 + 1] = b.active ? b.pos.y + bob : -9999;
    }
    this.boxMesh.instanceMatrix.needsUpdate = true;
    if (this.boxes.length) this.halos.geometry.attributes.position.needsUpdate = true;

    // рулетка
    for (const k of race.karts) {
      if (k.roulette > 0) {
        k.roulette -= dt;
        if (k.roulette <= 0) {
          k.item = k.pendingItem;
          k.itemHeld = 0;
          k.emit('itemGet', { item: k.item });
        }
      } else if (k.item) k.itemHeld += dt;
    }

    this._updateOrbs(dt, race);
    this._updateTraps(dt, race);
    this._updateKartFx(dt, race);
  }

  use(kart, race) {
    const item = kart.item;
    if (!item || kart.roulette > 0) return false;
    kart.item = null;
    if (item === 'turbo') {
      kart.addBoost(2.0, 1.42, 'item');
      kart.emit('useTurbo');
    } else if (item === 'shield') {
      kart.shieldTimer = 7.5;
      kart.emit('useShield');
    } else if (item === 'orb') {
      this._fireOrb(kart, race);
      kart.emit('useOrb');
    } else if (item === 'ice') {
      this._dropTrap(kart);
      kart.emit('useIce');
    }
    return true;
  }

  _fireOrb(kart, race) {
    const sorted = race.order;
    const idx = sorted.indexOf(kart);
    const target = idx > 0 ? sorted[idx - 1] : null;
    const mesh = new THREE.Group();
    const core = new THREE.Mesh(this.orbGeo, this.orbCoreMat);
    const halo = new THREE.Sprite(this.orbHaloMat);
    halo.scale.set(3.2, 3.2, 1);
    mesh.add(core, halo);
    const stars = [];
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(this.starGeo, this.starMat);
      mesh.add(st);
      stars.push(st);
    }
    const pos = kart.pos.clone().add(new THREE.Vector3(Math.sin(kart.heading) * 2.2, 0.9, Math.cos(kart.heading) * 2.2));
    mesh.position.copy(pos);
    this.group.add(mesh);
    this.orbs.push({
      owner: kart,
      target,
      mesh,
      stars,
      s: kart.progress + 2.2,
      lat: kart.lateral,
      pos,
      speed: Math.max(62, kart.speed + 22),
      life: 7,
      age: 0,
      idx: kart.trackIdx,
    });
  }

  _dropTrap(kart) {
    const s = kart.progress - 3.2;
    const fr = this.track.frameAtProgress(s, {});
    const lat = THREE.MathUtils.clamp(kart.lateral, -fr.hw - 1, fr.hw + 1);
    const pos = fr.pos.clone().addScaledVector(fr.right, lat);
    const mesh = new THREE.Mesh(this.iceGeo, this.iceMat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.2);
    mesh.castShadow = true;
    const ol = new THREE.Mesh(this.iceGeo, outlineMaterial(0x1c3a5a, 0.05));
    mesh.add(ol);
    this.group.add(mesh);
    this.traps.push({ owner: kart, mesh, pos, s, lat, age: 0 });
    this.fx.burst(pos.clone().add(new THREE.Vector3(0, 0.6, 0)), new THREE.Color(0x9fe8ff).multiplyScalar(2), 10, 4, { life: 0.5 });
    if (this.traps.length > 12) this._removeTrap(this.traps[0], false);
  }

  _removeTrap(t, burst = true) {
    if (burst) this.fx.burst(t.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), new THREE.Color(0xb8f2ff).multiplyScalar(2.2), 26, 8, { shape: 1, size: 0.5 });
    this.group.remove(t.mesh);
    this.traps.splice(this.traps.indexOf(t), 1);
  }

  _updateOrbs(dt, race) {
    const tr = this.track;
    const fr = {};
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.age += dt;
      o.life -= dt;
      let homing = false;
      if (o.target && !o.target.finished) {
        const d = o.pos.distanceTo(o.target.pos);
        const ds = tr.deltaProgress(o.s, o.target.progress);
        if (d < 16 || (ds < 12 && ds > -4)) homing = true;
        else o.lat += (o.target.lateral - o.lat) * (1 - Math.exp(-dt * 2.5));
      }
      if (homing) {
        const tgt = o.target.pos.clone().add(new THREE.Vector3(0, 0.8, 0));
        const dir = tgt.sub(o.pos);
        const len = dir.length();
        dir.multiplyScalar(1 / Math.max(len, 1e-3));
        o.pos.addScaledVector(dir, Math.min(len, o.speed * dt));
        const p = tr.project(o.pos, o.idx, {});
        o.idx = p.nearest;
        o.s = p.f * tr.spacing;
        o.lat = p.lateral;
      } else {
        o.s += o.speed * dt;
        tr.frameAtProgress(o.s, fr);
        const lim = fr.hw + fr.wall - 1;
        o.lat = THREE.MathUtils.clamp(o.lat, -lim, lim);
        o.pos.copy(fr.pos).addScaledVector(fr.right, o.lat).addScaledVector(fr.up, 0.9);
        o.idx = fr.index;
      }
      o.mesh.position.copy(o.pos);
      o.mesh.position.y += Math.sin(o.age * 12) * 0.1;
      o.stars.forEach((st, j) => {
        const a = o.age * 9 + (j * Math.PI * 2) / 3;
        st.position.set(Math.cos(a) * 1.0, Math.sin(a * 0.7) * 0.3, Math.sin(a) * 1.0);
        st.rotation.set(a, a * 1.3, 0);
      });
      if (Math.random() < 0.9) {
        this.fx.glowFx.emit({
          pos: o.pos,
          vel: { x: (Math.random() - 0.5) * 2, y: Math.random() * 2, z: (Math.random() - 0.5) * 2 },
          color: new THREE.Color(Math.random() < 0.5 ? 0xff7ae6 : 0xfff38a).multiplyScalar(2),
          size: 0.5,
          sizeEnd: 0.05,
          life: 0.45,
          shape: 1,
        });
      }
      // столкновения
      let done = o.life <= 0;
      if (!done) {
        for (const k of race.karts) {
          if (k === o.owner && o.age < 0.6) continue;
          if (k.finished && k !== o.target) continue;
          const dx = k.pos.x - o.pos.x;
          const dy = k.pos.y + 0.8 - o.pos.y;
          const dz = k.pos.z - o.pos.z;
          if (dx * dx + dy * dy + dz * dz < 1.9 * 1.9) {
            const applied = k.hit('spin', o.owner);
            this.fx.burst(o.pos, new THREE.Color(0xff7ae6).multiplyScalar(2.2), 30, 10);
            this.fx.burst(o.pos, new THREE.Color(0xfff38a).multiplyScalar(2.2), 16, 7);
            race.emitGlobal('orbHit', { kart: k, by: o.owner, applied });
            done = true;
            break;
          }
        }
      }
      if (!done) {
        for (const t of this.traps) {
          if (t.pos.distanceTo(o.pos) < 2) {
            this._removeTrap(t, true);
            this.fx.burst(o.pos, new THREE.Color(0xff7ae6).multiplyScalar(2.2), 20, 8);
            done = true;
            break;
          }
        }
      }
      if (done) {
        if (o.life <= 0) this.fx.burst(o.pos, new THREE.Color(0xff7ae6).multiplyScalar(2), 14, 5);
        this.group.remove(o.mesh);
        this.orbs.splice(i, 1);
      }
    }
  }

  _updateTraps(dt, race) {
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const t = this.traps[i];
      t.age += dt;
      const s = Math.min(1, 0.2 + t.age * 4);
      t.mesh.scale.setScalar(s);
      t.mesh.rotation.y += dt * 0.8;
      if (t.age < 0.35) continue;
      for (const k of race.karts) {
        if (k.finished) continue;
        const dx = k.pos.x - t.pos.x;
        const dz = k.pos.z - t.pos.z;
        const dy = k.pos.y - t.pos.y;
        if (dx * dx + dz * dz < 1.7 * 1.7 && Math.abs(dy) < 1.6 && !k.airborne) {
          const applied = k.hit('freeze', t.owner);
          race.emitGlobal('trapHit', { kart: k, by: t.owner, applied });
          this._removeTrap(t, true);
          break;
        }
      }
    }
  }

  _kartFx(kart) {
    let f = this.kartFx.get(kart);
    if (f) return f;
    const shield = new THREE.Mesh(this.shieldGeo, this.shieldMat);
    shield.position.y = 0.9;
    shield.visible = false;
    shield.renderOrder = 6;
    const cube = new THREE.Mesh(this.cubeGeo, this.cubeMat);
    cube.position.set(0, 1.0, -0.1);
    cube.visible = false;
    cube.renderOrder = 6;
    const dizzy = new THREE.Group();
    dizzy.position.y = 2.35;
    dizzy.visible = false;
    for (let i = 0; i < 4; i++) {
      const st = new THREE.Mesh(this.starGeo, this.starMat);
      dizzy.add(st);
    }
    f = { shield, cube, dizzy, wasShield: false, wasFrozen: false };
    this.kartFx.set(kart, f);
    return f;
  }

  attachKartFx(kart, root) {
    const f = this._kartFx(kart);
    root.add(f.shield, f.cube, f.dizzy);
  }

  _updateKartFx(dt, race) {
    for (const k of race.karts) {
      const f = this.kartFx.get(k);
      if (!f) continue;
      const sh = k.shieldTimer > 0;
      f.shield.visible = sh && (k.shieldTimer > 1.5 || Math.floor(this.time * 10) % 2 === 0);
      if (sh) {
        const pulse = 1 + Math.sin(this.time * 6) * 0.03;
        f.shield.scale.setScalar(pulse);
        f.shield.rotation.y += dt * 0.6;
      }
      if (f.wasShield && !sh) {
        const broke = f.lastShield > 0.15;
        this.fx.burst(k.pos.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Color(0x49d8ff).multiplyScalar(2.2), broke ? 34 : 14, broke ? 9 : 4, { shape: 1 });
      }
      f.wasShield = sh;
      f.lastShield = k.shieldTimer;
      const fr = k.frozenTimer > 0;
      f.cube.visible = fr;
      if (fr) f.cube.scale.setScalar(Math.min(1, 1.3 - k.frozenTimer * 0.2));
      if (f.wasFrozen && !fr) {
        this.fx.burst(k.pos.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Color(0xc8f4ff).multiplyScalar(2.2), 40, 9, { shape: 1, size: 0.55 });
      }
      f.wasFrozen = fr;
      const dz = k.spinTimer > 0;
      f.dizzy.visible = dz;
      if (dz) {
        f.dizzy.children.forEach((st, j) => {
          const a = this.time * 7 + (j * Math.PI * 2) / 4;
          st.position.set(Math.cos(a) * 0.65, Math.sin(a * 2) * 0.08, Math.sin(a) * 0.65);
          st.rotation.set(0, -a, 0.3);
        });
      }
    }
  }

  clear() {
    for (const o of this.orbs) this.group.remove(o.mesh);
    for (const t of this.traps) this.group.remove(t.mesh);
    this.orbs.length = 0;
    this.traps.length = 0;
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }
}

function makeStarGeometry(r1, r2, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? r1 : r2;
    const x = Math.cos(a) * r;
    const y = -Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  g.center();
  return g;
}

function makeCrystalCluster() {
  const geos = [];
  const specs = [
    [0, 0, 0, 0.55, 1.6, 0, 0],
    [0.45, 0, 0.2, 0.38, 1.1, 0.35, -0.3],
    [-0.4, 0, -0.1, 0.4, 1.2, -0.4, 0.2],
    [0.1, 0, -0.45, 0.32, 0.9, 0.1, 0.45],
    [-0.15, 0, 0.45, 0.3, 0.8, -0.2, -0.5],
  ];
  for (const [x, y, z, r, h, rz, rx] of specs) {
    const g = new THREE.OctahedronGeometry(r, 0);
    g.scale(1, h / r / 2 + 0.5, 1);
    g.rotateZ(rz);
    g.rotateX(rx);
    g.translate(x, y + h * 0.45, z);
    geos.push(g.index ? g.toNonIndexed() : g);
  }
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o);
    o += g.attributes.position.array.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
