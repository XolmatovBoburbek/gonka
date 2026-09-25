// Аркадная физика карта в "пространстве трассы": газ/тормоз, руление, дрифт с настоящим углом заноса,
// буст-шкала из трёх делений, подпрыгивания, трамплины и трюки, стены, бездорожье, заносы от попаданий.
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
  // занос: нос опережает направление движения на угол (рад); руль в поворот — круче, контр-руль — мельче
  driftAngle: 0.42,
  driftAngleSteer: 0.26,
  driftAngleRate: 5.5,
  driftRecover: 6.5, // как быстро после заноса возвращается сцепление
  driftScrub: 0.3, // потеря скорости боком скользящих шин
  driftFlipHold: 0.3, // столько держать полный контр-руль на малом угле, чтобы переложить занос
  // буст-шкала из трёх делений: копится в заносе и на трюках, тратится вся сразу — уровень = число делений
  meterRate: 0.42,
  meterTrick: 0.25,
  boostLevels: [
    [0.9, 1.22],
    [2.0, 1.3],
    [3.2, 1.38],
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
    this.heading = 0; // куда смотрит нос
    this.moveHeading = 0; // куда на самом деле едет (в заносе отстаёт от носа)
    this.speed = 0;
    this.vy = 0;
    this.airborne = false;
    this.airTime = 0;
    this.push = new THREE.Vector2();
    this.steer = 0;
    this.throttle = 0;

    // level — какой уровень буста сейчас копится (цвет искр); angle — угол заноса, гаснет и после дрифта
    this.drift = { active: false, dir: 0, angle: 0, flipT: 0, level: 0, intent: false };
    this.boost = { time: 0, power: 1, kind: '' };
    this.boostMeter = 0; // 0..3 деления
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

  /** Направление для камеры: по ходу движения, чуть к носу — занос виден сбоку. */
  get camHeading() {
    return this.moveHeading + (this.heading - this.moveHeading) * 0.35;
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
    this.moveHeading = this.heading;
    this.drift.angle = 0;
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
    this.cancelDrift();
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

  /** Конец заноса: заряд уже в шкале, угол плавно гаснет в step (сцепление возвращается). */
  cancelDrift() {
    const d = this.drift;
    d.intent = false;
    if (!d.active) return;
    d.active = false;
    d.level = 0;
    d.flipT = 0;
  }

  /** Пополнить буст-шкалу; о каждом заполненном делении — событие. */
  fillMeter(x) {
    const before = Math.floor(this.boostMeter);
    this.boostMeter = Math.min(3, this.boostMeter + x);
    const now = Math.floor(this.boostMeter);
    if (now > before) this.emit('meterSegment', { level: now });
  }

  /** Потратить все полные деления: 1 — синий буст, 2 — оранжевый, 3 — фиолетовый (сильнее и дольше). */
  useBoost() {
    const n = Math.min(3, Math.floor(this.boostMeter + 1e-6));
    if (n < 1 || !this.controllable) {
      this.emit('boostEmpty');
      return false;
    }
    this.boostMeter = Math.max(0, this.boostMeter - n);
    const [t, p] = PHYS.boostLevels[n - 1];
    this.addBoost(t, p, 'boost' + n);
    this.emit('boostFire', { level: n });
    return true;
  }

  respawn() {
    this._respawns = (this._respawns || 0) + 1;
    const back = this.progress - 4;
    this.placeAt(back, 0);
    this.speed = 0;
    this.vy = 0;
    this.airborne = false;
    this.push.set(0, 0);
    this.cancelDrift();
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

    const d = this.drift;
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
      // занос гасит скорость: шины скользят боком
      if (d.active) this.speed -= P.driftScrub * Math.sin(Math.abs(d.angle)) * this.speed * dt;
    } else {
      this.speed *= Math.exp(-dt * 0.08);
    }

    // ---- дрифт
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
      if (d.active) this.cancelDrift();
      d.intent = false;
    }
    if (d.active) {
      if (Math.abs(this.speed) < 9 || !ctrl) this.cancelDrift();
      else if (!this.airborne) {
        // шкала буста копится тем быстрее, чем круче занос и выше скорость
        const q = Math.min(1.2, Math.abs(this.speed) / P.maxSpeed) * (0.45 + Math.abs(d.angle) / 0.6) * this.driftF;
        this.fillMeter(dt * P.meterRate * q);
        d.level = Math.min(3, Math.floor(this.boostMeter) + 1); // цвет искр — какой уровень буста сейчас копится
      }
    }

    // ---- руление: поворачивает направление движения; в заносе нос опережает его на угол заноса
    const absV = Math.abs(this.speed);
    const sf = Math.min(1, absV / 7) * (1 - 0.3 * THREE.MathUtils.clamp((absV - 20) / 24, 0, 1));
    let yawRate;
    if (d.active) {
      const into = this.steer * d.dir; // +1 — руль в поворот, −1 — контр-руль
      // без руля — дуга ~40 м, в поворот — круче, полный контр-руль почти выпрямляет
      yawRate = -d.dir * P.turnRate * this.handF * (0.55 + 0.5 * into) * Math.max(sf, 0.6);
      if (!this.airborne) {
        const hard = into < -0.7; // полный контр-руль: машинка выравнивается
        const target = hard ? 0.05 : (P.driftAngle + P.driftAngleSteer * into) * (0.55 + 0.45 * Math.min(1, absV / 30));
        d.angle += (target - d.angle) * (1 - Math.exp(-dt * P.driftAngleRate * (hard ? 1.6 : 1)));
        // перекладка: держать полный контр-руль, когда машинка уже выровнялась, — занос в другую сторону
        if (hard && d.angle < 0.2) {
          d.flipT += dt;
          if (d.flipT > P.driftFlipHold) {
            d.dir = -d.dir;
            d.angle = -d.angle;
            d.flipT = 0;
            this.emit('driftFlip');
          }
        } else d.flipT = 0;
      }
    } else {
      yawRate = -this.steer * P.turnRate * this.handF * sf * (this.speed < -0.5 ? -1 : 1);
      // после заноса сцепление возвращается — нос плавно доворачивает по ходу
      if (d.angle !== 0) {
        d.angle *= Math.exp(-dt * P.driftRecover);
        if (Math.abs(d.angle) < 0.003) d.angle = 0;
      }
    }
    if (this.airborne) yawRate *= this.hop > 0 ? 0.8 : 0.3;
    if (this.spinTimer > 0 || this.frozenTimer > 0) yawRate = 0;
    this.moveHeading += yawRate * dt;
    this.heading = this.moveHeading - d.dir * d.angle;

    // ---- перемещение — по направлению движения
    const fx = Math.sin(this.moveHeading);
    const fz = Math.cos(this.moveHeading);
    const vx = fx * this.speed + this.push.x;
    const vz = fz * this.speed + this.push.y;
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
        this.moveHeading = Math.atan2(tx, tz);
        this.heading = this.moveHeading - d.dir * d.angle;
        const loss = Math.min(0.65, into * 0.85);
        const before = this.speed;
        this.speed *= 1 - loss;
        if (into > 0.28 && before > 12) {
          this.emit('wallHit', { strength: into });
          if (into > 0.5) this.cancelDrift();
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
          this.fillMeter(P.meterTrick);
          this.emit('trickBoost');
        }
        this.trick.active = false;
        this.trick.pending = false;
        this.trick.canTrick = false;
        if (impact > 9) this.emit('land', { impact });
        // начало дрифта после подпрыгивания
        if (wasHop && d.intent && input.driftHeld && Math.abs(this.steer) > 0.22 && this.speed > P.driftMinSpeed && ctrl) {
          const dir = Math.sign(this.steer);
          d.angle *= d.dir * dir; // остаток угла прошлого заноса — в знаке нового, нос не дёргается
          d.active = true;
          d.dir = dir;
          d.flipT = 0;
          d.level = Math.min(3, Math.floor(this.boostMeter) + 1);
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
      driftAngle: this.drift.angle,
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
