// Ландшафт вокруг трассы: базовая высота из функции + плавное "прилегание" к дороге.
// Также запекает карту высот в текстуру (для воды: мелководье, пена у берега).
import * as THREE from 'three';
import { toon } from './toon.js';
import { smoothstep, lerp } from './noise.js';

export function buildTerrain(track, opts = {}) {
  const size = opts.size ?? 1100;
  const seg = opts.segments ?? 220;
  const center = opts.center ?? track.bounds.getCenter(new THREE.Vector3());
  const heightFn = opts.height ?? (() => 0);
  const colorFn = opts.color ?? (() => new THREE.Color(0x7ccf62));
  const blendOuter = opts.blendOuter ?? 40;
  const drop = opts.roadDrop ?? 0.14;

  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const heights = new Float32Array(pos.count);
  const infos = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + center.x;
    const z = pos.getZ(i) + center.z;
    let h = heightFn(x, z);
    let road = 0;
    const { dist, index } = track.distanceTo(x, z, blendOuter + 40);
    if (index >= 0 && !(track.flags[index] & 1)) {
      const P = track.pos[index];
      const R = track.right[index];
      const edge = track.hw[index] + track.wall[index] + 1.2;
      const lat = (x - P.x) * R.x + (z - P.z) * R.z;
      const latC = Math.max(-edge, Math.min(edge, lat));
      const roadY = P.y + R.y * latC - drop;
      const t = smoothstep(edge - 0.5, edge + blendOuter, dist);
      h = lerp(roadY, h, t);
      road = 1 - smoothstep(track.hw[index] + track.wall[index], edge + 6, dist);
    }
    if (opts.post) h = opts.post(x, z, h, road);
    pos.setXYZ(i, x, h, z);
    heights[i] = h;
    infos[i] = road;
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const c = colorFn(pos.getX(i), pos.getZ(i), heights[i], { road: infos[i], slope: 1 - nrm.getY(i) });
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const mat = opts.material ?? toon(0xffffff, { vertexColors: true, ramp: 'terrain' });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // сэмплер высоты (билинейно по сетке)
  const step = size / seg;
  const x0 = center.x - size / 2;
  const z0 = center.z - size / 2;
  const heightAt = (x, z) => {
    const gx = (x - x0) / step;
    const gz = (z - z0) / step;
    if (gx < 0 || gz < 0 || gx >= seg || gz >= seg) return heightFn(x, z);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const row = seg + 1;
    const h00 = heights[iz * row + ix];
    const h10 = heights[iz * row + ix + 1];
    const h01 = heights[(iz + 1) * row + ix];
    const h11 = heights[(iz + 1) * row + ix + 1];
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  };
  const roadAt = (x, z) => {
    const gx = Math.round((x - x0) / step);
    const gz = Math.round((z - z0) / step);
    if (gx < 0 || gz < 0 || gx > seg || gz > seg) return 0;
    return infos[gz * (seg + 1) + gx];
  };

  // текстура высот для воды
  const heightTexture = () => {
    const n = seg + 1;
    const data = new Uint16Array(n * n);
    for (let i = 0; i < n * n; i++) data[i] = THREE.DataUtils.toHalfFloat(heights[i]);
    const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    // смещение на пол-текселя: центры текселей совпадают с вершинами сетки
    return { tex, origin: new THREE.Vector2(x0 - step / 2, z0 - step / 2), size: size + step };
  };

  return { mesh, heightAt, roadAt, heightTexture, center, size };
}

/** Огромная "подложка" до горизонта — чтобы не было видно края мира. */
export function buildFarGround(color, y = -2, radius = 3000, inner = 0) {
  const geo = inner > 0 ? new THREE.RingGeometry(inner, radius, 64, 1) : new THREE.CircleGeometry(radius, 64);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.name = 'farGround';
  return m;
}
