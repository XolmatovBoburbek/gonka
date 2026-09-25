// Камера от третьего лица: мягкое следование, "раскачка" в поворотах, FOV от скорости, тряска.
// Плюс режимы для меню (облёт), интро перед стартом и финиша.
import * as THREE from 'three';

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 10, -10);
    this.look = new THREE.Vector3();
    this.headingSm = 0;
    this.fov = 70;
    this.shakeAmp = 0;
    this.shakeTime = 0;
    this.roll = 0;
    this.lookBack = false;
    this.orbitAngle = 0;
    this.distScale = 1;
    this.track = null; // если задана — камера не выходит за стены трассы
    this._pr = {};
  }

  /** За стенами стоят щиты, столбы и опоры: камера внутри них закрывает экран тёмной плитой. */
  _keepInTrack(kart) {
    if (!this.track) return;
    const pr = this.track.project(this.pos, kart.trackIdx, this._pr);
    const lim = pr.hw + pr.wall - 0.9;
    if (Math.abs(pr.lateral) > lim) this.pos.addScaledVector(pr.right, Math.sign(pr.lateral) * lim - pr.lateral);
  }

  shake(amount) {
    this.shakeAmp = Math.min(1.2, Math.max(this.shakeAmp, amount));
  }

  snapChase(kart) {
    this.headingSm = kart.camHeading;
    const fwd = new THREE.Vector3(Math.sin(this.headingSm), 0, Math.cos(this.headingSm));
    this.pos.copy(kart.pos).addScaledVector(fwd, -5.8).add(new THREE.Vector3(0, 2.4, 0));
    this.look.copy(kart.pos).addScaledVector(fwd, 4).add(new THREE.Vector3(0, 1.3, 0));
    this._apply(0);
  }

  updateChase(dt, kart) {
    const k = 1 - Math.exp(-dt * 6.5);
    // камера идёт по ходу движения, а не за носом: в заносе машинку видно боком
    this.headingSm = lerpAngle(this.headingSm, kart.camHeading, k);
    const sp = Math.abs(kart.speed);
    const s01 = Math.min(1.4, sp / 40);
    const boosting = kart.boost.time > 0;
    const fwd = new THREE.Vector3(Math.sin(this.headingSm), 0, Math.cos(this.headingSm));
    const dir = this.lookBack ? -1 : 1;
    const dist = (5.5 + s01 * 1.1 + (boosting ? 0.7 : 0)) * this.distScale;
    const height = (2.25 + s01 * 0.3) * this.distScale;
    const desired = new THREE.Vector3().copy(kart.pos).addScaledVector(fwd, -dist * dir);
    desired.y = kart.pos.y + height;
    // на высокой скорости (буст) камера держится плотнее — иначе машинка "улетает" вдаль
    const kp = this.lookBack ? 1 : 1 - Math.exp(-dt * (11 + Math.max(0, Math.min(2, sp / 40) - 1) * 20));
    this.pos.lerp(desired, kp);
    // не опускаться ниже карта
    if (this.pos.y < kart.pos.y + 1.1) this.pos.y = kart.pos.y + 1.1;
    this._keepInTrack(kart);
    const lookT = new THREE.Vector3().copy(kart.pos).addScaledVector(fwd, 4.5 * dir);
    lookT.y = kart.pos.y + 1.25;
    this.look.lerp(lookT, this.lookBack ? 1 : 1 - Math.exp(-dt * 14));
    const stackFov = boosting ? Math.min(2, kart.boost.stack - 1) * 2 : 0; // сложенные бусты — ещё шире
    const targetFov = Math.min(92, 66 + s01 * 9 + (boosting ? (kart.boost.kind === 'boost3' ? 11 : 9) : 0) + stackFov);
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 4));
    const targetRoll = kart.drift.active ? -kart.drift.dir * 0.035 : -kart.steer * 0.012 * s01;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-dt * 5));
    this._apply(dt);
  }

  updateOrbit(dt, center, radius = 16, height = 6, speed = 0.12, lookHeight = 1) {
    this.orbitAngle += dt * speed;
    this.pos.set(center.x + Math.cos(this.orbitAngle) * radius, center.y + height, center.z + Math.sin(this.orbitAngle) * radius);
    this.look.set(center.x, center.y + lookHeight, center.z);
    this.fov += (58 - this.fov) * (1 - Math.exp(-dt * 3));
    this.roll *= 0.9;
    this._apply(dt);
  }

  /** Облёт перед стартом: t — секунды с начала интро. */
  updateIntro(dt, t, center, heading, kart) {
    const fwd = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const right = new THREE.Vector3(-Math.cos(heading), 0, Math.sin(heading));
    if (t < 3.2) {
      const u = t / 3.2;
      const e = u * u * (3 - 2 * u);
      const a = -1.1 + e * 1.9;
      const r = 34 - e * 16;
      const p = center.clone().addScaledVector(fwd, Math.cos(a) * r).addScaledVector(right, Math.sin(a) * r);
      p.y = center.y + 16 - e * 10;
      this.pos.copy(p);
      this.look.copy(center).addScaledVector(fwd, 6 - e * 8);
      this.look.y = center.y + 1.5;
      this.fov = 55;
      this._apply(dt);
    } else {
      // плавный переход за спину игрока
      const u = Math.min(1, (t - 3.2) / 1.1);
      const e = u * u * (3 - 2 * u);
      const kf = new THREE.Vector3(Math.sin(kart.heading), 0, Math.cos(kart.heading));
      const chasePos = kart.pos.clone().addScaledVector(kf, -5.8);
      chasePos.y = kart.pos.y + 2.4;
      const chaseLook = kart.pos.clone().addScaledVector(kf, 4.5);
      chaseLook.y = kart.pos.y + 1.25;
      this.pos.lerp(chasePos, e);
      this.look.lerp(chaseLook, e);
      this.fov += (66 - this.fov) * e;
      this.headingSm = kart.heading;
      this._apply(dt);
    }
  }

  updateFinish(dt, kart) {
    this.orbitAngle += dt * 0.35;
    const a = kart.heading + Math.PI * 0.75 + this.orbitAngle;
    const desired = kart.pos.clone().add(new THREE.Vector3(Math.sin(a) * 7, 2.6, Math.cos(a) * 7));
    const lookT = kart.pos.clone();
    lookT.y += 1.2;
    if (this.snapNext) {
      this.snapNext = false;
      this.pos.copy(desired);
      this.look.copy(lookT);
    }
    this.pos.lerp(desired, 1 - Math.exp(-dt * 3));
    this.look.lerp(lookT, 1 - Math.exp(-dt * 6));
    this.fov += (52 - this.fov) * (1 - Math.exp(-dt * 2));
    this.roll *= 0.95;
    this._apply(dt);
  }

  _apply(dt) {
    const cam = this.camera;
    cam.position.copy(this.pos);
    if (this.shakeAmp > 0.001) {
      this.shakeTime += dt;
      const a = this.shakeAmp;
      cam.position.x += Math.sin(this.shakeTime * 61) * 0.18 * a;
      cam.position.y += Math.sin(this.shakeTime * 47 + 1.3) * 0.14 * a;
      cam.position.z += Math.cos(this.shakeTime * 53) * 0.18 * a;
      this.shakeAmp *= Math.exp(-dt * 7);
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    if (Math.abs(this.roll) > 1e-4) cam.rotateZ(this.roll);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
