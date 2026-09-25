// Игровой HUD: предмет и рулетка, круг и время, место, спидометр и буст-шкала, миникарта,
// отсчёт, баннеры, предупреждения и сенсорные кнопки.
import { ITEM_ICONS, ITEM_NAMES } from './icons.js';

export function fmtTime(t) {
  if (!(t >= 0)) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

const ORDER = ['turbo', 'orb', 'shield', 'ice'];

export class Hud {
  constructor(ui, parent) {
    this.ui = ui;
    const el = document.createElement('div');
    el.className = 'hud hidden';
    el.innerHTML = `
      <div class="hud-item">
        <div class="slot"><div class="icon"></div></div>
        <div class="slot-name"></div>
      </div>
      <div class="hud-lap">
        <div class="lap">КРУГ <b class="lap-n">1</b><span class="lap-of">/3</span></div>
        <div class="time">00:00.00</div>
      </div>
      <div class="hud-map"><canvas width="240" height="240"></canvas></div>
      <div class="hud-place"><span class="num">1</span><span class="of">/8</span></div>
      <div class="hud-speed">
        <div class="spd"><b>0</b><small>км/ч</small></div>
        <div class="drift"><i class="d1"></i><i class="d2"></i><i class="d3"></i><span class="bkey">F</span></div>
      </div>
      <div class="hud-center">
        <div class="count"></div>
        <div class="banner"></div>
        <div class="warn">↺ НЕ ТУДА!</div>
        <div class="hint"></div>
      </div>
      <div class="hud-intro">
        <div class="loc-jp"></div>
        <div class="loc-name"></div>
        <div class="loc-desc"></div>
      </div>
      <div class="touch">
        <div class="t-left">
          <button class="tb t-steer-l" data-k="left">◀</button>
          <button class="tb t-steer-r" data-k="right">▶</button>
        </div>
        <div class="t-right">
          <button class="tb t-item" data-k="item">ПРЕДМЕТ</button>
          <button class="tb t-boost" data-k="boost">БУСТ</button>
          <button class="tb t-drift" data-k="drift">ДРИФТ</button>
          <button class="tb t-brake" data-k="brake">ТОРМОЗ</button>
        </div>
        <button class="tb t-pause" data-k="pause">❚❚</button>
      </div>
    `;
    parent.appendChild(el);
    this.el = el;
    this.$ = (s) => el.querySelector(s);
    this.slot = this.$('.slot');
    this.icon = this.$('.icon');
    this.slotName = this.$('.slot-name');
    this.lapN = this.$('.lap-n');
    this.lapOf = this.$('.lap-of');
    this.timeEl = this.$('.time');
    this.placeNum = this.$('.hud-place .num');
    this.placeOf = this.$('.hud-place .of');
    this.placeBox = this.$('.hud-place');
    this.spd = this.$('.spd b');
    this.driftBars = [this.$('.d1'), this.$('.d2'), this.$('.d3')];
    this.countEl = this.$('.count');
    this.bannerEl = this.$('.banner');
    this.warnEl = this.$('.warn');
    this.hintEl = this.$('.hint');
    this.introEl = this.$('.hud-intro');
    this.canvas = this.$('.hud-map canvas');
    this.ctx = this.canvas.getContext('2d');
    this.mapImg = null;
    this.roulette = null;
    this.item = null;
    this.bannerTimer = 0;
    this.hintTimer = 0;
    this.hintsShown = new Set();
    this._last = {};
    this._setupTouch();
  }

  _setupTouch() {
    const input = this.ui.game.input;
    const touch = window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.touchEnabled = touch;
    this.el.classList.toggle('touch-on', touch);
    input.touchMode = touch;
    input.autoGas = this.ui.game.settings.autoGas;
    const t = input.touch;
    const state = { left: false, right: false };
    const apply = () => (t.steer = (state.right ? 1 : 0) - (state.left ? 1 : 0));
    this.el.querySelectorAll('.touch .tb').forEach((b) => {
      const k = b.dataset.k;
      const down = (e) => {
        e.preventDefault();
        b.classList.add('on');
        this.ui.game.audio.unlock();
        if (k === 'left' || k === 'right') {
          state[k] = true;
          apply();
        } else if (k === 'drift') {
          t.drift = true;
          t.driftEdge = true;
        } else if (k === 'item') t.itemEdge = true;
        else if (k === 'boost') t.boostEdge = true;
        else if (k === 'brake') t.brake = true;
        else if (k === 'pause') this.ui.game.setPaused(!this.ui.game.paused);
      };
      const up = (e) => {
        e.preventDefault();
        b.classList.remove('on');
        if (k === 'left' || k === 'right') {
          state[k] = false;
          apply();
        } else if (k === 'drift') t.drift = false;
        else if (k === 'brake') t.brake = false;
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  show(on, race) {
    this.el.classList.toggle('hidden', !on);
    if (!on) return;
    this.race = race;
    this.item = null;
    this.roulette = null;
    this.icon.innerHTML = '';
    this.slot.className = 'slot';
    this.slotName.textContent = '';
    this.countEl.className = 'count';
    this.countEl.textContent = '';
    this.bannerEl.className = 'banner';
    this.warnEl.classList.remove('on');
    this.hintEl.className = 'hint';
    this.placeOf.textContent = '/' + race.karts.length;
    this.lapOf.textContent = '/' + race.laps;
    this._last = {};
    this.buildMap(race);
  }

  intro(def) {
    this.introEl.querySelector('.loc-jp').textContent = def.jp;
    this.introEl.querySelector('.loc-name').textContent = def.name;
    this.introEl.querySelector('.loc-desc').textContent = def.time;
    this.introEl.classList.remove('on');
    void this.introEl.offsetWidth;
    this.introEl.classList.add('on');
    setTimeout(() => this.introEl.classList.remove('on'), 4200);
    if (this.touchEnabled) this.hint('◀ ▶ — руль · ДРИФТ копит буст · БУСТ — ускорение', 5);
    else this.hint('Стрелки/WASD — езда · Shift/Пробел — дрифт · F — буст · E — предмет', 5);
  }

  countdown(n) {
    const el = this.countEl;
    el.className = 'count';
    void el.offsetWidth;
    if (n > 0) {
      el.textContent = String(n);
      el.classList.add('on', 'n' + n);
    } else {
      el.textContent = 'СТАРТ!';
      el.classList.add('on', 'go');
      setTimeout(() => (el.className = 'count'), 1100);
    }
  }

  banner(text, style = '') {
    const el = this.bannerEl;
    el.className = 'banner';
    void el.offsetWidth;
    el.textContent = text;
    el.classList.add('on');
    if (style) el.classList.add(style);
    this.bannerTimer = 2.2;
  }

  lapBanner(lap, total) {
    const lt = this.race.player.lapTimes;
    const last = lt[lt.length - 1];
    const best = Math.min(...lt);
    this.banner(`КРУГ ${lap}/${total}  ·  ${fmtTime(last)}${last <= best && lt.length > 1 ? ' ★' : ''}`, 'lap');
  }

  finish(place) {
    const el = this.countEl;
    el.className = 'count';
    void el.offsetWidth;
    el.textContent = 'ФИНИШ!';
    el.classList.add('on', 'finish');
    const words = ['', 'ПОБЕДА!', '2-е МЕСТО!', '3-е МЕСТО!'];
    this.banner(place <= 3 ? words[place] : `${place}-е место`, place === 1 ? 'gold' : place <= 3 ? 'final' : '');
    this.bannerTimer = 3.2;
  }

  wrongWay(on) {
    this.warnEl.classList.toggle('on', on);
  }

  hint(text, time = 3) {
    if (this.hintsShown.has(text)) return;
    this.hintsShown.add(text);
    this.hintEl.textContent = text;
    this.hintEl.className = 'hint on';
    this.hintTimer = time;
  }

  placeChanged(from, to) {
    this.placeBox.classList.remove('up', 'down');
    void this.placeBox.offsetWidth;
    this.placeBox.classList.add(to < from ? 'up' : 'down');
  }

  startRoulette(finalItem) {
    this.roulette = { t: 0, dur: 1.35, final: finalItem, last: -1 };
    this.slot.className = 'slot rolling';
    this.slotName.textContent = '';
  }

  setItem(item) {
    this.item = item;
    this.roulette = null;
    if (item) {
      this.icon.innerHTML = ITEM_ICONS[item];
      this.slot.className = 'slot has';
      void this.slot.offsetWidth;
      this.slot.classList.add('pop');
      this.slotName.textContent = ITEM_NAMES[item] + (this.touchEnabled ? '' : ' · E');
      if (!this.hintsShown.has('item')) {
        this.hintsShown.add('item');
        this.hint(this.touchEnabled ? 'Нажми ПРЕДМЕТ, чтобы использовать' : 'Нажми E (или Enter), чтобы использовать предмет', 3.5);
      }
    } else {
      this.icon.innerHTML = '';
      this.slot.className = 'slot';
      this.slotName.textContent = '';
    }
  }

  update(race, dt) {
    const p = race.player;
    // время и круг
    const lap = Math.max(1, Math.min(race.laps, p.lapsDone + 1));
    if (this._last.lap !== lap) {
      this.lapN.textContent = lap;
      this._last.lap = lap;
    }
    const t = p.finished ? p.finishTime : race.raceTime;
    this.timeEl.textContent = fmtTime(t);
    if (this._last.place !== p.place) {
      this.placeNum.textContent = p.place;
      this.placeBox.dataset.place = p.place <= 3 ? p.place : 'n';
      this._last.place = p.place;
    }
    const kmh = Math.round(Math.abs(p.speed) * 3.6);
    if (this._last.kmh !== kmh) {
      this.spd.textContent = kmh;
      this._last.kmh = kmh;
    }
    // буст-шкала: три деления копятся в заносе; F тратит все полные сразу
    const m = p.boostMeter;
    const mKey = Math.round(m * 40);
    if (this._last.meter !== mKey) {
      this.driftBars.forEach((b, i) => {
        const f = Math.max(0, Math.min(1, m - i));
        b.style.setProperty('--f', f.toFixed(3));
        b.classList.toggle('full', f >= 1);
      });
      this.el.classList.toggle('boost-ready', m >= 1);
      this._last.meter = mKey;
    }
    this.el.classList.toggle('boosting', p.boost.time > 0);

    // рулетка
    if (this.roulette) {
      const r = this.roulette;
      r.t += dt;
      const u = Math.min(1, r.t / r.dur);
      const rate = 16 - u * 11;
      const idx = Math.floor(r.t * rate) % ORDER.length;
      if (idx !== r.last) {
        r.last = idx;
        this.icon.innerHTML = ITEM_ICONS[ORDER[idx]];
        this.ui.game.audio.sfx('roulette', { volume: 0.6 });
      }
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('on');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.classList.remove('on');
    }
    this.drawMap(race);
  }

  // ------------------------------------------------------------------ миникарта
  buildMap(race) {
    const tr = race.track;
    const W = this.canvas.width;
    const b = tr.bounds;
    const w = b.max.x - b.min.x;
    const h = b.max.z - b.min.z;
    const pad = 18;
    const s = (W - pad * 2) / Math.max(w, h);
    const ox = (W - w * s) / 2 - b.min.x * s;
    const oz = (W - h * s) / 2 - b.min.z * s;
    // север вверх: z растёт вниз на канвасе — развернём, чтобы старт был снизу
    this.mapT = (x, z) => [x * s + ox, z * s + oz];
    const c = document.createElement('canvas');
    c.width = c.height = W;
    const g = c.getContext('2d');
    const mm = race.world.minimap || {};
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= tr.count; i += 2) {
        const P = tr.pos[i % tr.count];
        const [x, y] = this.mapT(P.x, P.z);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    };
    path();
    g.strokeStyle = 'rgba(20,10,40,0.55)';
    g.lineWidth = 15;
    g.stroke();
    path();
    g.strokeStyle = mm.edge || '#ff6fa8';
    g.lineWidth = 10;
    g.stroke();
    path();
    g.strokeStyle = mm.road || '#ffffff';
    g.lineWidth = 6;
    g.stroke();
    // линия старта
    const P0 = tr.pos[0];
    const R0 = tr.right[0];
    const a = this.mapT(P0.x - R0.x * 12, P0.z - R0.z * 12);
    const bb = this.mapT(P0.x + R0.x * 12, P0.z + R0.z * 12);
    g.strokeStyle = '#1b1024';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(bb[0], bb[1]);
    g.stroke();
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.setLineDash([3, 3]);
    g.stroke();
    g.setLineDash([]);
    this.mapImg = c;
  }

  drawMap(race) {
    const g = this.ctx;
    const W = this.canvas.width;
    g.clearRect(0, 0, W, W);
    if (this.mapImg) g.drawImage(this.mapImg, 0, 0);
    // ловушки и сферы
    for (const t of race.items.traps) {
      const [x, y] = this.mapT(t.pos.x, t.pos.z);
      g.fillStyle = '#9fe8ff';
      g.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const o of race.items.orbs) {
      const [x, y] = this.mapT(o.pos.x, o.pos.z);
      g.fillStyle = '#ff7ae6';
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
    // соперники, затем игрок поверх
    const karts = race.karts.slice().sort((a, b) => (a === race.player ? 1 : b === race.player ? -1 : 0));
    for (const k of karts) {
      const [x, y] = this.mapT(k.pos.x, k.pos.z);
      const isP = k === race.player;
      g.fillStyle = k.char.kart;
      g.strokeStyle = isP ? '#ffffff' : '#1b1024';
      g.lineWidth = isP ? 3 : 2;
      g.beginPath();
      g.arc(x, y, isP ? 7 : 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (isP) {
        const fx = Math.sin(k.heading);
        const fz = Math.cos(k.heading);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(x + fx * 13, y + fz * 13);
        g.lineTo(x + fz * 5, y - fx * 5);
        g.lineTo(x - fz * 5, y + fx * 5);
        g.closePath();
        g.fill();
      }
    }
  }
}
