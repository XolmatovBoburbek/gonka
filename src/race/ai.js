// ИИ ботов: гоночная траектория, торможение перед поворотами, дрифт с мини-турбо,
// объезд ловушек и соперников, охота за кристаллами и тактическое применение предметов.
import * as THREE from 'three';

export const DIFFICULTY = {
  easy: { id: 'easy', label: 'Лёгкий', speed: 0.87, skill: 0.25, rubber: 0.1, items: 0.35 },
  normal: { id: 'normal', label: 'Средний', speed: 0.95, skill: 0.62, rubber: 0.08, items: 0.7 },
  hard: { id: 'hard', label: 'Сложный', speed: 1.0, skill: 0.95, rubber: 0.06, items: 0.95 },
};

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class BotDriver {
  constructor(kart, diff, rnd = Math.random) {
    this.kart = kart;
    this.diff = diff;
    this.rnd = rnd;
    this.skill = THREE.MathUtils.clamp(diff.skill + (rnd() - 0.5) * 0.2, 0.05, 1);
    this.personal = (rnd() - 0.5) * 0.6;
    this.lane = 0;
    this.noise = rnd() * 100;
    this.driftHold = false;
    this.itemTimer = 0;
    this.itemDelay = 0.6 + rnd() * 1.6 * (1.2 - diff.items);
    this.ignoreTraps = new Set();
    this.checkedTraps = new Set();
    this.driftCooldown = 0;
    this._p = new THREE.Vector3();
    this._fr = {};
  }

  avgCurv(s, len) {
    const tr = this.kart.track;
    const i0 = Math.floor(s / tr.spacing);
    const n = Math.max(1, Math.ceil(len / tr.spacing));
    let sum = 0;
    for (let k = 0; k <= n; k++) sum += tr.curv[(((i0 + k) % tr.count) + tr.count) % tr.count];
    return sum / (n + 1);
  }

  think(dt, race) {
    const k = this.kart;
    const tr = k.track;
    const out = { steer: 0, throttle: 1, brake: 0, driftHeld: false, driftPressed: false, useItem: false };
    const s = k.progress;
    const speed = Math.abs(k.speed);
    const fr = tr.frameAtProgress(s, this._fr);
    const hw = fr.hw;
    this.noise += dt;

    // --- траектория: внутрь поворота
    const c = this.avgCurv(s + 10, 45);
    const inside = -Math.sign(c) * Math.min(1, Math.abs(c) * 32);
    let target = inside * hw * (0.25 + 0.4 * this.skill) + this.personal * hw * 0.55;

    // --- кристаллы с предметами
    if (!k.item && k.roulette <= 0 && race.items) {
      let best = null;
      let bestD = 1e9;
      for (const b of race.items.boxes) {
        if (!b.active) continue;
        const ds = tr.deltaProgress(s, b.s);
        if (ds > 4 && ds < 50) {
          const d = Math.abs(b.lat - this.lane) + ds * 0.05;
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
      }
      if (best && this.skill > 0.2) target = THREE.MathUtils.lerp(target, best.lat, 0.5 + 0.4 * this.skill);
    }

    // --- объезд ловушек
    if (race.items) {
      for (const t of race.items.traps) {
        const ds = tr.deltaProgress(s, t.s);
        if (ds > 0 && ds < 38) {
          if (!this.checkedTraps.has(t)) {
            this.checkedTraps.add(t);
            if (this.rnd() > 0.35 + 0.6 * this.skill) this.ignoreTraps.add(t);
          }
          if (this.ignoreTraps.has(t)) continue;
          if (Math.abs(t.lat - target) < 3) target = t.lat + (target >= t.lat ? 1 : -1) * 3.4;
        }
      }
    }

    // --- обгон
    for (const o of race.karts) {
      if (o === k) continue;
      const ds = tr.deltaProgress(s, o.progress);
      if (ds > 0.5 && ds < 10 && Math.abs(o.lateral - target) < 2.6) {
        const room = o.lateral > 0 ? -1 : 1;
        target = o.lateral + room * 3.2;
      }
    }

    const lim = hw - 1.4;
    target = THREE.MathUtils.clamp(target, -lim, lim);
    this.lane += (target - this.lane) * (1 - Math.exp(-dt * (1.2 + 1.5 * this.skill)));

    // --- руление к точке впереди
    const la = 7 + speed * 0.42;
    tr.pointAt(s + la, this.lane, 0, this._p);
    const desired = Math.atan2(this._p.x - k.pos.x, this._p.z - k.pos.z);
    const diff = wrapAngle(desired - k.heading);
    let steer = -diff * 2.8;
    if (this.skill < 0.6) steer += Math.sin(this.noise * 1.7) * 0.18 * (1 - this.skill);
    out.steer = THREE.MathUtils.clamp(steer, -1, 1);

    // задний ход, если развернуло
    if (Math.abs(diff) > 2.2 && speed < 6) {
      out.throttle = 0;
      out.brake = 1;
      out.steer = -out.steer;
      return out;
    }

    // --- скорость перед поворотами
    const maxC = tr.maxCurvatureAhead(s, 8 + speed * 0.9);
    const cap = (k.drift.active ? 2.2 : 1.62) * k.handF;
    const vSafe = cap / Math.max(maxC, 1e-3);
    const margin = 1.0 + (1 - this.skill) * 0.08;
    if (speed > vSafe * margin * 1.28) {
      out.throttle = 0;
      out.brake = 0.7;
    } else if (speed > vSafe * margin) {
      out.throttle = 0.2;
    }

    // --- дрифт
    this.driftCooldown -= dt;
    const curveNear = this.avgCurv(s + 4, 28);
    if (k.drift.active) {
      const same = Math.sign(curveNear) === Math.sign(-k.drift.dir);
      const wantLevel = this.skill > 0.8 ? 3 : this.skill > 0.5 ? 2 : 1;
      const endOfCurve = Math.abs(this.avgCurv(s + 6, 14)) < 0.006;
      if (!same || endOfCurve || k.drift.level >= wantLevel + (this.skill > 0.9 ? 0 : 1)) {
        this.driftHold = false;
        this.driftCooldown = 0.8;
      } else this.driftHold = true;
    } else if (this.driftHold && !k.airborne) {
      // приземлились, а дрифт не начался — отпускаем
      this.driftHold = false;
    }
    if (!k.drift.active && !k.airborne && this.driftCooldown <= 0 && this.skill > 0.3 && speed > 22) {
      if (Math.abs(curveNear) > 0.016 && Math.abs(out.steer) > 0.3 && Math.sign(out.steer) === -Math.sign(curveNear)) {
        if (this.rnd() < dt * (1.5 + 4 * this.skill)) {
          out.driftPressed = true;
          this.driftHold = true;
        }
      }
    }
    out.driftHeld = this.driftHold;
    if (k.drift.active) out.steer = THREE.MathUtils.clamp(out.steer * 1.15, -1, 1);

    // --- трюк на трамплине
    if (k.airborne && k.trick.canTrick && !k.trick.active && this.rnd() < dt * 6 * this.skill) out.driftPressed = true;

    // --- предметы
    if (k.item) {
      this.itemTimer += dt;
      if (this.itemTimer > this.itemDelay) {
        out.useItem = this.decideItem(race);
        if (out.useItem) {
          this.itemTimer = 0;
          this.itemDelay = 0.5 + this.rnd() * 2 * (1.2 - this.diff.items);
        }
      }
    } else this.itemTimer = 0;
    return out;
  }

  decideItem(race) {
    const k = this.kart;
    const tr = k.track;
    const smart = this.diff.items;
    const held = k.itemHeld;
    if (this.rnd() > smart && held > 1.5) return true; // "глупое" применение
    const order = race.order;
    const idx = order.indexOf(k);
    switch (k.item) {
      case 'turbo':
        return tr.maxCurvatureAhead(k.progress, 70) < 0.02 || k.offroad || held > 6;
      case 'orb': {
        const ahead = idx > 0 ? order[idx - 1] : null;
        if (!ahead) return held > 5;
        const ds = tr.deltaProgress(k.progress, ahead.progress) + (ahead.lapsDone - k.lapsDone) * tr.length;
        return (ds > 3 && ds < 90) || held > 9;
      }
      case 'shield': {
        const threat = race.items.orbs.some((o) => o.target === k && o.pos.distanceTo(k.pos) < 50);
        return threat || held > 2.5 + this.rnd() * 3;
      }
      case 'ice': {
        const behind = idx < order.length - 1 ? order[idx + 1] : null;
        if (behind) {
          const ds = tr.deltaProgress(behind.progress, k.progress);
          if (ds > 2 && ds < 32) return true;
        }
        return held > 7;
      }
    }
    return false;
  }
}
