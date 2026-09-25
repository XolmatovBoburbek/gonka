// Гонка: сетка старта, отсчёт, физика с подшагами, столкновения, круги, места, финиш, события.
import * as THREE from 'three';
import { Kart, PHYS } from './kart.js';
import { KartView } from './kartModel.js';
import { BotDriver, DIFFICULTY } from './ai.js';
import { ItemSystem } from './items.js';
import { CHARACTERS } from '../data/characters.js';
import { DRIFT_COLORS } from '../world/fx.js';

const SUBSTEP = 1 / 120;
const SMOKE = new THREE.Color(0xe8e4f0);
const INTRO_TIME = 4.3;
const COUNT_TIME = 3.0;

export class Race {
  /**
   * opts: { world, playerChar, difficulty, laps, fx, quality, seed, demo }
   * world: { scene, track, def, boostZones, rampZones, startGate }
   */
  constructor(opts) {
    this.world = opts.world;
    this.scene = opts.world.scene;
    this.track = opts.world.track;
    this.fx = opts.fx;
    this.laps = opts.laps ?? 3;
    this.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    this.demo = !!opts.demo;
    this.state = this.demo ? 'racing' : 'intro';
    this.stateTime = 0;
    this.raceTime = 0;
    this.events = [];
    this.order = [];
    this.finishedCount = 0;
    this.playerFinished = false;
    this.skipIntro = !!opts.skipIntro;
    let seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    this.rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // --- участники
    const playerChar = opts.playerChar;
    const others = this.demo ? CHARACTERS.slice() : CHARACTERS.filter((c) => c.id !== playerChar.id);
    // перемешать соперников
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    const n = Math.min(8, this.demo ? others.length : others.length + 1);
    const playerSlot = this.demo ? -1 : Math.min(n - 1, opts.playerSlot ?? 4);
    const chars = [];
    let oi = 0;
    for (let i = 0; i < n; i++) chars.push(i === playerSlot ? playerChar : others[oi++]);

    this.karts = [];
    this.views = [];
    this.bots = new Map();
    this.items = new ItemSystem(this.scene, this.track, this.fx, { itemRows: this.world.def.itemRows || [] });
    const L = this.track.length;
    for (let i = 0; i < n; i++) {
      const isPlayer = i === playerSlot;
      const k = new Kart({ index: i, char: chars[i], isPlayer, track: this.track });
      const row = Math.floor(i / 2);
      const col = i % 2;
      const fr0 = this.track.frameAtProgress(L - 8, {});
      const lat = (col === 0 ? -1 : 1) * fr0.hw * 0.42;
      k.placeAt(L - 8 - row * 6.5 - col * 3, lat);
      k.lapsDone = -1;
      k.totalProgress = k.lapsDone * L + k.progress;
      k.place = i + 1;
      this.karts.push(k);
      if (!isPlayer) {
        const bd = new BotDriver(k, this.diff, this.rnd);
        this.bots.set(k, bd);
        k.botSpeed = this.diff.speed * (0.985 + this.rnd() * 0.03);
      }
      const view = new KartView(chars[i]);
      view.setShadowMode(opts.shadows !== false);
      this.scene.add(view.root);
      this.items.attachKartFx(k, view.root);
      this.views.push(view);
      if (isPlayer) this.player = k;
    }
    if (!this.player) {
      // демо-режим: камера следит за первым картом
      this.player = this.karts[0];
      this.playerIsBot = true;
    }
    this.playerView = this.views[this.karts.indexOf(this.player)];
    this.autoPilot = this.demo ? null : new BotDriver(this.player, DIFFICULTY.hard, this.rnd);
    this.order = this.karts.slice();
    this.updateOrder();
    this.syncViews(0);
    this.lastPlace = this.player.place;
    this.rocket = { pressedAt: -1, stalled: false };
    this.lightsStage = 0;
    if (this.skipIntro) {
      this.state = 'countdown';
      this.stateTime = 0;
    }
  }

  get introTime() {
    return INTRO_TIME;
  }

