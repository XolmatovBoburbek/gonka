// Сборка мира трассы: геометрия дороги + окружение конкретной локации.
import * as THREE from 'three';
import { Track } from './track.js';
import { buildTrackMeshes, buildBoostPads, buildRamps, buildStartGate, setMaxAnisotropy } from './trackMeshes.js';

// Свои материалы глубины для инстансов: с одним общим MeshDepthMaterial three.js заново выбирает программу
// (getProgram) на каждом стыке InstancedMesh ↔ обычный меш и "с цветом инстансов ↔ без" — десятки раз за кадр.
// Сторона — как у three.js для теней по умолчанию (задние грани у односторонних материалов).
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const depthMats = new Map();
const _sphere = new THREE.Sphere();

function instancedDepthMaterial(o) {
  const side = o.material.shadowSide ?? SHADOW_SIDE[o.material.side];
  const key = `${!!o.instanceColor}_${side}`;
  if (!depthMats.has(key)) depthMats.set(key, new THREE.MeshDepthMaterial({ side }));
  return depthMats.get(key);
}

export function buildWorld(def, ctx) {
  if (ctx.renderer) setMaxAnisotropy(Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()));
  const scene = new THREE.Scene();
  const track = new Track(def.track);
  if (def.prepare) def.prepare(track);

  const meshes = buildTrackMeshes(track, def.theme);
  scene.add(meshes.group);
  const pads = buildBoostPads(track, def.boostPads || [], def.theme.boost);
  scene.add(pads.group);
  const ramps = buildRamps(track, def.ramps || [], def.theme.ramp);
  scene.add(ramps.group);
  const gate = buildStartGate(track, def.theme.gate || {});
  scene.add(gate.group);

  const env = def.build({ scene, track, quality: ctx.quality, renderer: ctx.renderer });
  const updaters = [...meshes.updaters, pads.update, ...(env.updaters || [])];

  // все меши принимают тени, кроме помеченных; контуры рисуются после непрозрачных (early-z отбрасывает закрытое)
  const users = new Map(); // материал → меши по вариантам программы: 0 — обычный, 1 — инстансы, 2 — инстансы с цветом
  const hulls = []; // контуры декораций для дальнего LOD (см. update); у движущихся без отсечения (поезд) сфера неизвестна
  scene.traverse((o) => {
    if (o.isMesh && o.receiveShadow === false && !o.userData.noShadow && o.material && o.material.isMeshToonMaterial) o.receiveShadow = true;
    if (o.material && o.material.userData && o.material.userData.outline) o.renderOrder = Math.max(o.renderOrder, 1);
    if (!o.isMesh || Array.isArray(o.material)) return;
    if (o.isInstancedMesh && o.castShadow && !o.customDepthMaterial) o.customDepthMaterial = instancedDepthMaterial(o);
    if (o.material.userData.outline && o.frustumCulled && o.visible) {
      const src = o.isInstancedMesh ? o : o.geometry;
      if (!src.boundingSphere) src.computeBoundingSphere();
      hulls.push({ mesh: o, sphere: src.boundingSphere });
    }
    const kind = o.isInstancedMesh ? (o.instanceColor ? 2 : 1) : 0;
    if (!users.has(o.material)) users.set(o.material, [[], [], []]);
    users.get(o.material)[kind].push(o);
  });
  // то же в основном проходе: материал, общий у разных вариантов, получает копию на каждый следующий вариант
  for (const [m, kinds] of users) {
    for (const list of kinds.filter((l) => l.length).slice(1)) {
      const c = m.clone();
      c.onBeforeCompile = m.onBeforeCompile; // clone() теряет правки шейдера (rim, контур)…
      c.customProgramCacheKey = m.customProgramCacheKey;
      c.userData = m.userData; // …а их uniform'ы должны остаться общими
      if (m.isShaderMaterial) c.uniforms = m.uniforms;
      for (const o of list) o.material = c;
    }
  }
  scene.updateMatrixWorld(); // мировые сферы контуров нужны уже на первом кадре
  const lod = { outline: 140 };
  let lodTick = 0;

  return {
    def,
    scene,
    track,
    lights: env.lights,
    sky: env.sky,
    boostZones: pads.zones,
    rampZones: ramps.zones,
    startGate: gate,
    dustColor: env.dustColor ?? new THREE.Color(0xcbb89a),
    bloom: env.bloom ?? { strength: 0.5, radius: 0.5, threshold: 1.3 },
    exposure: env.exposure ?? 1,
    post: env.post ?? {},
    ambient: env.ambient ?? null,
    minimap: env.minimap ?? {},
    update(dt, camera, focus) {
      for (const u of updaters) u(dt, camera);
      if (env.lights && focus) env.lights.follow(focus, camera);
      // раз в 4 кадра: контуры дальше lod.outline прячем — там они тоньше пикселя, а draw call'ы и треугольники те же
      if (lodTick++ % 4 === 0) {
        for (const h of hulls) {
          _sphere.copy(h.sphere).applyMatrix4(h.mesh.matrixWorld);
          h.mesh.visible = _sphere.distanceToPoint(camera.position) < lod.outline;
        }
      }
    },
    /** Дальности детализации, м: outline — контуры декораций дальше не рисуются (по умолчанию 140). */
    setLod(l) {
      Object.assign(lod, l);
      lodTick = 0; // применить на ближайшем кадре
    },
    setQuality(q) {
      if (env.lights) {
        env.lights.sun.castShadow = q.shadows;
        env.lights.setShadowSize(q.shadowSize);
      }
      if (env.ambient && env.ambient.userData.setCount) env.ambient.userData.setCount(Math.round((env.ambientCount ?? 600) * q.particles));
    },
    dispose() {
      const seen = new Set();
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) {
          seen.add(o.geometry);
          o.geometry.dispose();
        }
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          for (const k of ['map', 'emissiveMap']) if (m[k] && !seen.has(m[k])) (seen.add(m[k]), m[k].dispose());
          // текстуры в uniform'ах шейдеров (небо, вода, вывески и т.п.)
          if (m.uniforms) {
            for (const u of Object.values(m.uniforms)) {
              const v = u && u.value;
              if (v && v.isTexture && !seen.has(v)) {
                seen.add(v);
                v.dispose();
              }
            }
          }
          m.dispose();
        }
      });
      if (env.lights?.sun.shadow.map) env.lights.sun.shadow.map.dispose();
    },
  };
}
