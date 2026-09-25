// Финальный (единственный полноэкранный) проход: bloom-сложение, тонмаппинг, sRGB и "аниме"-эффекты —
// манга-линии скорости, вспышки, виньетка, хроматическая аберрация, насыщенность.
import * as THREE from 'three';

export const AnimeShader = {
  name: 'AnimeShader',
  uniforms: {
    tDiffuse: { value: null }, // линейный HDR-кадр сцены
    tBloom: { value: null },
    uBloom: { value: 0 }, // 0 — bloom выключен
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uSpeedColor: { value: new THREE.Color(1, 1, 1) },
    uVignette: { value: 0.28 },
    uVignetteColor: { value: new THREE.Color(0.08, 0.02, 0.12) },
    uAberration: { value: 0 },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.03 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uAspect: { value: 1 },
    uCenter: { value: new THREE.Vector2(0.5, 0.55) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float uBloom;
    uniform float uTime;
    uniform float uSpeed;
    uniform vec3 uSpeedColor;
    uniform float uVignette;
    uniform vec3 uVignetteColor;
    uniform float uAberration;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform float uAspect;
    uniform vec2 uCenter;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec3 hdr(vec2 p) {
      vec3 c = texture2D(tDiffuse, p).rgb;
      if (uBloom > 0.0) c += texture2D(tBloom, p).rgb;
      // NaN/Inf-пиксель (капризы драйвера) — просто чёрная точка, а не отравленная картинка
      return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : c;
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - uCenter;
      vec2 da = vec2(d.x * uAspect, d.y);
      float r = length(da);

      vec3 col;
      if (uAberration > 0.0005) {
        vec2 off = d * uAberration * r;
        col = vec3(hdr(uv + off).r, hdr(uv).g, hdr(uv - off).b);
      } else {
        col = hdr(uv);
      }
      // тонмаппинг и перевод в sRGB (функции three подставляет в шейдер при рендере на экран)
      col = toneMapping(col);
      col = linearToOutputTexel(vec4(col, 1.0)).rgb;

      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;

      // Манга-линии скорости: лучи от центра, мерцают ~20 раз в секунду.
      if (uSpeed > 0.001) {
        float ang = atan(da.y, da.x) / 6.2831853 + 0.5;
        float cells = 260.0;
        float fc = ang * cells;
        float cell = floor(fc);
        float tt = floor(uTime * 20.0);
        float rnd = hash12(vec2(cell, tt));
        float on = step(1.0 - 0.32 * uSpeed, rnd);
        float w = fract(fc);
        float th = 0.18 + 0.32 * hash12(vec2(cell, tt + 7.0));
        float line = smoothstep(0.5 - th * 0.5, 0.5 - th * 0.5 + 0.1, w) *
                     (1.0 - smoothstep(0.5 + th * 0.5 - 0.1, 0.5 + th * 0.5, w));
        float start = 0.3 + 0.28 * hash12(vec2(cell, tt + 3.0));
        float radial = smoothstep(start, start + 0.35, r);
        col = mix(col, uSpeedColor, clamp(line * on * radial * 0.8 * uSpeed, 0.0, 1.0));
      }

      float vig = smoothstep(0.45, 1.05, r);
      col = mix(col, col * uVignetteColor * 3.0, vig * uVignette);
      col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};
