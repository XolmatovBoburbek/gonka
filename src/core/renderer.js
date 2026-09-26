// Рендерер: сцена → MSAA HalfFloat RT (1 resolve) → bloom-мипы (без blend) → ОДИН финальный проход на экран
// (bloom-сложение + тонмаппинг + аниме-эффекты). Канвас без MSAA и глубины: сглаживание — в RT сцены.
// Уровни качества (applyLevel) меняются на лету без перекомпиляции шейдеров.
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { AnimeShader } from './animeShader.js';

// pixelBudget — максимум пикселей буфера (на HiDPI-экранах не рисуем 4–8 млн пикселей).
export const QUALITY_PRESETS = {
  low: { label: 'Низкое', pixelBudget: 1.0e6, maxPixelRatio: 1, shadows: false, shadowSize: 512, post: true, bloom: false, bloomScale: 0, msaa: 0, particles: 0.45, detail: 0.55, kartLod: 20, outlineLod: 60 },
  medium: { label: 'Среднее', pixelBudget: 2.1e6, maxPixelRatio: 1.35, shadows: true, shadowSize: 1024, post: true, bloom: true, bloomScale: 0.5, msaa: 2, particles: 0.75, detail: 0.8, kartLod: 28, outlineLod: 90 },
  high: { label: 'Высокое', pixelBudget: 3.7e6, maxPixelRatio: 2, shadows: true, shadowSize: 2048, post: true, bloom: true, bloomScale: 1, msaa: 4, particles: 1, detail: 1, kartLod: 40, outlineLod: 140 },
};

