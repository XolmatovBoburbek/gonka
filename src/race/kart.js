// Аркадная физика карта в "пространстве трассы": газ/тормоз, руление, дрифт с мини-турбо,
// подпрыгивания, трамплины и трюки, стены, бездорожье, заносы от попаданий.
import * as THREE from 'three';
import { rampHeightAt } from '../world/trackMeshes.js';

export const PHYS = {
  maxSpeed: 40,
  accel: 26,
  reverseMax: 11,
  brake: 42,
  drag: 7,
  offroadFactor: 0.55,
  turnRate: 2.05,
  gravity: 34,
  hopVel: 5.2,
  radius: 1.15,
  curbWidth: 1.5,
  driftMinSpeed: 13,
  driftLevels: [0.95, 2.05, 3.3],
  miniTurbo: [
    [0.55, 1.2],
    [0.95, 1.26],
    [1.45, 1.32],
  ],
};

const _tmp = new THREE.Vector3();

export class Kart {
  constructor({ index, char, isPlayer = false, track }) {
    this.index = index;
    this.char = char;
    this.isPlayer = isPlayer;
    this.track = track;
    const st = char.stats;
    this.speedF = 1 + (st.speed - 3) * 0.028;
    this.accelF = 1 + (st.accel - 3) * 0.13;
    this.handF = 1 + (st.handling - 3) * 0.07;
    this.driftF = 1 + (st.handling - 3) * 0.08;
    this.rubber = 1;
    this.botSpeed = 1;

    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.vy = 0;
    this.airborne = false;
    this.airTime = 0;
    this.push = new THREE.Vector2();
    this.steer = 0;
    this.throttle = 0;

    this.drift = { active: false, dir: 0, charge: 0, level: 0, intent: false };
    this.boost = { time: 0, power: 1, kind: '' };
    this.spinTimer = 0;
    this.spinAngle = 0;
    this.frozenTimer = 0;
    this.invuln = 0;
    this.shieldTimer = 0;
    this.trick = { active: false, t: 0, pending: false, canTrick: false };
    this.hop = 0;

    this.item = null;
    this.roulette = 0; // > 0 — идёт рулетка
    this.itemHeld = 0;

    this.proj = {};
    this.trackIdx = -1;
    this.lateral = 0;
    this.progress = 0;
    this.lapsDone = -1;
    this.totalProgress = 0;
    this.offroad = false;
    this.onCurb = false;
    this.surfaceUp = new THREE.Vector3(0, 1, 0);
    this.rampZone = null;

    this.finished = false;
    this.finishTime = 0;
    this.place = 0;
    this.lapTimes = [];
    this.lapStart = 0;
    this.wrongWayTimer = 0;
    this.wrongWay = false;
    this.stuckTimer = 0;
    this.events = [];
    this.lastHitBy = null;
  }

