// Главный класс игры: состояния (меню → выбор → гонка → результаты), загрузка локаций,
// демо-гонка на фоне меню, камера, звук, эффекты, связь с интерфейсом.
import * as THREE from 'three';
import { Renderer, QUALITY_PRESETS } from './core/renderer.js';
import { PerfGovernor, PERF_LEVELS, detectGpuTier, startLevelForTier } from './core/perf.js';
import { Input } from './core/input.js';
import { AudioManager } from './core/audio.js';
import { CameraRig } from './race/camera.js';
import { Race } from './race/race.js';
import { buildWorld } from './world/world.js';
import { Effects } from './world/fx.js';
import { TRACKS, loadTrack } from './tracks/index.js';
import { CHARACTERS, getCharacter } from './data/characters.js';
import { UI } from './ui/ui.js';

const SETTINGS_KEY = 'sakura-drift-settings-v1';

function loadSettings() {
  const def = {
    quality: 'auto',
    gfxV: 2,
    music: 0.55,
    sfx: 0.8,
    muted: false,
    difficulty: 'normal',
    laps: 3,
    character: 'sakura',
    track: 'sakura',
    autoGas: true,
  };
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (!s.gfxV) delete s.quality; // старые версии сохраняли 'high' всем — переводим на "Авто"
    return { ...def, ...s, gfxV: 2 };
  } catch {
    return def;
  }
}

const RECORDS_KEY = 'sakura-drift-records-v1';

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}');
  } catch {
    return {};
  }
}

export class Game {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector('canvas');
    this.settings = loadSettings();
    const params = new URLSearchParams(location.search);
    this.params = params;
    if (params.get('quality')) this.settings.quality = params.get('quality');

