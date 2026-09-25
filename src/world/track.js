// Трасса: замкнутый сплайн → равномерные сэмплы с локальными базисами.
// Используется и физикой (проекция карта на трассу), и генерацией геометрии (дорога, бордюры, стены).
import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Track {
  /**
   * def: {
   *   points: [[x,y,z],...]         — контрольные точки (замкнутая кривая)
   *   width: 18                      — ширина дороги
   *   widths?: [..]                  — ширина по контрольным точкам (перекрывает width)
   *   shoulder: 7                    — обочина до стены (от края дороги)
   *   bankFactor: 6, maxBank: 0.16   — автонаклон в поворотах
   *   sections?: [{from,to, wall, noTerrain, bridge}] (доли круга 0..1)
   *   spacing?: 1.5
   * }
   */
  constructor(def) {
    this.def = def;
    const pts = def.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    curve.arcLengthDivisions = Math.max(4000, pts.length * 300);
    this.curve = curve;
    const L = curve.getLength();
    const N = Math.max(64, Math.round(L / (def.spacing ?? 1.5)));
    this.count = N;
    this.length = L;
    this.spacing = L / N;

    const nCtrl = pts.length;
    this.pos = new Array(N);
    this.tan = new Array(N);
    this.right = new Array(N);
    this.up = new Array(N);
    this.hw = new Float32Array(N);
    this.wall = new Float32Array(N); // смещение стены от края дороги
    this.bank = new Float32Array(N);
    this.curv = new Float32Array(N);
    this.flags = new Uint8Array(N); // 1 = мост/эстакада (без ландшафта)
    this.ctrlT = new Float32Array(N); // координата в пространстве контрольных точек

    for (let i = 0; i < N; i++) {
      const u = i / N;
      const t = curve.getUtoTmapping(u);
      this.pos[i] = curve.getPoint(t);
      this.ctrlT[i] = t * nCtrl;
    }
    // касательные — центральная разность (гладко и стабильно)
    for (let i = 0; i < N; i++) {
      const a = this.pos[(i - 1 + N) % N];
      const b = this.pos[(i + 1) % N];
      this.tan[i] = new THREE.Vector3().subVectors(b, a).normalize();
    }
    // кривизна (dθ/ds) по горизонтали, сглаженная
    const yaw = (v) => Math.atan2(v.x, v.z);
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.tan[(i - 2 + N) % N];
      const b = this.tan[(i + 2) % N];
      let d = yaw(b) - yaw(a);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      raw[i] = d / (4 * this.spacing);
    }
    smoothArray(raw, this.curv, 6);

    // ширина
    const baseW = def.width ?? 18;
    for (let i = 0; i < N; i++) {
      const w = def.widths ? interpCtrl(def.widths, this.ctrlT[i]) : baseW;
      this.hw[i] = w / 2;
    }
    // стены и секции
    const shoulder = def.shoulder ?? 7;
    const wallRaw = new Float32Array(N).fill(shoulder);
    for (const s of def.sections || []) {
      const i0 = Math.floor(s.from * N);
      const i1 = Math.ceil(s.to * N);
      for (let k = i0; k <= i1; k++) {
        const i = ((k % N) + N) % N;
        if (s.wall !== undefined) wallRaw[i] = s.wall;
        if (s.bridge) this.flags[i] |= 1;
      }
    }
    smoothArray(wallRaw, this.wall, 8);

    // наклон виража
    const bf = def.bankFactor ?? 5;
    const maxBank = def.maxBank ?? 0.14;
    const bankRaw = new Float32Array(N);
    for (let i = 0; i < N; i++) bankRaw[i] = THREE.MathUtils.clamp(this.curv[i] * bf, -maxBank, maxBank);
    smoothArray(bankRaw, this.bank, 14);

    const Y = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < N; i++) {
      const t = this.tan[i];
      const r = new THREE.Vector3().crossVectors(t, Y).normalize();
      const u0 = new THREE.Vector3().crossVectors(r, t).normalize();
      const phi = this.bank[i];
      const rb = r.clone().multiplyScalar(Math.cos(phi)).addScaledVector(u0, Math.sin(phi)).normalize();
      const ub = new THREE.Vector3().crossVectors(rb, t).normalize();
      this.right[i] = rb;
      this.up[i] = ub;
    }

    // габариты
    this.bounds = new THREE.Box3();
    for (const p of this.pos) this.bounds.expandByPoint(p);

    // пространственный индекс для быстрых запросов "расстояние до трассы"
    this._grid = new Map();
    this._cell = 24;
    for (let i = 0; i < N; i++) {
      const p = this.pos[i];
      const key = this._key(Math.floor(p.x / this._cell), Math.floor(p.z / this._cell));
      let arr = this._grid.get(key);
      if (!arr) this._grid.set(key, (arr = []));
      arr.push(i);
    }
  }

  /** Пометить сэмплы как мост/эстакаду по условию на позицию (после конструктора). */
  markSections(pred, { bridge = true, wall = null } = {}) {
    const N = this.count;
    const wallRaw = new Float32Array(N);
    // восстановить "сырые" стены из текущих (они уже сглажены — сглаживание повторно мягкое)
    for (let i = 0; i < N; i++) wallRaw[i] = this.wall[i];
    for (let i = 0; i < N; i++) {
      if (pred(this.pos[i], i)) {
        if (bridge) this.flags[i] |= 1;
        if (wall !== null) wallRaw[i] = wall;
      }
    }
    if (wall !== null) smoothArray(wallRaw, this.wall, 6);
  }

  _key(cx, cz) {
    return cx * 73856093 + cz * 19349663;
  }

  wrapIndex(i) {
    const N = this.count;
    return ((i % N) + N) % N;
  }

  wrapF(f) {
    const N = this.count;
    return ((f % N) + N) % N;
  }

  /** Разница прогресса b - a по кратчайшему пути вдоль петли. */
  deltaProgress(a, b) {
    const L = this.length;
    let d = b - a;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  /** Интерполированный базис в дробном индексе f. */
  frameAt(f, out) {
    const N = this.count;
    f = this.wrapF(f);
    const i = Math.floor(f);
    const j = (i + 1) % N;
    const t = f - i;
    out.pos = (out.pos || new THREE.Vector3()).lerpVectors(this.pos[i], this.pos[j], t);
    out.tan = (out.tan || new THREE.Vector3()).lerpVectors(this.tan[i], this.tan[j], t).normalize();
    out.right = (out.right || new THREE.Vector3()).lerpVectors(this.right[i], this.right[j], t).normalize();
    out.up = (out.up || new THREE.Vector3()).lerpVectors(this.up[i], this.up[j], t).normalize();
    out.hw = this.hw[i] + (this.hw[j] - this.hw[i]) * t;
    out.wall = this.wall[i] + (this.wall[j] - this.wall[i]) * t;
    out.curv = this.curv[i] + (this.curv[j] - this.curv[i]) * t;
    out.f = f;
    out.index = i;
    out.progress = f * this.spacing;
    return out;
  }

  frameAtProgress(s, out) {
    return this.frameAt(s / this.spacing, out);
  }

  /** Точка на трассе: прогресс s, поперечное смещение lat, высота h над дорогой. */
  pointAt(s, lat = 0, h = 0, out = new THREE.Vector3()) {
    const fr = this.frameAt(s / this.spacing, _tmpFrame);
    return out.copy(fr.pos).addScaledVector(fr.right, lat).addScaledVector(fr.up, h);
  }

  nearestGlobal(p) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      const q = this.pos[i];
      const dx = p.x - q.x;
      const dy = (p.y - q.y) * 1.5;
      const dz = p.z - q.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  nearestLocal(p, hint) {
    const N = this.count;
    const dist = (i) => {
      const q = this.pos[i];
      const dx = p.x - q.x;
      const dy = (p.y - q.y) * 1.5;
      const dz = p.z - q.z;
      return dx * dx + dy * dy + dz * dz;
    };
    let i = this.wrapIndex(hint);
    let d = dist(i);
    // окно ±6 для надёжности, потом градиентный спуск
    for (let k = -6; k <= 6; k++) {
      const j = (i + k + N) % N;
      const dj = dist(j);
      if (dj < d) {
        d = dj;
        i = j;
      }
    }
    for (let guard = 0; guard < 400; guard++) {
      const a = (i + 1) % N;
      const b = (i - 1 + N) % N;
      const da = dist(a);
      const db = dist(b);
      if (da < d && da <= db) {
        i = a;
        d = da;
      } else if (db < d) {
        i = b;
        d = db;
      } else break;
    }
    return i;
  }

  /**
   * Проекция точки на трассу. Возвращает out с полями frameAt + lateral, height, progress.
   */
  project(p, hint = -1, out = {}) {
    const i0 = hint < 0 ? this.nearestGlobal(p) : this.nearestLocal(p, hint);
    const a = this.pos[i0];
    const t = this.tan[i0];
    const along = (p.x - a.x) * t.x + (p.y - a.y) * t.y + (p.z - a.z) * t.z;
    const f = i0 + THREE.MathUtils.clamp(along / this.spacing, -1, 1);
    this.frameAt(f, out);
    _v.subVectors(p, out.pos);
    out.lateral = _v.dot(out.right);
    out.height = _v.dot(out.up);
    out.nearest = i0;
    return out;
  }

  /** Горизонтальное расстояние от точки (x,z) до осевой линии (приближённо, по сэмплам). */
  distanceTo(x, z, maxDist = 80) {
    const c = this._cell;
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    const reach = Math.ceil(maxDist / c);
    let best = Infinity;
    let bestI = -1;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const arr = this._grid.get(this._key(cx + dx, cz + dz));
        if (!arr) continue;
        for (const i of arr) {
          const q = this.pos[i];
          const ddx = x - q.x;
          const ddz = z - q.z;
          const d = ddx * ddx + ddz * ddz;
          if (d < best) {
            best = d;
            bestI = i;
          }
        }
      }
    }
    return { dist: Math.sqrt(best), index: bestI };
  }

  /** Максимальная |кривизна| на отрезке прогресса [s, s+len]. */
  maxCurvatureAhead(s, len) {
    const i0 = Math.floor(s / this.spacing);
    const n = Math.ceil(len / this.spacing);
    let m = 0;
    for (let k = 0; k <= n; k++) {
      const c = Math.abs(this.curv[(i0 + k) % this.count]);
      if (c > m) m = c;
    }
    return m;
  }

  /**
   * Экструзия профиля вдоль трассы.
   * profile: [{k, c, y, u}] — поперечное смещение = k * halfWidth + k' * wall + c, высота y над дорогой.
   *   Можно указать w: 1/-1 чтобы добавить смещение стены с этой стороны.
   * opts: { from, to (индексы сэмплов, to может быть > N), vScale, filter(i) -> bool }
   */
  extrude(profile, opts = {}) {
    const N = this.count;
    const from = opts.from ?? 0;
    const to = opts.to ?? N;
    const vScale = opts.vScale ?? 10;
    const m = profile.length;
    const positions = [];
    const uvs = [];
    const indices = [];
    const rings = to - from + 1;
    // U по длине профиля (если не задан)
    const us = profile.map((p, j) => (p.u !== undefined ? p.u : j / (m - 1)));
    for (let r = 0; r < rings; r++) {
      const i = (from + r) % N;
      const P = this.pos[i];
      const R = this.right[i];
      const U = this.up[i];
      const hw = this.hw[i];
      const wall = this.wall[i];
      for (let j = 0; j < m; j++) {
        const pr = profile[j];
        const lat = (pr.k || 0) * hw + (pr.w || 0) * wall + (pr.c || 0);
        const y = pr.y || 0;
        positions.push(P.x + R.x * lat + U.x * y, P.y + R.y * lat + U.y * y, P.z + R.z * lat + U.z * y);
        uvs.push(us[j], ((from + r) * this.spacing) / vScale);
      }
    }
    for (let r = 0; r < rings - 1; r++) {
      const i = (from + r) % N;
      if (opts.filter && !opts.filter(i)) continue;
      for (let j = 0; j < m - 1; j++) {
        if (profile[j].break) continue;
        const a = r * m + j;
        const b = (r + 1) * m + j;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /** Непрерывные диапазоны сэмплов, удовлетворяющих условию (для частичных деталей: мосты и т.п.). */
  ranges(pred) {
    const N = this.count;
    const out = [];
    let start = -1;
    // найти точку, где условие ложно, чтобы корректно обработать переход через 0
    let origin = 0;
    while (origin < N && pred(origin)) origin++;
    if (origin === N) return [[0, N]];
    for (let k = 1; k <= N; k++) {
      const i = (origin + k) % N;
      const ok = pred(i);
      if (ok && start < 0) start = origin + k;
      if (!ok && start >= 0) {
        out.push([start, origin + k]);
        start = -1;
      }
    }
    return out;
  }
}

const _tmpFrame = {};

function interpCtrl(arr, c) {
  const n = arr.length;
  const i = Math.floor(c) % n;
  const j = (i + 1) % n;
  const t = c - Math.floor(c);
  const s = t * t * (3 - 2 * t);
  return arr[i] + (arr[j] - arr[i]) * s;
}

function smoothArray(src, dst, radius) {
  const N = src.length;
  for (let i = 0; i < N; i++) {
    let s = 0;
    let w = 0;
    for (let k = -radius; k <= radius; k++) {
      const wt = radius + 1 - Math.abs(k);
      s += src[(i + k + N) % N] * wt;
      w += wt;
    }
    dst[i] = s / w;
  }
}
