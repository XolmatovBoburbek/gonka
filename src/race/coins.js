// Монеты на трассе: цепочки по 5 штук. Каждая монета в запасе (до 10) чуть поднимает максимальную скорость,
// попадание выбивает три. Все монеты — один InstancedMesh; собранная возвращается через несколько секунд.
import * as THREE from 'three';

const RESPAWN = 3.5;
const PICK_R2 = 1.75 * 1.75;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Vector3(0, 0, 0);

export class CoinSystem {
  /** world: { track, boostZones, rampZones, def }, rnd — генератор гонки (расстановка своя, от длины трассы). */
  constructor(scene, world) {
    const track = world.track;
    this.track = track;
    this.coins = [];
    const L = track.length;
    let seed = (Math.round(L * 7) ^ 0x5bd1e995) >>> 0;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const busy = [];
    for (const z of world.boostZones || []) busy.push([z.s0 - 10, z.s1 + 10]);
    for (const z of world.rampZones || []) busy.push([z.s0 - 14, z.s1 + 30]);
    for (const f of world.def.itemRows || []) busy.push([f * L - 9, f * L + 9]);
    const free = (a, b) => busy.every(([x, y]) => b < x || a > y);
    const fr = {};
    for (let s = 45; s < L - 40; s += 70 + rnd() * 30) {
      const len = 4 * 3.6;
      if (!free(s, s + len)) continue;
      track.frameAtProgress(s, fr);
      const lim = fr.hw - 2.2;
      const lat0 = (rnd() * 2 - 1) * lim;
      // прямая цепочка или диагональ через дорогу
      const slope = rnd() < 0.4 ? (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5) : 0;
      for (let i = 0; i < 5; i++) {
        const cs = s + i * 3.6;
        const lat = THREE.MathUtils.clamp(lat0 + slope * (i - 2) * 1.4, -lim, lim);
        const pos = track.pointAt(cs, lat, 0.95, new THREE.Vector3());
        this.coins.push({ pos, s: cs, lat, t: 0, phase: i * 0.5 });
      }
    }
    const geo = new THREE.CylinderGeometry(0.62, 0.62, 0.14, 14);
    geo.rotateX(Math.PI / 2);
    // яркое золото: чуть светится через bloom
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc21a).multiplyScalar(1.5) });
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, this.coins.length));
    this.mesh.name = 'coins';
    this.mesh.frustumCulled = false;
    this.mesh.userData.noShadow = true;
    this.scene = scene;
    this.time = 0;
    scene.add(this.mesh);
    this._write();
  }

  _write() {
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
      if (c.t > 0) _m.compose(_zero, _q.identity(), _s.set(0, 0, 0));
      else {
        _q.setFromAxisAngle(_up, this.time * 3.2 + c.phase);
        _m.compose(c.pos, _q, _s.set(1, 1, 1));
      }
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Ближайшая несобранная монета впереди (для ботов): { ds, lat } или null. */
  ahead(s, maxDs) {
    let best = null;
    let bd = maxDs;
    for (const c of this.coins) {
      if (c.t > 0) continue;
      const ds = this.track.deltaProgress(s, c.s);
      if (ds > 5 && ds < bd) {
        bd = ds;
        best = c;
      }
    }
    return best;
  }

  update(dt, karts) {
    this.time += dt;
    for (const c of this.coins) {
      if (c.t > 0) {
        c.t -= dt;
        continue;
      }
      for (const k of karts) {
        const dx = k.pos.x - c.pos.x;
        const dz = k.pos.z - c.pos.z;
        if (dx * dx + dz * dz > PICK_R2 || Math.abs(k.pos.y + 0.9 - c.pos.y) > 2.2) continue;
        c.t = RESPAWN;
        k.addCoin();
        break;
      }
    }
    this._write();
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