  emitGlobal(type, data = {}) {
    this.events.push({ type, ...data });
  }

  /** Главное обновление; input — состояние управления игрока. */
  update(dt, input) {
    this.events.length = 0;
    this.stateTime += dt;

    if (this.state === 'intro') {
      if (this.stateTime >= INTRO_TIME) {
        this.state = 'countdown';
        this.stateTime = 0;
      }
    } else if (this.state === 'countdown') {
      const stage = Math.min(4, Math.floor(this.stateTime / (COUNT_TIME / 3)) + 1);
      if (stage !== this.lightsStage) {
        this.lightsStage = stage;
        if (stage <= 3) this.emitGlobal('countdown', { n: 4 - stage });
        this.world.startGate?.setLights(stage);
      }
      // ракетный старт: газ в последние ~0.6 с до старта; раньше — "захлёб"
      if (input.throttle > 0.5 && this.rocket.pressedAt < 0) this.rocket.pressedAt = this.stateTime;
      if (this.stateTime >= COUNT_TIME) {
        this.state = 'racing';
        this.stateTime = 0;
        this.world.startGate?.setLights(4);
        this.emitGlobal('go');
        const p = this.rocket.pressedAt;
        if (p >= COUNT_TIME - 0.75 && p < COUNT_TIME) {
          this.player.addBoost(1.3, 1.32, 'rocket');
          this.emitGlobal('rocketStart');
        } else if (p >= 0 && p < COUNT_TIME - 1.5) {
          this.rocket.stalled = true;
          this.player.spinTimer = 0;
          this.player.frozenTimer = 0.6;
          this.emitGlobal('stall');
        }
        for (const k of this.karts) {
          if (k.isPlayer) continue;
          const bd = this.bots.get(k);
          if (bd && this.rnd() < 0.2 + 0.5 * bd.skill) k.addBoost(1.1, 1.28, 'rocket');
          k.lapStart = 0;
        }
        this.player.lapStart = 0;
      }
    }

    const racing = this.state === 'racing' || this.state === 'finished';
    if (racing) this.raceTime += dt;

    // --- ввод
    const inputs = new Map();
    for (const k of this.karts) {
      let inp;
      if (!racing) inp = { steer: 0, throttle: 0, brake: 0, driftHeld: false, driftPressed: false, useItem: false, useBoost: false };
      else if (k === this.player && !this.playerIsBot && !k.finished) {
        inp = { ...input, useItem: input.item, useBoost: input.boost };
      } else if (k === this.player && !this.playerIsBot && k.finished) {
        inp = this.autoPilot.think(dt, this);
        inp.useItem = false;
        inp.useBoost = false;
      } else {
        inp = this.bots.get(k).think(dt, this);
        if (k.finished) inp.useItem = inp.useBoost = false;
      }
      inputs.set(k, inp);
      if (racing && inp.useItem && k.item) this.items.use(k, this);
      if (racing && inp.useBoost) k.useBoost();
    }

    // --- резиновая лента: боты подтягиваются/притормаживают относительно игрока
    if (racing && !this.demo) {
      const p = this.player.totalProgress;
      for (const k of this.karts) {
        if (k === this.player) continue;
        const gap = k.totalProgress - p;
        const r = this.diff.rubber;
        k.rubber = 1 + THREE.MathUtils.clamp(-gap / 260, -0.6, 1) * r;
      }
    }

    // --- физика с подшагами
    // (−0.05: обычный кадр 60 Гц — ровно 2 подшага, а не 3 из-за погрешности dt)
    const steps = Math.min(6, Math.max(1, Math.ceil(dt / SUBSTEP - 0.05)));
    const h = dt / steps;
    const env = { boostZones: this.world.boostZones, rampZones: this.world.rampZones };
    for (let s = 0; s < steps; s++) {
      for (const k of this.karts) {
        const inp = inputs.get(k);
        k.step(h, inp, env);
        inp.driftPressed = false;
      }
      this.collide();
    }

    // --- круги и финиш
    if (racing) {
      for (const k of this.karts) {
        for (const e of k.events) {
          if (e.type === 'lapCross' && e.forward && !k.finished) {
            if (k.lapsDone >= 1) {
              const lapTime = this.raceTime - k.lapStart;
              k.lapTimes.push(lapTime);
              k.lapStart = this.raceTime;
              if (k.lapsDone >= this.laps) {
                k.finished = true;
                k.finishTime = this.raceTime;
                this.finishedCount++;
                k.finishPlace = this.finishedCount;
                this.emitGlobal('finish', { kart: k, place: k.finishPlace });
                if (k === this.player && !this.playerIsBot) {
                  this.playerFinished = true;
                  this.state = 'finished';
                  this.stateTime = 0;
                }
              } else {
                this.emitGlobal('lap', { kart: k, lap: k.lapsDone + 1, lapTime });
                if (k.lapsDone === this.laps - 1) this.emitGlobal('finalLap', { kart: k });
              }
            } else if (k.lapsDone === 0) {
              k.lapStart = k.lapStart || 0;
            }
          }
        }
      }
    }

    this.updateOrder();
    if (this.player.place !== this.lastPlace && racing) {
      this.emitGlobal('place', { from: this.lastPlace, to: this.player.place });
      this.lastPlace = this.player.place;
    }

    // --- предметы
    if (racing) this.items.update(dt, this);

    // --- собрать события картов
    for (const k of this.karts) {
      for (const e of k.events) this.events.push(e);
      k.events.length = 0;
    }

    this.syncViews(dt);
  }