  get forward() {
    return _tmp.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  get boosting() {
    return this.boost.time > 0;
  }

  get controllable() {
    return this.spinTimer <= 0 && this.frozenTimer <= 0;
  }

  emit(type, data = {}) {
    this.events.push({ type, kart: this, ...data });
  }

  placeAt(progress, lateral) {
    const fr = this.track.frameAtProgress(progress, {});
    this.pos.copy(fr.pos).addScaledVector(fr.right, lateral);
    this.prevPos.copy(this.pos);
    this.heading = Math.atan2(fr.tan.x, fr.tan.z);
    this.trackIdx = fr.index;
    this.track.project(this.pos, this.trackIdx, this.proj);
    this.progress = this.proj.f * this.track.spacing;
    this.lateral = this.proj.lateral;
    this.surfaceUp.copy(fr.up);
  }

  addBoost(time, power, kind) {
    if (this.boost.time <= 0 || power >= this.boost.power) {
      this.boost.power = power;
      this.boost.kind = kind;
    }
    this.boost.time = Math.max(this.boost.time, time);
    this.emit('boost', { kind });
  }

  /** Попадание: 'spin' (сфера) или 'freeze' (лёд). Возвращает true, если эффект применён. */
  hit(kind, by = null) {
    if (this.invuln > 0) return false;
    if (this.shieldTimer > 0) {
      this.shieldTimer = 0;
      this.invuln = 0.6;
      this.emit('shieldBreak');
      return false;
    }
    this.lastHitBy = by;
    this.cancelDrift(false);
    this.boost.time = 0;
    if (kind === 'freeze') {
      this.frozenTimer = 1.5;
      this.invuln = 2.6;
    } else {
      this.spinTimer = 1.05;
      this.invuln = 2.2;
    }
    this.emit('hit', { kind, by });
    return true;
  }

  cancelDrift(release = true) {
    const d = this.drift;
    if (!d.active) {
      d.intent = false;
      return;
    }
    if (release && d.level > 0) {
      const [t, p] = PHYS.miniTurbo[d.level - 1];
      this.addBoost(t, p, 'mini' + d.level);
      this.emit('miniTurbo', { level: d.level });
    }
    d.active = false;
    d.charge = 0;
    d.level = 0;
    d.dir = 0;
    d.intent = false;
  }

  respawn() {
    const back = this.progress - 4;
    this.placeAt(back, 0);
    this.speed = 0;
    this.vy = 0;
    this.airborne = false;
    this.push.set(0, 0);
    this.cancelDrift(false);
    this.spinTimer = 0;
    this.frozenTimer = 0;
    this.invuln = 2;
    this.stuckTimer = 0;
    this.emit('respawn');
  }

  /**
   * Шаг физики.
   * input: { steer, throttle, brake, driftHeld, driftPressed }
   * env: { boostZones, rampZones, raceTime }
   */
  step(dt, input, env) {
    const P = PHYS;
    const track = this.track;
    this.prevPos.copy(this.pos);

    // таймеры
    if (this.boost.time > 0) this.boost.time = Math.max(0, this.boost.time - dt);
    if (this.invuln > 0) this.invuln -= dt;
    if (this.shieldTimer > 0) this.shieldTimer -= dt;
    if (this.spinTimer > 0) {
      this.spinTimer -= dt;
      this.spinAngle += dt * 13;
      if (this.spinTimer <= 0) this.spinAngle = 0;
    }
    if (this.frozenTimer > 0) {
      this.frozenTimer -= dt;
      if (this.frozenTimer <= 0) this.emit('unfreeze');
    }

    const ctrl = this.controllable && !this.finishedCoast;
    let throttle = ctrl ? input.throttle : 0;
    const brake = ctrl ? input.brake : 0;
    const steerIn = ctrl ? input.steer : 0;
    this.throttle = throttle;
    this.steer += (steerIn - this.steer) * (1 - Math.exp(-dt * 11));

    const boosting = this.boost.time > 0;
    const vmaxBase = P.maxSpeed * this.speedF * this.rubber * this.botSpeed;
    let vmax = vmaxBase;
    if (this.offroad && !boosting) vmax *= P.offroadFactor;
    if (boosting) vmax = vmaxBase * this.boost.power;

    // ---- продольная динамика
    if (this.frozenTimer > 0) {
      this.speed *= Math.exp(-dt * 7);
    } else if (this.spinTimer > 0) {
      this.speed *= Math.exp(-dt * 2.2);
    } else if (!this.airborne) {
      if (boosting) {
        if (this.speed < vmax) this.speed = Math.min(vmax, this.speed + 75 * dt);
      } else if (throttle > 0.01) {
        if (this.speed < 0) this.speed += P.brake * dt;
        else if (this.speed < vmax) {
          const k = 1 - (this.speed / vmax) ** 2;
          this.speed = Math.min(vmax, this.speed + P.accel * this.accelF * throttle * Math.max(0.1, k) * dt);
        }
      }
      if (brake > 0.01 && !boosting) {
        if (this.speed > 0.5) this.speed -= P.brake * brake * dt;
        else this.speed = Math.max(-P.reverseMax, this.speed - P.accel * 0.6 * brake * dt);
      }
      if (throttle <= 0.01 && brake <= 0.01 && !boosting) {
        const d = P.drag * dt;
        this.speed = Math.abs(this.speed) < d ? 0 : this.speed - Math.sign(this.speed) * d;
      }
      if (this.speed > vmax) this.speed = Math.max(vmax, this.speed - (this.offroad ? 50 : 16) * dt);
    } else {
      this.speed *= Math.exp(-dt * 0.08);
    }

    // ---- дрифт
    const d = this.drift;
    if (ctrl && input.driftPressed && !this.airborne) {
      this.vy = P.hopVel;
      this.airborne = true;
      this.airTime = 0;
      this.hop = 1;
      d.intent = true;
      this.emit('hop');
    }
    if (ctrl && input.driftPressed && this.airborne && this.trick.canTrick && !this.trick.active) {
      this.trick.active = true;
      this.trick.t = 0;
      this.trick.pending = true;
      this.emit('trick');
    }
    if (!input.driftHeld) {
      if (d.active) this.cancelDrift(true);
      d.intent = false;
    }
    if (d.active) {
      if (Math.abs(this.speed) < 9 || !ctrl) this.cancelDrift(false);
      else if (!this.airborne) {
        const tight = this.steer * d.dir;
        d.charge += dt * (0.75 + 0.55 * Math.max(0, tight)) * this.driftF;
        const lv = d.charge >= P.driftLevels[2] ? 3 : d.charge >= P.driftLevels[1] ? 2 : d.charge >= P.driftLevels[0] ? 1 : 0;
        if (lv > d.level) {
          d.level = lv;
          this.emit('driftLevel', { level: lv });
        }
      }
    }

    // ---- руление
    const absV = Math.abs(this.speed);
    const sf = Math.min(1, absV / 7) * (1 - 0.3 * THREE.MathUtils.clamp((absV - 20) / 24, 0, 1));
    let yawRate;
    if (d.active) {
      const tight = this.steer * d.dir;
      yawRate = -d.dir * P.turnRate * this.handF * (0.74 + 0.44 * tight) * Math.max(sf, 0.6);
    } else {
      yawRate = -this.steer * P.turnRate * this.handF * sf * (this.speed < -0.5 ? -1 : 1);
    }
    if (this.airborne) yawRate *= this.hop > 0 ? 0.8 : 0.3;
    if (this.spinTimer > 0 || this.frozenTimer > 0) yawRate = 0;
    this.heading += yawRate * dt;

    // ---- перемещение
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    let vx = fx * this.speed + this.push.x;
    let vz = fz * this.speed + this.push.y;
    if (d.active) {
      const slide = -d.dir * this.speed * 0.1;
      vx += -fz * slide;
      vz += fx * slide;
    }
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;
    this.push.multiplyScalar(Math.exp(-dt * 4.5));

    // ---- проекция на трассу
    const pr = track.project(this.pos, this.trackIdx, this.proj);
    this.trackIdx = pr.nearest;
    const lim = pr.hw + pr.wall - P.radius;
    if (Math.abs(pr.lateral) > lim) {
      const side = Math.sign(pr.lateral);
      const pen = Math.abs(pr.lateral) - lim;
      this.pos.x -= pr.right.x * side * pen;
      this.pos.z -= pr.right.z * side * pen;
      const nx = -side * pr.right.x;
      const nz = -side * pr.right.z;
      const nl = Math.hypot(nx, nz) || 1;
      const into = -(fx * nx + fz * nz) / nl;
      if (into > 0.02) {
        const tx = fx + (nx / nl) * into * 1.08;
        const tz = fz + (nz / nl) * into * 1.08;
        this.heading = Math.atan2(tx, tz);
        const loss = Math.min(0.65, into * 0.85);
        const before = this.speed;
        this.speed *= 1 - loss;
        if (into > 0.28 && before > 12) {
          this.emit('wallHit', { strength: into });
          if (into > 0.5) this.cancelDrift(false);
        }
      }
      // гасим составляющую толчка в стену
      const pn = this.push.x * (nx / nl) + this.push.y * (nz / nl);
      if (pn < 0) {
        this.push.x -= (nx / nl) * pn * 1.5;
        this.push.y -= (nz / nl) * pn * 1.5;
      }
      pr.lateral = side * lim;
    }
    this.lateral = pr.lateral;
    this.onCurb = Math.abs(pr.lateral) > pr.hw && Math.abs(pr.lateral) <= pr.hw + P.curbWidth;
    this.offroad = Math.abs(pr.lateral) > pr.hw + P.curbWidth;

    // ---- прогресс и круги
    const newProg = pr.f * track.spacing;
    const delta = newProg - this.progress;
    if (delta < -track.length / 2) {
      this.lapsDone++;
      this.emit('lapCross', { forward: true });
    } else if (delta > track.length / 2) {
      this.lapsDone--;
      this.emit('lapCross', { forward: false });
    }
    this.progress = newProg;
    this.totalProgress = this.lapsDone * track.length + this.progress;

    // ---- высота: дорога, трамплины, полёт
    let surf = pr.pos.y + pr.right.y * pr.lateral;
    let onRamp = null;
    for (const z of env.rampZones || []) {
      if (Math.abs(this.lateral - z.lat) < z.halfW && this.progress >= z.s0 && this.progress <= z.s1) {
        onRamp = z;
        surf += rampHeightAt(z, (this.progress - z.s0) / z.len);
      }
    }
    if (this.rampZone && !onRamp && !this.airborne && this.speed > 8) {
      // сорвались с кромки трамплина
      this.vy = 6 + this.speed * 0.2;
      this.airborne = true;
      this.airTime = 0;
      this.hop = 0;
      this.trick.canTrick = true;
      this.emit('jump');
    }
    this.rampZone = onRamp;

    if (this.airborne) {
      this.airTime += dt;
      this.vy -= P.gravity * dt;
      this.pos.y += this.vy * dt;
      if (this.trick.active) this.trick.t += dt;
      if (this.pos.y <= surf && this.vy <= 0) {
        this.pos.y = surf;
        const impact = -this.vy;
        this.airborne = false;
        this.vy = 0;
        const wasHop = this.hop > 0;
        this.hop = 0;
        if (this.trick.pending) {
          this.addBoost(0.9, 1.25, 'trick');
          this.emit('trickBoost');
        }
        this.trick.active = false;
        this.trick.pending = false;
        this.trick.canTrick = false;
        if (impact > 9) this.emit('land', { impact });
        // начало дрифта после подпрыгивания
        if (wasHop && d.intent && input.driftHeld && Math.abs(this.steer) > 0.22 && this.speed > P.driftMinSpeed && ctrl) {
          d.active = true;
          d.dir = Math.sign(this.steer);
          d.charge = 0;
          d.level = 0;
          this.emit('driftStart');
        }
      } else if (this.pos.y < surf - 30) {
        this.respawn();
      }
    } else {
      // если земля "уходит" быстрее, чем тянет гравитация (крутой гребень) — отрываемся
      const yFree = this.pos.y + this.vy * dt - 0.5 * P.gravity * dt * dt;
      if (surf < yFree - 0.02 && this.speed > 20 && !onRamp) {
        this.airborne = true;
        this.airTime = 0;
        this.hop = 0;
        this.pos.y = yFree;
        this.vy -= P.gravity * dt;
      } else {
        this.vy = THREE.MathUtils.clamp((surf - this.pos.y) / Math.max(dt, 1e-4), -25, 25);
        this.pos.y = surf;
      }
    }
    this.surfaceUp.lerp(pr.up, 1 - Math.exp(-dt * 10)).normalize();

    // ---- бустеры на дороге
    if (!this.airborne) {
      for (const z of env.boostZones || []) {
        if (Math.abs(this.lateral - z.lat) < z.halfW + 0.4 && this.progress >= z.s0 && this.progress <= z.s1) {
          if (this.boost.time < 0.9 || this.boost.kind !== 'pad') this.addBoost(1.15, 1.34, 'pad');
        }
      }
    }

    // ---- неправильное направление / застревание
    const along = fx * pr.tan.x + fz * pr.tan.z;
    if (along < -0.35 && this.speed > 4) this.wrongWayTimer += dt;
    else this.wrongWayTimer = Math.max(0, this.wrongWayTimer - dt * 2);
    const ww = this.wrongWayTimer > 1.2;
    if (ww !== this.wrongWay) {
      this.wrongWay = ww;
      this.emit('wrongWay', { on: ww });
    }
    if (ctrl && throttle > 0.5 && Math.abs(this.speed) < 2.5 && !this.airborne) this.stuckTimer += dt;
    else this.stuckTimer = Math.max(0, this.stuckTimer - dt);
    if (this.stuckTimer > (this.isPlayer ? 5 : 2.5)) this.respawn();
  }

  /** Визуальное состояние для модели. */
  visualState() {
    return {
      speed: this.speed,
      maxSpeed: PHYS.maxSpeed,
      steer: this.steer,
      drifting: this.drift.active,
      driftDir: this.drift.dir,
      boosting: this.boost.time > 0,
      boostKind: this.boost.kind,
      airborne: this.airborne,
      spin: this.spinTimer > 0 ? this.spinAngle : 0,
      hop: 0,
      trick: this.trick.active ? Math.min(1, this.trick.t / 0.45) * Math.PI * 2 : 0,
      frozen: this.frozenTimer > 0,
    };
  }
}