    this.renderer = new Renderer(this.canvas);
    const gpu = detectGpuTier(this.renderer.renderer.getContext());
    this.perf = new PerfGovernor({ level: startLevelForTier(gpu.tier), onChange: () => this.applyQuality() });
    this.applyQualitySetting(this.settings.quality);
    window.addEventListener('resize', () => this.perf.settle(1));
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 5000);
    this.rig = new CameraRig(this.camera);
    this.input = new Input();
    this.audio = new AudioManager();
    this.audio.setMusicVolume(this.settings.music);
    this.audio.setSfxVolume(this.settings.sfx);
    this.audio.setMuted(this.settings.muted);

    this.world = null;
    this.worldId = null;
    this.race = null;
    this.fx = null;
    this.state = 'boot';
    this.time = 0;
    this.last = performance.now();
    this.paused = false;
    this.finishTimer = 0;
    this.resultsShown = false;
    this.flash = 0;
    this.demoCamTimer = 0;
    this.demoTarget = 0;

    this.records = loadRecords();
    this.ui = new UI(this, root.querySelector('#ui'));

    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'race' && !this.paused && this.race && this.race.state !== 'finished') this.setPaused(true);
    });

    this._loop = (t) => this.frame(t);
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* приватный режим — ничего страшного */
    }
  }

  recordKey(track = this.settings.track, laps = this.settings.laps) {
    return `${track}:${laps}`;
  }

  /** Сохранить результат игрока; вернуть, что побито. */
  saveRecord(kart) {
    const key = this.recordKey();
    const rec = this.records[key] || {};
    const best = kart.lapTimes.length ? Math.min(...kart.lapTimes) : null;
    const out = { race: false, lap: false, prev: { ...rec } };
    if (!rec.race || kart.finishTime < rec.race) {
      rec.race = kart.finishTime;
      rec.char = kart.char.id;
      out.race = true;
    }
    if (best && (!rec.lap || best < rec.lap)) {
      rec.lap = best;
      out.lap = true;
    }
    this.records[key] = rec;
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(this.records));
    } catch {
      /* без сохранения */
    }
    out.current = rec;
    return out;
  }

  async start() {
    this.ui.setLoading(true, 'Загрузка мира…');
    await this.nextFrame();
    await this.loadWorld(this.settings.track);
    this.startDemo();
    await this.prewarm();
    this.ui.setLoading(false);
    this.state = 'menu';
    this.ui.showScreen('title');
    this.audio.playMusic('menu');
    requestAnimationFrame(this._loop);
    if (this.params.has('autostart')) {
      this.settings.track = this.params.get('track') || this.settings.track;
      this.settings.character = this.params.get('char') || this.settings.character;
      await this.startRace({ autopilot: this.params.has('autopilot'), skipIntro: this.params.has('skipintro') });
    }
  }

  nextFrame() {
    return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  }

  async loadWorld(trackId) {
    if (this.worldId === trackId && this.world) return;
    this.disposeRace();
    if (this.world) {
      this.world.dispose();
      this.world = null;
    }
    const q = this.worldPreset();
    let def;
    try {
      def = await loadTrack(trackId);
      this.world = buildWorld(def, { renderer: this.renderer.renderer, quality: q });
    } catch (err) {
      // сломанная локация не должна ронять игру — откатываемся на Сакура-Долину
      console.error('Не удалось загрузить локацию', trackId, err);
      if (trackId === 'sakura') throw err;
      this.settings.track = 'sakura';
      def = await loadTrack('sakura');
      this.world = buildWorld(def, { renderer: this.renderer.renderer, quality: q });
    }
    this.worldId = def.id;
    this.fx = new Effects(this.world.scene);
    this.renderer.setView(this.world.scene, this.camera, this.world.lights && this.world.lights.sun);
    this.applyQuality();
    this.renderer.setBloom(this.world.bloom);
    this.renderer.renderer.toneMappingExposure = this.world.exposure;
    this.renderer.fx.saturation = this.world.post.saturation ?? 1.06;
    this.renderer.fx.vignette = this.world.post.vignette ?? 0.28;
    this.renderer.fx.baseVignette = this.renderer.fx.vignette;
  }

  /** Прогреть шейдеры мира и машинок (иначе первый кадр на новой трассе замирает на компиляции). */
  async prewarm() {
    await this.renderer.prewarm(this.world.scene, this.camera);
    this.perf.settle(2.5);
  }

  disposeRace() {
    if (this.race) {
      this.race.dispose();
      this.race = null;
    }
    if (this.fx) this.fx.clear();
  }

  startDemo() {
    this.disposeRace();
    this.race = new Race({
      world: this.world,
      playerChar: getCharacter(this.settings.character),
      difficulty: 'hard',
      laps: 99,
      fx: this.fx,
      demo: true,
      shadows: this.realShadows(),
    });
    // разбросать карты по трассе, чтобы сразу было интересно
    const L = this.world.track.length;
    this.race.karts.forEach((k, i) => {
      k.placeAt((i * L) / this.race.karts.length + 10, (i % 3) - 1);
      k.lapsDone = 0;
      k.speed = 25;
    });
    this.demoTarget = 0;
    this.demoCamTimer = 0;
  }

  /** Запуск гонки с текущими настройками. */
  async startRace(opts = {}) {
    this.ui.setLoading(true, 'Готовим трассу…');
    await this.nextFrame();
    await this.loadWorld(this.settings.track);
    this.disposeRace();
    const def = await loadTrack(this.settings.track);
    const race = new Race({
      world: this.world,
      playerChar: getCharacter(this.settings.character),
      difficulty: this.settings.difficulty,
      laps: this.settings.laps,
      fx: this.fx,
      shadows: this.realShadows(),
      skipIntro: !!opts.skipIntro,
    });
    // гонка "оживает" только после прогрева шейдеров — иначе кадры во время компиляции крутили бы её как демо
    await this.prewarm();
    this.race = race;
    this.autopilot = !!opts.autopilot;
    this.audio.duck(0, 0.05);
    this.state = 'race';
    this.paused = false;
    this.finishTimer = 0;
    this.resultsShown = false;
    this.flash = 0;
    this.rig.lookBack = false;
    this.ui.setLoading(false);
    this.ui.hideScreens();
    this.ui.hud.show(true, this.race);
    this.ui.hud.intro(def);
    this.audio.stopEngine();
    this.audio.playMusic(def.music);
    this.audio.setMusicIntensity(0);
    this.rig.orbitAngle = 0;
    await this.nextFrame();
  }

  restartRace() {
    this.startRace({ skipIntro: true });
  }

  async toMenu() {
    this.paused = false;
    this.state = 'menu';
    this.audio.stopEngine();
    this.audio.duck(0, 0.05);
    this.ui.hud.show(false);
    this.startDemo();
    this.ui.showScreen('title');
    this.audio.playMusic('menu');
  }

  async previewTrack(trackId) {
    if (this.worldId === trackId) return;
    this.ui.setLoading(true, 'Загрузка локации…');
    await this.nextFrame();
    await this.loadWorld(trackId);
    this.startDemo();
    await this.prewarm();
    this.ui.setLoading(false);
  }

  setQuality(name) {
    this.settings.quality = name;
    this.saveSettings();
    this.applyQualitySetting(name);
    this.renderer.setView(this.world.scene, this.camera, this.world.lights && this.world.lights.sun);
    this.renderer.setBloom(this.world.bloom);
  }

  /** 'auto' — база "Высокое" + автонастройка по FPS; иначе фиксированный пресет. */
  applyQualitySetting(name) {
    const auto = !QUALITY_PRESETS[name];
    this.renderer.setQuality(auto ? 'high' : name);
    this.perf.enabled = auto;
    if (auto) this.perf.settle(1);
    this.applyQuality();
  }

  /** Применить текущую ступень/пресет к рендеру, миру, частицам и теням машинок (без перекомпиляции). */
  applyQuality() {
    let q = this.renderer.quality;
    if (this.perf.enabled) {
      const L = PERF_LEVELS[this.perf.level];
      const glow = this.world && this.world.bloom.threshold < 1.15; // неон: свечение — основа картинки
      this.renderer.applyLevel({ ...L, bloomScale: L.bloomScale || (glow && L.glowBloom) || 0 });
      q = { ...q, shadowSize: L.shadowSize, particles: L.particles };
    }
    if (this.world) this.world.setQuality(q);
    if (this.fx) this.fx.setBudget(q.particles);
    if (this.race) this.race.views.forEach((v) => v.setShadowMode(this.realShadows()));
  }

  /** Настоящие тени у машинок — только если карта теней обновляется каждый кадр. */
  realShadows() {
    const R = this.renderer;
    return R.renderer.shadowMap.enabled && R.level.shadows && R.level.shadowEvery === 1;
  }

  /** Пресет для сборки мира: в "Авто" детализация декораций зависит от текущей ступени. */
  worldPreset() {
    if (!this.perf.enabled) return this.renderer.quality;
    const l = this.perf.level;
    return QUALITY_PRESETS[l >= 5 ? 'low' : l >= 3 ? 'medium' : 'high'];
  }

  setPaused(p) {
    if (this.state !== 'race' || !this.race) return;
    if (this.race.state === 'finished' && p) return;
    this.paused = p;
    this.ui.showPause(p);
    if (p) {
      this.audio.stopEngine();
      this.audio.duck(0.6, 3600); // приглушить музыку, пока открыта пауза
    } else this.audio.duck(0, 0.05);
  }

  // ------------------------------------------------------------------ цикл
  frame(t) {
    requestAnimationFrame(this._loop);
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (!(dt > 0)) dt = 1 / 60;
    if (!this.paused && !document.hidden) this.perf.sample(dt);
    dt = Math.min(dt, 1 / 20);
    this.step(dt);
  }

  /** Один шаг симуляции + рендер (вынесено для тестов). */
  step(dt, render = true) {
    this.time += dt;
    const inp = this.input.poll();
    if (inp.mute) {
      this.settings.muted = this.audio.toggleMute();
      this.saveSettings();
      this.ui.syncSettings();
    }

    if (this.state === 'race' && this.race) {
      if (inp.pause && !this.ui.modal) this.setPaused(!this.paused);
      if (!this.paused) this.updateRace(dt, inp);
    } else if (this.race) {
      // демо на фоне меню
      this.race.update(dt, inp);
      this.handleEvents(this.race.events, true);
      this.updateDemoCamera(dt);
      this.ui.menuInput(inp);
    }

    if (this.world && !this.paused) {
      const focus = this.race ? this.race.player.pos : new THREE.Vector3();
      this.world.update(dt, this.camera, focus);
      this.fx.update(dt, this.camera, this.renderer.height * this.renderer.pixelRatio);
    }
    this.updateScreenFx(dt);
    this.input.endFrame();
    if (render) this.renderer.render(dt, this.time);
  }

  updateDemoCamera(dt) {
    const r = this.race;
    this.demoCamTimer -= dt;
    if (this.demoCamTimer <= 0) {
      this.demoCamTimer = 7 + Math.random() * 4;
      this.demoTarget = (this.demoTarget + 1 + Math.floor(Math.random() * 3)) % r.karts.length;
      this.demoMode = Math.random() < 0.5 ? 'chase' : 'orbit';
      const k = r.karts[this.demoTarget];
      this.rig.snapChase(k);
    }
    let k = r.karts[this.demoTarget];
    if (this.ui.currentScreen === 'select') {
      // на экране выбора камера облетает карт выбранного персонажа
      const sel = r.karts.find((x) => x.char.id === this.settings.character);
      if (sel) k = sel;
      if (this._selKart !== k) {
        this._selKart = k;
        this.rig.snapNext = true;
      }
      this.rig.updateFinish(dt, k);
    } else if (this.demoMode === 'orbit') {
      this.rig.updateFinish(dt, k);
    } else {
      this.rig.updateChase(dt, k);
    }
  }

  updateRace(dt, inp) {
    const race = this.race;
    const player = race.player;
    let input = inp;
    if (this.autopilot && race.state === 'racing' && !player.finished) {
      const ap = race.autoPilot.think(dt, race);
      input = { ...inp, ...ap, item: ap.useItem };
    }
    if (inp.respawn && race.state === 'racing' && !player.finished) player.respawn();
    this.rig.lookBack = inp.lookBack && race.state === 'racing';
    race.update(dt, input);

    // камера
    if (race.state === 'intro') {
      const fr = this.world.track.frameAtProgress(this.world.track.length - 14, {});
      this.rig.updateIntro(dt, race.stateTime, fr.pos, Math.atan2(fr.tan.x, fr.tan.z), player);
    } else if (race.state === 'countdown') {
      if (race.stateTime < dt * 1.5 && race.skipIntro) this.rig.snapChase(player);
      this.rig.updateChase(dt, player);
    } else if (race.state === 'finished') {
      this.finishTimer += dt;
      if (this.finishTimer < 1.2) this.rig.updateChase(dt, player);
      else this.rig.updateFinish(dt, player);
      if (this.finishTimer > 3.2 && !this.resultsShown) {
        this.resultsShown = true;
        this.ui.showResults(race.results(), race.player, this.lastRecord);
        this.audio.playMusic('results');
      }
    } else {
      this.rig.updateChase(dt, player);
    }

    // звук двигателя
    if (race.state === 'racing' && !player.finished) {
      this.audio.updateEngine({
        speed01: Math.abs(player.speed) / 40,
        throttle: input.throttle,
        boosting: player.boost.time > 0,
        drifting: player.drift.active,
        driftLevel: player.drift.level,
        offroad: player.offroad,
        airborne: player.airborne,
      });
    } else if (race.state === 'finished') this.audio.stopEngine();

    this.handleEvents(race.events, false);
    this.ui.hud.update(race, dt);
  }

  /** Реакция на события гонки: звук, частицы, надписи, тряска. */
  handleEvents(events, demo) {
    const race = this.race;
    const player = race.player;
    const a = this.audio;
    const fx = this.fx;
    const near = (k) => {
      if (!k) return 0;
      const d = k.pos.distanceTo(this.camera.position);
      return Math.max(0, 1 - d / 70);
    };
    for (const e of events) {
      const k = e.kart;
      const isP = k === player && !demo;
      const vol = isP ? 1 : near(k) * (demo ? 0.35 : 0.6);
      switch (e.type) {
        case 'countdown':
          a.sfx('countdown');
          this.ui.hud.countdown(e.n);
          break;
        case 'go':
          a.sfx('go');
          this.ui.hud.countdown(0);
          break;
        case 'rocketStart':
          this.ui.hud.banner('РАКЕТНЫЙ СТАРТ!', 'boost');
          fx.popups.show('ВЖУХ!', player.pos, { color: '#6ff3ff', stroke: '#2a4bff' });
          break;
        case 'stall':
          this.ui.hud.banner('Фальстарт…', 'warn');
          break;
        case 'boost':
          if (vol > 0.05 && (e.kind === 'pad' || e.kind === 'item' || e.kind === 'rocket' || e.kind === 'trick')) a.sfx('boost', { volume: vol });
          if (isP) {
            this.rig.shake(e.kind === 'item' ? 0.5 : 0.3);
            if (e.kind === 'item' || e.kind === 'pad') this.flash = Math.max(this.flash, 0.12);
          }
          break;
        case 'miniTurbo':
          if (vol > 0.05) a.sfx('miniturbo' + e.level, { volume: vol });
          if (isP && e.level >= 2) fx.popups.show(e.level === 3 ? 'УЛЬТРА!' : 'ТУРБО!', player.pos, { color: e.level === 3 ? '#ff7ae6' : '#ffb03a', stroke: '#4a1a6a', life: 0.7, scale: 2.4 });
          break;
        case 'driftStart':
          if (vol > 0.05) a.sfx('driftStart', { volume: vol * 0.7 });
          break;
        case 'driftLevel':
          if (isP) a.sfx('driftLevel', { pitch: [1, 1, 1.25, 1.5][e.level] });
          break;
        case 'hop':
          break;
        case 'jump':
          if (vol > 0.05) a.sfx('jump', { volume: vol });
          if (isP) this.ui.hud.hint('Жми ДРИФТ в воздухе — трюк!');
          break;
        case 'trick':
          if (vol > 0.05) a.sfx('trick', { volume: vol });
          if (isP) fx.popups.show('ТРЮК!', player.pos, { color: '#7dff7a', stroke: '#1a6a3a', life: 0.8, scale: 2.4 });
          break;
        case 'land':
          if (vol > 0.05) a.sfx('land', { volume: vol * Math.min(1, e.impact / 20) });
          if (isP) this.rig.shake(0.2);
          break;
        case 'wallHit':
          if (vol > 0.05) a.sfx('wallHit', { volume: vol * Math.min(1, e.strength * 1.5) });
          if (isP) this.rig.shake(0.35 * e.strength + 0.1);
          fx.burst(k.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xffe28a, 8, 5, { size: 0.35, life: 0.35 });
          break;
        case 'bump':
          if (vol > 0.05 || (e.other === player && !demo)) a.sfx('bump', { volume: Math.max(vol, e.other === player ? 0.8 : 0) });
          if (isP || e.other === player) this.rig.shake(0.25);
          break;
        case 'itemBox':
          if (vol > 0.05) a.sfx('itemBox', { volume: vol });
          break;
        case 'rouletteStart':
          if (isP) this.ui.hud.startRoulette(k.pendingItem);
          break;
        case 'itemGet':
          if (isP) {
            a.sfx('itemGet');
            this.ui.hud.setItem(e.item);
          }
          break;
        case 'useTurbo':
          if (isP) {
            this.ui.hud.setItem(null);
            fx.popups.show('ТУРБО!', player.pos, { color: '#ffb03a', stroke: '#b3261e' });
          }
          break;
        case 'useOrb':
          if (vol > 0.05) a.sfx('orbFire', { volume: vol });
          if (isP) this.ui.hud.setItem(null);
          break;
        case 'useShield':
          if (vol > 0.05) a.sfx('shieldUp', { volume: vol });
          if (isP) this.ui.hud.setItem(null);
          break;
        case 'useIce':
          if (vol > 0.05) a.sfx('trapDrop', { volume: vol });
          if (isP) this.ui.hud.setItem(null);
          break;
        case 'shieldBreak':
          if (vol > 0.05) a.sfx('shieldBreak', { volume: vol });
          if (isP) fx.popups.show('БЛОК!', player.pos, { color: '#6fe0ff', stroke: '#1a4a8a' });
          break;
        case 'hit':
          if (e.kind === 'freeze') {
            if (vol > 0.05) a.sfx('freeze', { volume: vol });
            fx.popups.show('ДЗЫНЬ!', k.pos, { color: '#bff4ff', stroke: '#2a6aa8', scale: isP ? 3 : 2.2 });
          } else {
            if (vol > 0.05) {
              a.sfx('hit', { volume: vol });
              a.sfx('spin', { volume: vol * 0.7 });
            }
            fx.popups.show('БАХ!', k.pos, { color: '#ffd84a', stroke: '#d8263a', scale: isP ? 3 : 2.2 });
          }
          if (isP) {
            this.rig.shake(0.8);
            this.flash = Math.max(this.flash, 0.3);
            this.ui.hud.setItem(k.item);
          }
          if (race.views) {
            const v = race.views[race.karts.indexOf(k)];
            if (v) v.setExpression('hurt', 1.6);
          }
          if (e.by === player && !demo && k !== player) this.ui.hud.banner('Попадание!', 'hit');
          break;
        case 'unfreeze':
          if (vol > 0.05) a.sfx('shatter', { volume: vol });
          break;
        case 'lap':
          if (isP) {
            a.sfx('lap');
            this.ui.hud.lapBanner(e.lap, race.laps);
          }
          break;
        case 'finalLap':
          if (isP) {
            a.sfx('finalLap');
            a.setMusicIntensity(1);
            this.ui.hud.banner('ФИНАЛЬНЫЙ КРУГ!', 'final');
          }
          break;
        case 'finish':
          if (k === player && !demo) {
            this.lastRecord = this.saveRecord(k);
            const good = e.place <= 3;
            a.sfx(good ? 'finishWin' : 'finishLose');
            a.duck(0.4, 3);
            this.ui.hud.finish(e.place);
            fx.confetti(player.pos.clone().add(new THREE.Vector3(0, 2, 0)), good ? 120 : 50, 10);
            const v = race.views[race.karts.indexOf(k)];
            if (v) v.setExpression(good ? 'happy' : 'normal', 999);
          } else if (!demo) {
            const v = race.views[race.karts.indexOf(k)];
            if (v && e.place <= 3) v.setExpression('happy', 999);
          }
          break;
        case 'wrongWay':
          if (isP) {
            this.ui.hud.wrongWay(e.on);
            if (e.on) a.sfx('wrongWay');
          }
          break;
        case 'place':
          if (!demo) this.ui.hud.placeChanged(e.from, e.to);
          break;
        case 'respawn':
          if (isP) this.flash = Math.max(this.flash, 0.5);
          break;
        case 'orbHit':
        case 'trapHit':
          break;
      }
    }
  }

  updateScreenFx(dt) {
    const fxr = this.renderer.fx;
    let speed = 0;
    let aberr = 0;
    if (this.race && this.state === 'race' && !this.paused) {
      const p = this.race.player;
      const s01 = Math.abs(p.speed) / 40;
      if (p.boost.time > 0) {
        speed = Math.min(1, 0.55 + (s01 - 1) * 1.5);
        aberr = 0.012;
      } else if (s01 > 0.93) speed = (s01 - 0.93) * 3;
    }
    // сглаженное значение "залипло" бы на NaN навсегда (и залило экран чёрным), а отрицательное гасит виньетку
    speed = Number.isFinite(speed) ? Math.min(1, Math.max(0, speed)) : 0;
    if (!Number.isFinite(this.flash)) this.flash = 0;
    fxr.speed += (speed - fxr.speed) * (1 - Math.exp(-dt * 8));
    fxr.aberration += (aberr - fxr.aberration) * (1 - Math.exp(-dt * 6));
    this.flash *= Math.exp(-dt * 5);
    fxr.flash = this.flash;
    fxr.vignette = (fxr.baseVignette ?? 0.28) + fxr.speed * 0.25;
  }

  // ------------------------------------------------------------------ тестовые помощники
  /** Прокрутить симуляцию без рендера (для автотестов). */
  simulate(seconds, dt = 1 / 60) {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) this.step(dt, false);
  }

  /** Сколько draw calls (без теней) дают группы сцены — для профилирования. */
  debugBreakdown() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const out = {};
    this.world.scene.traverseVisible((o) => {
      if (!(o.isMesh || o.isPoints || o.isSprite)) return;
      if (o.frustumCulled && !o.isSprite && !frustum.intersectsObject(o)) return;
      let top = o;
      while (top.parent && top.parent !== this.world.scene) top = top.parent;
      const key = top.name || top.type;
      out[key] = (out[key] || 0) + 1;
    });
    return out;
  }

  debugState() {
    const r = this.race;
    if (!r) return null;
    return {
      state: r.state,
      raceTime: r.raceTime,
      laps: r.laps,
      karts: r.order.map((k) => ({
        name: k.char.name,
        player: k.isPlayer,
        place: k.place,
        lap: k.lapsDone,
        progress: Math.round(k.progress),
        speed: +k.speed.toFixed(1),
        finished: k.finished,
        time: k.finishTime,
        item: k.item,
        respawns: k._respawns || 0,
      })),
    };
  }
}

export { TRACKS, CHARACTERS };