// Выделение ярких мест для bloom: 4 отсчёта (при уменьшенном bloom иначе тонкие неоновые линии мерцали бы —
// попадали бы в пропущенные пиксели), порог — на каждый отсчёт. NaN/Inf из HDR-буфера bloom размазал бы
// на весь экран чёрным пятном — такие отсчёты обнуляем.
const HIGH_PASS = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec3 defaultColor;
  uniform float defaultOpacity;
  uniform float luminosityThreshold;
  uniform float smoothWidth;
  uniform vec2 uSrcTexel;
  varying vec2 vUv;
  vec4 bright(vec2 o) {
    vec4 t = texture2D(tDiffuse, vUv + o * uSrcTexel);
    if (any(isnan(t)) || any(isinf(t))) return vec4(0.0);
    float a = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, luminance(t.rgb));
    return mix(vec4(defaultColor, defaultOpacity), t, a);
  }
  void main() {
    gl_FragColor = 0.25 * (bright(vec2(-1.0, -1.0)) + bright(vec2(1.0, -1.0)) + bright(vec2(-1.0, 1.0)) + bright(vec2(1.0, 1.0)));
  }`;

/** UnrealBloomPass без финального аддитивного смешивания в буфер сцены: результат — this.texture. */
class BloomMips extends UnrealBloomPass {
  constructor(...args) {
    super(...args);
    const m = this.materialHighPassFilter; // m.uniforms === this.highPassUniforms
    m.uniforms.uSrcTexel = { value: new THREE.Vector2() };
    m.fragmentShader = HIGH_PASS;
  }

  /** b — доля разрешения bloom; sw, sh — размер буфера сцены. */
  setSource(b, sw, sh) {
    // b=1: все 4 отсчёта в центре блока 2×2 — ровно как у штатного UnrealBloomPass; b<1: четыре блока 2×2
    const k = b < 1 ? 0.5 / b : 0;
    this.highPassUniforms.uSrcTexel.value.set(k / sw, k / sh);
  }

  render(renderer, writeBuffer, readBuffer) {
    const fs = this._fsQuad;
    renderer.getClearColor(this._oldClearColor);
    this._oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    this.highPassUniforms.tDiffuse.value = readBuffer.texture;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    fs.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    fs.render(renderer);

    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      fs.material = m;
      m.uniforms.colorTexture.value = input.texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      fs.render(renderer);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      fs.render(renderer);
      input = this.renderTargetsVertical[i];
    }

    fs.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
    this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
    this.compositeMaterial.uniforms.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    fs.render(renderer);

    renderer.setClearColor(this._oldClearColor, this._oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }

  get texture() {
    return this.renderTargetsHorizontal[0].texture;
  }
}

const _v2 = new THREE.Vector2();

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // на канвас рисуется только полноэкранный проход — MSAA и глубина ему не нужны
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    const r = this.renderer;
    r.debug.checkShaderErrors = !import.meta.env.PROD; // в сборке не ждём синхронно линковку шейдеров
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false; // обновляем сами — можно реже, чем каждый кадр
    r.setClearColor(0x000000, 1);

    // без рендерящихся float-текстур (редкие драйверы/приватные профили) HDR-буфер был бы "неполным" — чёрный экран
    const gl = r.getContext();
    this.floatRT = r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float');
    this.maxSamples = 0;
    if (this.floatRT) {
      try {
        const s = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
        this.maxSamples = s && s.length ? Math.max(...s) : 0;
      } catch {
        this.maxSamples = 0;
      }
    } else this.maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;

    this.scene = null;
    this.camera = null;
    this.sun = null;
    this.sceneRT = null;
    this.bloomPass = null;
    this.qualityName = 'high';
    this.quality = QUALITY_PRESETS.high;
    // живые "ручки" качества — их двигает автонастройка (см. perf.js)
    this.level = { scale: 1, msaa: 4, bloomScale: 1, shadows: true, shadowEvery: 1 };
    this.pixelRatio = 1;
    this.bloom = { strength: 0.55, radius: 0.5, threshold: 1.3 };
    this.fx = { speed: 0, flash: 0, aberration: 0, vignette: 0.28, saturation: 1.06, contrast: 1.03 };
    this.frameNo = 0;
    this.finalMat = new THREE.ShaderMaterial({
      name: 'AnimeFinal',
      uniforms: THREE.UniformsUtils.clone(AnimeShader.uniforms),
      vertexShader: AnimeShader.vertexShader,
      fragmentShader: AnimeShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.finalQuad = new FullScreenQuad(this.finalMat);
    this.animePass = { uniforms: this.finalMat.uniforms };

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  setQuality(name) {
    this.qualityName = QUALITY_PRESETS[name] ? name : 'high';
    const q = (this.quality = QUALITY_PRESETS[this.qualityName]);
    const shadowsChanged = this.renderer.shadowMap.enabled !== q.shadows;
    this.renderer.shadowMap.enabled = q.shadows;
    this.applyLevel({ scale: 1, msaa: q.msaa, bloomScale: q.bloom ? q.bloomScale : 0, shadows: q.shadows, shadowEvery: 1 }, true);
    // пересобрать программы материалов, если поменялось наличие теней
    if (shadowsChanged && this.scene) {
      this.scene.traverse((o) => {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
      });
    }
  }

  /** Быстрая смена качества: разрешение, MSAA, bloom, частота теней. Шейдеры не перекомпилируются. */
  applyLevel(l, force = false) {
    const prev = this.level;
    this.level = { ...prev, ...l };
    const L = this.level;
    if (!this.floatRT) L.bloomScale = 0; // bloom-буферы UnrealBloomPass всегда HalfFloat — без float-рендера они неполные
    const samples = Math.min(L.msaa, this.maxSamples);
    if (this.sceneRT && this.sceneRT.samples !== samples) {
      this.sceneRT.samples = samples;
      this.sceneRT.dispose(); // пересоздастся при следующем setRenderTarget
    }
    if (L.bloomScale > 0 && !this.bloomPass) {
      this.bloomPass = new BloomMips(new THREE.Vector2(2, 2), this.bloom.strength, this.bloom.radius, this.bloom.threshold);
    }
    this._applyShadowVisibility();
    if (force || prev.scale !== L.scale || prev.bloomScale !== L.bloomScale) this.resize();
  }

  _applyShadowVisibility() {
    // "выключить тени" без перекомпиляции: интенсивность 0 и карта не обновляется
    if (this.sun && this.sun.shadow) this.sun.shadow.intensity = this.level.shadows ? 1 : 0;
  }

  setView(scene, camera, sun = null) {
    this.scene = scene;
    this.camera = camera;
    this.sun = sun;
    this._applyShadowVisibility();
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  setBloom({ strength, radius, threshold } = {}) {
    if (strength !== undefined) this.bloom.strength = strength;
    if (radius !== undefined) this.bloom.radius = radius;
    if (threshold !== undefined) this.bloom.threshold = threshold;
    if (this.bloomPass) {
      this.bloomPass.strength = this.bloom.strength;
      this.bloomPass.radius = this.bloom.radius;
      this.bloomPass.threshold = this.bloom.threshold;
    }
  }

  /** Прогрев шейдеров под настоящий буфер сцены (для экрана three собрал бы другие варианты программ). */
  async prewarm(scene = this.scene, camera = this.camera) {
    if (!scene || !camera) return;
    const R = this.renderer;
    const prev = R.getRenderTarget();
    let done;
    try {
      R.setRenderTarget(this.sceneRT);
      done = R.compileAsync(scene, camera);
    } catch {
      /* не критично */
    } finally {
      R.setRenderTarget(prev);
    }
    try {
      await done;
    } catch {
      /* не критично */
    }
    // программы теней собираются, когда объект впервые попадает в коробку теней (compile() их не видит) —
    // один раз рисуем карту теней с коробкой на весь мир, пока открыт экран загрузки
    const sun = this.sun;
    if (sun && sun.castShadow && R.shadowMap.enabled) {
      const c = sun.shadow.camera;
      const saved = [c.left, c.right, c.top, c.bottom, c.near, c.far];
      c.left = c.bottom = -3000;
      c.right = c.top = 3000;
      c.near = 0.5;
      c.far = 6000;
      c.updateProjectionMatrix();
      // three.js рисует тени общим материалом глубины и меняет ему программу только при смене инстансинга —
      // варианты с картой/стороной, не попавшие на такую смену, собрались бы посреди гонки (после смены
      // ступени качества порядок теней другой). Здесь заставляем выбирать программу для каждого объекта.
      const hooked = [];
      const reselect = (r, o, cam, sc, geo, depthMat) => {
        depthMat.needsUpdate = true;
      };
      scene.traverse((o) => {
        if (o.castShadow && !Object.prototype.hasOwnProperty.call(o, 'onBeforeShadow')) {
          o.onBeforeShadow = reselect;
          hooked.push(o);
        }
      });
      try {
        R.shadowMap.needsUpdate = true;
        R.setRenderTarget(this.sceneRT);
        R.render(scene, camera);
      } catch {
        /* не критично */
      } finally {
        for (const o of hooked) delete o.onBeforeShadow;
        R.setRenderTarget(prev);
        [c.left, c.right, c.top, c.bottom, c.near, c.far] = saved;
        c.updateProjectionMatrix();
        R.shadowMap.needsUpdate = true;
      }
    }
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const q = this.quality;
    const base = Math.min(window.devicePixelRatio || 1, q.maxPixelRatio, Math.sqrt(q.pixelBudget / (w * h)));
    this.pixelRatio = Math.max(0.5, base * this.level.scale);
    const R = this.renderer;
    R.setPixelRatio(this.pixelRatio);
    R.setSize(w, h, false);
    const size = R.getDrawingBufferSize(_v2);
    if (!this.sceneRT) {
      this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: this.floatRT ? THREE.HalfFloatType : THREE.UnsignedByteType,
        samples: Math.min(this.level.msaa, this.maxSamples),
      });
      this.sceneRT.resolveDepthBuffer = false; // глубину после прохода сцены никто не читает
    } else this.sceneRT.setSize(size.x, size.y);
    if (this.bloomPass) {
      const b = this.level.bloomScale || 1;
      this.bloomPass.setSize(Math.max(4, Math.round(size.x * b)), Math.max(4, Math.round(size.y * b)));
      this.bloomPass.setSource(b, size.x, size.y);
    }
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.finalMat.uniforms.uAspect.value = w / h;
    this.width = w;
    this.height = h;
  }

  render(dt, time) {
    if (!this.scene || !this.camera) return;
    const R = this.renderer;
    const L = this.level;
    this.frameNo++;
    if (R.shadowMap.enabled) {
      // карта только что пересоздана (смена размера) — отрисовать обязательно, иначе сцена сэмплит пустую карту
      const fresh = this.sun && this.sun.castShadow && !this.sun.shadow.map;
      R.shadowMap.needsUpdate = fresh || (L.shadows && this.frameNo % L.shadowEvery === 0);
    }

    R.setRenderTarget(this.sceneRT);
    R.render(this.scene, this.camera);
    const bloomOn = !!this.bloomPass && L.bloomScale > 0;
    if (bloomOn) this.bloomPass.render(R, null, this.sceneRT);

    const u = this.finalMat.uniforms;
    u.tDiffuse.value = this.sceneRT.texture;
    u.tBloom.value = bloomOn ? this.bloomPass.texture : null;
    u.uBloom.value = bloomOn ? 1 : 0;
    u.uTime.value = time;
    u.uSpeed.value = this.fx.speed;
    u.uFlash.value = this.fx.flash;
    u.uAberration.value = this.fx.aberration;
    u.uVignette.value = this.fx.vignette;
    u.uSaturation.value = this.fx.saturation;
    u.uContrast.value = this.fx.contrast;
    R.setRenderTarget(null);
    this.finalQuad.render(R);
  }

  get info() {
    return this.renderer.info;
  }
}
