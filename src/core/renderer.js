// Рендерер + пост-обработка (bloom, тонмаппинг, аниме-проход) и адаптивное качество.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { AnimeShader } from './animeShader.js';

export const QUALITY_PRESETS = {
  low: { label: 'Низкое', maxPixelRatio: 1, shadows: false, shadowSize: 512, post: false, bloom: false, msaa: 0, particles: 0.45, detail: 0.55 },
  medium: { label: 'Среднее', maxPixelRatio: 1.35, shadows: true, shadowSize: 1024, post: true, bloom: true, msaa: 2, particles: 0.75, detail: 0.8 },
  high: { label: 'Высокое', maxPixelRatio: 2, shadows: true, shadowSize: 2048, post: true, bloom: true, msaa: 4, particles: 1, detail: 1 },
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setClearColor(0x000000, 1);

    this.scene = null;
    this.camera = null;
    this.composer = null;
    this.bloomPass = null;
    this.animePass = null;
    this.qualityName = 'high';
    this.quality = QUALITY_PRESETS.high;
    this.pixelRatio = 1;
    this.dynamicScale = 1; // адаптивное разрешение
    this.bloom = { strength: 0.55, radius: 0.5, threshold: 1.3 };
    this.fx = { speed: 0, flash: 0, aberration: 0, vignette: 0.28, saturation: 1.06, contrast: 1.03 };
    this._frameTimes = [];
    this._adaptTimer = 0;
    this.adaptive = true;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  setQuality(name) {
    this.qualityName = QUALITY_PRESETS[name] ? name : 'high';
    this.quality = QUALITY_PRESETS[this.qualityName];
    this.dynamicScale = 1;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this._rebuildComposer();
    this.resize();
    // пересобрать программы материалов, если поменялись тени
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => (m.needsUpdate = true));
        }
      });
    }
  }

  setView(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    if (this.renderPass) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
    }
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

  _rebuildComposer() {
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      this.composer.passes.forEach((p) => p.dispose && p.dispose());
      this.composer = null;
    }
    this.bloomPass = null;
    this.animePass = null;
    this.renderPass = null;
    if (!this.quality.post) return;

    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: this.quality.msaa,
    });
    const composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene || new THREE.Scene(), this.camera || new THREE.PerspectiveCamera());
    composer.addPass(this.renderPass);
    if (this.quality.bloom) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.bloom.strength, this.bloom.radius, this.bloom.threshold);
      composer.addPass(this.bloomPass);
    }
    composer.addPass(new OutputPass());
    this.animePass = new ShaderPass(AnimeShader);
    composer.addPass(this.animePass);
    this.composer = composer;
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio) * this.dynamicScale;
    this.pixelRatio = Math.max(0.5, pr);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
    }
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.animePass) this.animePass.uniforms.uAspect.value = w / h;
    this.width = w;
    this.height = h;
  }

  render(dt, time) {
    if (!this.scene || !this.camera) return;
    this._adapt(dt);
    if (this.composer) {
      const u = this.animePass.uniforms;
      u.uTime.value = time;
      u.uSpeed.value = this.fx.speed;
      u.uFlash.value = this.fx.flash;
      u.uAberration.value = this.fx.aberration;
      u.uVignette.value = this.fx.vignette;
      u.uSaturation.value = this.fx.saturation;
      u.uContrast.value = this.fx.contrast;
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // Адаптивное разрешение: если кадры долгие — снижаем плотность пикселей, и наоборот.
  _adapt(dt) {
    if (!this.adaptive || !(dt > 0)) return;
    this._frameTimes.push(dt);
    this._adaptTimer += dt;
    if (this._adaptTimer < 2.5) return;
    const arr = this._frameTimes.slice().sort((a, b) => a - b);
    const median = arr[Math.floor(arr.length / 2)];
    this._frameTimes.length = 0;
    this._adaptTimer = 0;
    let changed = false;
    if (median > 1 / 42 && this.dynamicScale > 0.6) {
      this.dynamicScale = Math.max(0.6, this.dynamicScale - 0.15);
      changed = true;
    } else if (median < 1 / 58 && this.dynamicScale < 1) {
      this.dynamicScale = Math.min(1, this.dynamicScale + 0.1);
      changed = true;
    }
    if (changed) this.resize();
  }

  get info() {
    return this.renderer.info;
  }
}
