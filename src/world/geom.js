// Геометрические помощники для процедурных моделей.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { normalizeGeometry, paint } from './toon.js';

/**
 * Сужающаяся трубка вдоль сглаженного пути (пряди волос, хвосты, стволы пальм).
 * radius: число или функция t(0..1) -> радиус.
 */
export function taperedTube(points, radius, radialSegments = 8, lengthSegments = null, capStart = true) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const segs = lengthSegments ?? Math.max(6, points.length * 5);
  const frames = curve.computeFrenetFrames(segs, false);
  const rf = typeof radius === 'function' ? radius : () => radius;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const P = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const r = rf(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radialSegments; j++) {
      const a = (j / radialSegments) * Math.PI * 2;
      n.set(0, 0, 0).addScaledVector(N, Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
      positions.push(P.x + n.x * r, P.y + n.y * r, P.z + n.z * r);
      normals.push(n.x, n.y, n.z);
      uvs.push(j / radialSegments, t);
    }
  }
  const row = radialSegments + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  if (capStart) {
    const start = curve.getPointAt(0);
    const tan = curve.getTangentAt(0).negate();
    const ci = positions.length / 3;
    positions.push(start.x, start.y, start.z);
    normals.push(tan.x, tan.y, tan.z);
    uvs.push(0.5, 0);
    for (let j = 0; j < radialSegments; j++) indices.push(ci, j + 1, j);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** Капсула между двумя точками (руки, ноги, стойки). */
export function limb(from, to, radius, radial = 10) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(radius, Math.max(0.001, len), 4, radial);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Цилиндр между двумя точками. */
export function rod(from, to, r0, r1 = r0, radial = 8) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, radial);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Точка на сфере: theta от макушки (0) вниз, phi — азимут в соглашении SphereGeometry (0.5π = +Z). */
export function onSphere(r, theta, phi, center = [0, 0, 0]) {
  return new THREE.Vector3(
    center[0] - r * Math.cos(phi) * Math.sin(theta),
    center[1] + r * Math.cos(theta),
    center[2] + r * Math.sin(phi) * Math.sin(theta)
  );
}

/**
 * Собирает детали по ключам материалов и сливает в минимум мешей.
 * add(key, geometry) ... build(materials) -> Group
 */
export class PartBuilder {
  constructor() {
    this.parts = new Map();
  }
  add(key, geometry) {
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(normalizeGeometry(geometry));
    return this;
  }
  has(key) {
    return this.parts.has(key);
  }
  merged(key) {
    const list = this.parts.get(key);
    if (!list || !list.length) return null;
    return mergeGeometries(list);
  }
  allMerged(filter = null) {
    const list = [];
    for (const [k, arr] of this.parts) {
      if (filter && !filter(k)) continue;
      list.push(...arr);
    }
    return list.length ? mergeGeometries(list) : null;
  }
  /** Все детали (кроме exclude) — в ОДИН меш с вершинными цветами из palette[key]. */
  buildColored(palette, material, { exclude = [], castShadow = true } = {}) {
    const list = [];
    for (const [key, arr] of this.parts) {
      if (exclude.includes(key)) continue;
      if (palette[key] === undefined) throw new Error('Нет цвета для ' + key);
      for (const g of arr) list.push(paint(g.clone(), palette[key]));
    }
    if (!list.length) return null;
    const mesh = new THREE.Mesh(mergeGeometries(list), material);
    mesh.castShadow = castShadow;
    return mesh;
  }

  build(materials, { castShadow = true, receiveShadow = false } = {}) {
    const group = new THREE.Group();
    for (const [key] of this.parts) {
      const geo = this.merged(key);
      if (!geo) continue;
      const mat = materials[key];
      if (!mat) throw new Error('Нет материала для ' + key);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.name = key;
      group.add(mesh);
    }
    return group;
  }
}

/**
 * Быстрое расстояние до ломаной в плоскости XZ (реки, береговые линии) через сетку-бакеты.
 * points: [[x, z], ...] или Vector3[]; maxDist — дальше этого возвращается maxDist.
 */
export class PolylineDistance {
  constructor(points, { cell = 40, maxDist = 80 } = {}) {
    this.pts = points.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : { x: p.x, z: p.z }));
    this.cell = cell;
    this.maxDist = maxDist;
    this.grid = new Map();
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i];
      const b = this.pts[i + 1];
      const x0 = Math.floor((Math.min(a.x, b.x) - maxDist) / cell);
      const x1 = Math.floor((Math.max(a.x, b.x) + maxDist) / cell);
      const z0 = Math.floor((Math.min(a.z, b.z) - maxDist) / cell);
      const z1 = Math.floor((Math.max(a.z, b.z) + maxDist) / cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = cx * 73856093 + cz * 19349663;
          let arr = this.grid.get(k);
          if (!arr) this.grid.set(k, (arr = []));
          arr.push(i);
        }
      }
    }
  }
  dist(x, z) {
    const k = Math.floor(x / this.cell) * 73856093 + Math.floor(z / this.cell) * 19349663;
    const arr = this.grid.get(k);
    if (!arr) return this.maxDist;
    let best = this.maxDist * this.maxDist;
    for (const i of arr) {
      const a = this.pts[i];
      const b = this.pts[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)));
      const dx = x - (a.x + abx * t);
      const dz = z - (a.z + abz * t);
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
}