  collide() {
    const R = PHYS.radius;
    const ks = this.karts;
    for (let i = 0; i < ks.length; i++) {
      for (let j = i + 1; j < ks.length; j++) {
        const a = ks[i];
        const b = ks[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 4 * R * R || Math.abs(a.pos.y - b.pos.y) > 1.6) continue;
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d;
        const nz = dz / d;
        const overlap = 2 * R - d;
        const ma = a.shieldTimer > 0 ? 4 : 1;
        const mb = b.shieldTimer > 0 ? 4 : 1;
        const wa = mb / (ma + mb);
        const wb = ma / (ma + mb);
        a.pos.x -= nx * overlap * wa;
        a.pos.z -= nz * overlap * wa;
        b.pos.x += nx * overlap * wb;
        b.pos.z += nz * overlap * wb;
        const vax = Math.sin(a.moveHeading) * a.speed + a.push.x;
        const vaz = Math.cos(a.moveHeading) * a.speed + a.push.y;
        const vbx = Math.sin(b.moveHeading) * b.speed + b.push.x;
        const vbz = Math.cos(b.moveHeading) * b.speed + b.push.y;
        const rel = (vbx - vax) * nx + (vbz - vaz) * nz;
        if (rel < 0) {
          const imp = -rel * 0.85 + 1.5;
          a.push.x -= nx * imp * wa;
          a.push.y -= nz * imp * wa;
          b.push.x += nx * imp * wb;
          b.push.y += nz * imp * wb;
          // тот, кто сзади, теряет немного скорости
          const fa = Math.sin(a.moveHeading) * nx + Math.cos(a.moveHeading) * nz;
          if (fa > 0.3) a.speed *= 1 - 0.18 * fa * wa * 2;
          const fb = -(Math.sin(b.moveHeading) * nx + Math.cos(b.moveHeading) * nz);
          if (fb > 0.3) b.speed *= 1 - 0.18 * fb * wb * 2;
          if (-rel > 4) {
            a.emit('bump', { other: b, strength: -rel });
            if (b.shieldTimer > 0 && a.shieldTimer <= 0) a.push.multiplyScalar(1.8);
            if (a.shieldTimer > 0 && b.shieldTimer <= 0) b.push.multiplyScalar(1.8);
          }
        }
      }
    }
  }

