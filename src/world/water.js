// Стилизованная аниме-вода: цвет по глубине (из карты высот рельефа), пена у берегов,
// рисованные блики-"искорки" и солнечная дорожка.
import * as THREE from 'three';

const vert = /* glsl */ `
  uniform float uTime;
  uniform float uWave;
  varying vec3 vWorld;
  varying vec3 vView;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.y += (sin(wp.x * 0.08 + uTime * 1.1) + cos(wp.z * 0.07 + uTime * 0.9)) * uWave;
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    vView = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const frag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uLevel;
  uniform sampler2D uHeight;
  uniform vec2 uHOrigin;
  uniform float uHSize;
  uniform float uHasHeight;
  uniform float uSparkle;
  uniform float uSunPath;
  varying vec3 vWorld;
  varying vec3 vView;
  #include <fog_pars_fragment>

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }

  void main() {
    float depth = 12.0;
    if (uHasHeight > 0.5) {
      vec2 huv = (vWorld.xz - uHOrigin) / uHSize;
      if (huv.x > 0.0 && huv.y > 0.0 && huv.x < 1.0 && huv.y < 1.0) {
        float th = texture2D(uHeight, huv).r;
        depth = uLevel - th;
      }
    }
    vec3 V = normalize(vView);
    float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
    float dk = smoothstep(0.2, 7.0, depth);
    vec3 col = mix(uShallow, uDeep, dk);
    col = mix(col, uSky, fres * 0.55);

    // ступенчатая рябь (2 тона)
    vec2 p = vWorld.xz * 0.12;
    float n = vnoise(p + vec2(uTime * 0.25, uTime * 0.18)) * 0.6 + vnoise(p * 2.3 - vec2(uTime * 0.3, -uTime * 0.2)) * 0.4;
    col = mix(col, col * 1.12 + 0.03, step(0.62, n) * 0.6);

    // пена у берега: полосы, бегущие к берегу
    float foamBand = 1.0 - smoothstep(0.0, 1.6, depth);
    float waves = step(0.55, fract(depth * 0.9 - uTime * 0.35 + vnoise(vWorld.xz * 0.3) * 0.6));
    float foam = max(step(0.7, foamBand), waves * step(0.25, foamBand) * 0.9);
    col = mix(col, uFoam, foam * step(0.02, depth + 0.5));

    // солнечная дорожка + искры
    vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
    float sd = max(dot(R, uSunDir), 0.0);
    float glint = vnoise(vWorld.xz * 0.9 + uTime * 0.7) * vnoise(vWorld.xz * 1.7 - uTime * 0.5);
    float path = pow(sd, 18.0) * uSunPath;
    float sparkle = step(0.55 - path * 0.35, glint) * (pow(sd, 6.0) * uSunPath + uSparkle * 0.25 * step(0.8, glint));
    col += uSunColor * (sparkle * 1.6 + path * 0.35);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function createWater(opts = {}) {
  const size = opts.size ?? 3000;
  const geo = new THREE.PlaneGeometry(size, size, opts.segments ?? 64, opts.segments ?? 64);
  geo.rotateX(-Math.PI / 2);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uWave: { value: opts.wave ?? 0.12 },
      uDeep: { value: new THREE.Color(opts.deep ?? 0x1f6fb8) },
      uShallow: { value: new THREE.Color(opts.shallow ?? 0x5fe0d8) },
      uFoam: { value: new THREE.Color(opts.foam ?? 0xffffff) },
      uSky: { value: new THREE.Color(opts.sky ?? 0xbfe4ff) },
      uSunDir: { value: (opts.sunDir ?? new THREE.Vector3(0.3, 0.5, -0.8)).clone().normalize() },
      uSunColor: { value: new THREE.Color(opts.sunColor ?? 0xfff2d0) },
      uLevel: { value: opts.level ?? 0 },
      uHeight: { value: null },
      uHOrigin: { value: new THREE.Vector2() },
      uHSize: { value: 1 },
      uHasHeight: { value: 0 },
      uSparkle: { value: opts.sparkle ?? 1 },
      uSunPath: { value: opts.sunPath ?? 1 },
    },
  ]);
  if (opts.heightMap) {
    uniforms.uHeight.value = opts.heightMap.tex;
    uniforms.uHOrigin.value.copy(opts.heightMap.origin);
    uniforms.uHSize.value = opts.heightMap.size;
    uniforms.uHasHeight.value = 1;
  }
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, fog: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(opts.center?.x ?? 0, opts.level ?? 0, opts.center?.z ?? 0);
  mesh.receiveShadow = false;
  mesh.name = 'water';
  mesh.userData.update = (dt) => {
    uniforms.uTime.value += dt;
  };
  return mesh;
}
