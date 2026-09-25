// Сборка мира трассы: геометрия дороги + окружение конкретной локации.
import * as THREE from 'three';
import { Track } from './track.js';
import { buildTrackMeshes, buildBoostPads, buildRamps, buildStartGate, setMaxAnisotropy } from './trackMeshes.js';

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
  scene.traverse((o) => {
    if (o.isMesh && o.receiveShadow === false && !o.userData.noShadow && o.material && o.material.isMeshToonMaterial) o.receiveShadow = true;
    if (o.material && o.material.userData && o.material.userData.outline) o.renderOrder = Math.max(o.renderOrder, 1);
  });

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
      if (env.lights && focus) env.lights.follow(focus);
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