  updateOrder() {
    const ks = this.order;
    ks.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalProgress - a.totalProgress;
    });
    ks.forEach((k, i) => (k.place = i + 1));
  }

  /** Обновить модели, частицы дрифта/буста/пыли. */
  syncViews(dt) {
    const up = new THREE.Vector3();
    const f = new THREE.Vector3();
    const x = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const wp = new THREE.Vector3();
    for (let i = 0; i < this.karts.length; i++) {
      const k = this.karts[i];
      const v = this.views[i];
      up.copy(k.surfaceUp);
      if (k.airborne) up.lerp(new THREE.Vector3(0, 1, 0), 0.3).normalize();
      f.set(Math.sin(k.heading), 0, Math.cos(k.heading));
      f.addScaledVector(up, -f.dot(up)).normalize();
      x.crossVectors(up, f).normalize();
      m.makeBasis(x, up, f);
      v.root.quaternion.setFromRotationMatrix(m);
      v.root.position.copy(k.pos);
      const vs = k.visualState();
      v.update(vs, dt);
      // мигание после попадания
      v.body.visible = !(k.invuln > 0 && k.spinTimer <= 0 && k.frozenTimer <= 0 && Math.floor(k.invuln * 14) % 2 === 0 && k.invuln < 1.6);
      if (!dt || !this.fx) continue;
      v.root.updateMatrixWorld();
      // искры дрифта
      if (k.drift.active && !k.airborne) {
        for (const sp of v.sparkPoints) {
          wp.copy(sp).applyMatrix4(v.root.matrixWorld);
          // цвет искр — уровень буста, который сейчас копится; чем круче занос, тем их больше
          const big = Math.abs(k.drift.angle) > 0.3;
          if (big || Math.random() < 0.5) this.fx.sparks(wp, -f.x - x.x * k.drift.dir * 0.5, -f.z - x.z * k.drift.dir * 0.5, k.drift.level, big ? 2 : 1);
          // дым из-под скользящих боком задних колёс
          if (Math.random() < Math.abs(k.drift.angle) * 0.45) this.fx.dust(wp, SMOKE, 0.3 + Math.abs(k.drift.angle) * 0.6);
        }
      }
      // пламя буста
      if (k.boost.time > 0) {
        const col = k.boost.kind.startsWith('boost') ? DRIFT_COLORS[+k.boost.kind.slice(5)] : undefined;
        for (const ep of v.exhaustPoints) {
          wp.copy(ep).applyMatrix4(v.root.matrixWorld);
          this.fx.flame(wp, { x: -f.x, z: -f.z }, col);
        }
      }
      // пыль на бездорожье
      if (k.offroad && !k.airborne && Math.abs(k.speed) > 8 && Math.random() < 0.5) {
        wp.copy(v.sparkPoints[Math.random() < 0.5 ? 0 : 1]).applyMatrix4(v.root.matrixWorld);
        this.fx.dust(wp, this.world.dustColor);
      }
    }
  }

  /** Упрощать машинки дальше D м от камеры (с запасом, чтобы детали не мигали на границе). */
  updateLod(camPos, D) {
    for (const v of this.views) {
      const d2 = v.root.position.distanceToSquared(camPos);
      v.setFar(v.far ? d2 > (0.9 * D) ** 2 : d2 > (1.1 * D) ** 2);
    }
  }

  /** Результаты: финишировавшие + оценка времени для остальных. */
  results() {
    const out = [];
    const avgLap = this.player.lapTimes.length ? this.player.lapTimes.reduce((a, b) => a + b, 0) / this.player.lapTimes.length : 40;
    for (const k of this.order) {
      let time = k.finishTime;
      if (!k.finished) {
        const remaining = this.laps * this.track.length - k.totalProgress;
        time = this.raceTime + (remaining / this.track.length) * avgLap * 1.02;
      }
      out.push({ kart: k, char: k.char, time, finished: k.finished, best: k.lapTimes.length ? Math.min(...k.lapTimes) : null });
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }

  dispose() {
    for (const v of this.views) {
      this.scene.remove(v.root);
      v.dispose();
    }
    this.items.dispose();
  }
}
