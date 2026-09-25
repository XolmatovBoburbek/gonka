// Экраны: титульный, выбор героя/трассы, загрузка, пауза, результаты, управление, настройки.
import { Hud, fmtTime } from './hud.js';
import { SAKURA_LOGO } from './icons.js';
import { CHARACTERS } from '../data/characters.js';
import { TRACKS } from '../tracks/index.js';
import { renderPortrait } from '../race/kartModel.js';
import { DIFFICULTY } from '../race/ai.js';
import { QUALITY_PRESETS } from '../core/renderer.js';

const TIPS = [
  'Удерживай дрифт в повороте: искры станут синими, оранжевыми, а потом розовыми — отпусти для мини-турбо!',
  'Нажми газ за мгновение до старта — получишь ракетный старт.',
  'Барьер блокирует одно попадание Звёздной сферы или Ледяной ловушки.',
  'Ледяную ловушку оставляют позади — не наезжай на кристаллы соперников!',
  'На трамплине нажми дрифт в воздухе — трюк даст ускорение при приземлении.',
  'Бустеры на дороге дают ускорение и не замедляются на траве.',
  'Отстающим чаще выпадают Турбо и Звёздные сферы.',
];

export class UI {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.currentScreen = null;
    this.portraits = {};
    root.innerHTML = `
      <div class="screen title-screen" data-screen="title">
        <div class="title-wrap">
          <div class="logo-jp">サクラ・ドリフト</div>
          <h1 class="logo"><span class="logo-a">SAKURA</span><span class="logo-b">DRIFT</span></h1>
          <div class="logo-sub"><span class="flower">${SAKURA_LOGO}</span>аниме-гонки</div>
          <div class="menu">
            <button class="btn primary focusable" data-act="play">ИГРАТЬ</button>
            <button class="btn focusable" data-act="controls">УПРАВЛЕНИЕ</button>
            <button class="btn focusable" data-act="settings">НАСТРОЙКИ</button>
          </div>
        </div>
        <div class="title-foot">8 гонщиков · 3 локации · Турбо, Сфера, Барьер и Лёд · Enter — играть</div>
      </div>

      <div class="screen select-screen" data-screen="select">
        <div class="sel-head">
          <button class="btn small back focusable" data-act="back">← НАЗАД</button>
          <h2>ВЫБОР ГОНЩИКА</h2>
        </div>
        <div class="sel-body">
          <div class="chars"></div>
          <div class="char-info">
            <div class="ci-jp"></div>
            <div class="ci-name"></div>
            <div class="ci-title"></div>
            <div class="stats">
              <div class="stat"><span>Скорость</span><div class="bar"><i data-s="speed"></i></div></div>
              <div class="stat"><span>Ускорение</span><div class="bar"><i data-s="accel"></i></div></div>
              <div class="stat"><span>Управление</span><div class="bar"><i data-s="handling"></i></div></div>
            </div>
          </div>
        </div>
        <div class="sel-bottom">
          <div class="tracks"></div>
          <div class="opts">
            <div class="opt"><span class="opt-l">Соперники</span><div class="seg diff"></div></div>
            <div class="opt"><span class="opt-l">Круги</span><div class="seg laps"></div></div>
            <button class="btn primary go focusable" data-act="start">СТАРТ!</button>
          </div>
        </div>
      </div>

      <div class="screen pause-screen" data-screen="pause">
        <div class="panel">
          <h2>ПАУЗА</h2>
          <button class="btn primary focusable" data-act="resume">ПРОДОЛЖИТЬ</button>
          <button class="btn focusable" data-act="restart">ЗАНОВО</button>
          <button class="btn focusable" data-act="settings">НАСТРОЙКИ</button>
          <button class="btn focusable" data-act="menu">В МЕНЮ</button>
        </div>
      </div>

      <div class="screen results-screen" data-screen="results">
        <div class="panel wide">
          <div class="res-head"><div class="res-place"></div><div class="res-sub"></div><div class="res-record"></div></div>
          <table class="res-table"><tbody></tbody></table>
          <div class="res-btns">
            <button class="btn primary focusable" data-act="restart">ЕЩЁ РАЗ</button>
            <button class="btn focusable" data-act="play">ДРУГАЯ ТРАССА</button>
            <button class="btn focusable" data-act="menu">В МЕНЮ</button>
          </div>
        </div>
      </div>

      <div class="modal controls-modal" data-modal="controls">
        <div class="panel">
          <h2>УПРАВЛЕНИЕ</h2>
          <table class="keys">
            <tr><td><kbd>↑</kbd> <kbd>W</kbd></td><td>Газ</td></tr>
            <tr><td><kbd>↓</kbd> <kbd>S</kbd></td><td>Тормоз / задний ход</td></tr>
            <tr><td><kbd>←</kbd><kbd>→</kbd> <kbd>A</kbd><kbd>D</kbd></td><td>Руль</td></tr>
            <tr><td><kbd>Shift</kbd> / <kbd>Пробел</kbd></td><td>Прыжок и дрифт (держи в повороте → мини-турбо), трюк на трамплине</td></tr>
            <tr><td><kbd>E</kbd> / <kbd>Enter</kbd></td><td>Использовать предмет</td></tr>
            <tr><td><kbd>C</kbd></td><td>Смотреть назад</td></tr>
            <tr><td><kbd>R</kbd></td><td>Вернуться на трассу</td></tr>
            <tr><td><kbd>Esc</kbd> / <kbd>P</kbd></td><td>Пауза</td></tr>
            <tr><td><kbd>M</kbd></td><td>Звук вкл/выкл</td></tr>
          </table>
          <div class="items-help">
            <div><b class="ih turbo">Турбо</b> — мощное ускорение</div>
            <div><b class="ih orb">Звёздная сфера</b> — летит в соперника впереди и закручивает его</div>
            <div><b class="ih shield">Барьер</b> — щит от одного попадания</div>
            <div><b class="ih ice">Ледяная ловушка</b> — замораживает того, кто наедет</div>
          </div>
          <p class="muted">Геймпад: стик/крестовина — руль, RT/A — газ, LT/B — тормоз, RB/X — дрифт, LB/Y — предмет. На телефоне — экранные кнопки, газ автоматический.</p>
          <button class="btn primary focusable" data-act="close">ПОНЯТНО</button>
        </div>
      </div>

      <div class="modal settings-modal" data-modal="settings">
        <div class="panel">
          <h2>НАСТРОЙКИ</h2>
          <div class="opt"><span class="opt-l">Графика</span><div class="seg quality"></div></div>
          <div class="opt"><span class="opt-l">Музыка</span><input type="range" min="0" max="1" step="0.05" class="vol-music"></div>
          <div class="opt"><span class="opt-l">Эффекты</span><input type="range" min="0" max="1" step="0.05" class="vol-sfx"></div>
          <div class="opt"><span class="opt-l">Звук</span><div class="seg mute"></div></div>
          <div class="opt touch-only"><span class="opt-l">Автогаз</span><div class="seg autogas"></div></div>
          <button class="btn primary focusable" data-act="close">ГОТОВО</button>
        </div>
      </div>

      <div class="loading"><div class="spinner">${SAKURA_LOGO}</div><div class="load-text">Загрузка…</div><div class="tip"></div></div>
    `;
    this.$ = (s) => root.querySelector(s);
    this.hud = new Hud(this, root);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) this.action(b.dataset.act, b);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.buildSelect();
    this.buildSettings();
  }

  // ---------------------------------------------------------------- навигация
  showScreen(name) {
    this.currentScreen = name;
    this.root.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.dataset.screen === name));
    if (name === 'select') this.refreshSelect();
    const first = this.root.querySelector(`.screen[data-screen="${name}"] .focusable.primary`) || this.root.querySelector(`.screen[data-screen="${name}"] .focusable`);
    if (first && !this.isTouch()) setTimeout(() => first.focus({ preventScroll: true }), 30);
  }

  hideScreens() {
    // снять фокус с кнопок меню, иначе Пробел/Enter в гонке "нажмут" их снова
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    this.currentScreen = null;
    this.root.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
  }

  isTouch() {
    return window.matchMedia?.('(pointer: coarse)').matches;
  }

  openModal(name) {
    this.modal = name;
    this.root.querySelectorAll('.modal').forEach((m) => m.classList.toggle('on', m.dataset.modal === name));
    if (name === 'settings') this.syncSettings();
    const b = this.root.querySelector(`.modal[data-modal="${name}"] .focusable`);
    if (b && !this.isTouch()) setTimeout(() => b.focus({ preventScroll: true }), 30);
  }

  closeModal() {
    this.modal = null;
    this.root.querySelectorAll('.modal').forEach((m) => m.classList.remove('on'));
  }

  setLoading(on, text = 'Загрузка…') {
    const el = this.$('.loading');
    el.classList.toggle('on', on);
    el.querySelector('.load-text').textContent = text;
    el.querySelector('.tip').textContent = 'Совет: ' + TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  action(act) {
    const g = this.game;
    g.audio.unlock();
    switch (act) {
      case 'play':
        g.audio.sfx('uiSelect');
        if (g.state === 'race') {
          g.state = 'menu';
          g.ui.hud.show(false);
          g.audio.stopEngine();
          g.startDemo();
          g.audio.playMusic('menu');
        }
        this.showScreen('select');
        break;
      case 'back':
        g.audio.sfx('uiBack');
        this.showScreen('title');
        break;
      case 'controls':
        g.audio.sfx('uiSelect');
        this.openModal('controls');
        break;
      case 'settings':
        g.audio.sfx('uiSelect');
        this.openModal('settings');
        break;
      case 'close':
        g.audio.sfx('uiBack');
        this.closeModal();
        break;
      case 'start':
        g.audio.sfx('uiStart');
        g.saveSettings();
        g.startRace();
        break;
      case 'resume':
        g.audio.sfx('uiSelect');
        g.setPaused(false);
        break;
      case 'restart':
        g.audio.sfx('uiSelect');
        this.closeModal();
        g.restartRace();
        break;
      case 'menu':
        g.audio.sfx('uiBack');
        this.closeModal();
        g.toMenu();
        break;
    }
  }

  onKey(e) {
    const g = this.game;
    if (this.modal) {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.closeModal();
      }
      return this.arrowNav(e, `.modal[data-modal="${this.modal}"]`);
    }
    if (this.currentScreen === 'title' && (e.code === 'Enter' || e.code === 'Space') && document.activeElement?.tagName !== 'BUTTON') {
      e.preventDefault();
      this.action('play');
      return;
    }
    if (this.currentScreen === 'select') {
      if (e.code === 'Escape') {
        this.action('back');
        return;
      }
      if (!document.activeElement || document.activeElement === document.body) {
        if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
          const i = CHARACTERS.findIndex((c) => c.id === g.settings.character);
          const n = (i + (e.code === 'ArrowRight' ? 1 : -1) + CHARACTERS.length) % CHARACTERS.length;
          this.pickChar(CHARACTERS[n].id);
          e.preventDefault();
          return;
        }
        if (e.code === 'Enter') {
          this.action('start');
          return;
        }
      }
    }
    if (this.currentScreen) this.arrowNav(e, `.screen[data-screen="${this.currentScreen}"]`);
  }

  arrowNav(e, scope) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
    const list = [...this.root.querySelectorAll(`${scope} .focusable`)].filter((b) => b.offsetParent !== null);
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const d = e.code === 'ArrowDown' || e.code === 'ArrowRight' ? 1 : -1;
    const n = i < 0 ? 0 : (i + d + list.length) % list.length;
    list[n].focus({ preventScroll: true });
    this.game.audio.sfx('uiMove');
    e.preventDefault();
  }

  /** Навигация геймпадом по меню (вызывается из игрового цикла). */
  menuInput(inp) {
    if (!inp.menuDir && !inp.confirm) return;
    const scope = this.modal ? `.modal[data-modal="${this.modal}"]` : this.currentScreen ? `.screen[data-screen="${this.currentScreen}"]` : null;
    if (!scope) return;
    if (inp.menuDir) this.arrowNav({ code: inp.menuDir > 0 ? 'ArrowDown' : 'ArrowUp', preventDefault() {} }, scope);
    if (inp.confirm && document.activeElement?.classList.contains('focusable')) document.activeElement.click();
  }

  // ---------------------------------------------------------------- выбор
  buildSelect() {
    const g = this.game;
    const chars = this.$('.chars');
    chars.innerHTML = CHARACTERS.map(
      (c) => `<button class="char focusable" data-id="${c.id}" style="--c1:${c.kart};--c2:${c.hair}">
        <div class="portrait"></div><div class="cname">${c.name}</div></button>`
    ).join('');
    chars.addEventListener('click', (e) => {
      const b = e.target.closest('.char');
      if (b) this.pickChar(b.dataset.id);
    });
    chars.addEventListener('focusin', (e) => {
      const b = e.target.closest('.char');
      if (b && b.dataset.id !== g.settings.character) this.pickChar(b.dataset.id);
    });
    const tracks = this.$('.tracks');
    tracks.innerHTML = TRACKS.map(
      (t) => `<button class="track focusable" data-id="${t.id}" style="--t1:${t.card[0]};--t2:${t.card[1]}">
        <div class="tjp">${t.jp}</div><div class="tname">${t.name}</div><div class="ttime">${t.time}</div><div class="trec"></div></button>`
    ).join('');
    tracks.addEventListener('click', (e) => {
      const b = e.target.closest('.track');
      if (b) this.pickTrack(b.dataset.id);
    });
    const diff = this.$('.seg.diff');
    diff.innerHTML = Object.values(DIFFICULTY)
      .map((d) => `<button class="focusable" data-v="${d.id}">${d.label}</button>`)
      .join('');
    diff.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      g.settings.difficulty = b.dataset.v;
      g.audio.sfx('uiMove');
      this.refreshSelect();
    });
    const laps = this.$('.seg.laps');
    laps.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button class="focusable" data-v="${n}">${n}</button>`).join('');
    laps.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      g.settings.laps = +b.dataset.v;
      g.audio.sfx('uiMove');
      this.refreshSelect();
    });
  }

  ensurePortraits() {
    if (this._portraitsDone) return;
    this._portraitsDone = true;
    const r = this.game.renderer.renderer;
    for (const c of CHARACTERS) {
      try {
        const url = renderPortrait(r, c, 256);
        this.portraits[c.id] = url;
        const el = this.root.querySelector(`.char[data-id="${c.id}"] .portrait`);
        if (el) el.style.backgroundImage = `url(${url})`;
      } catch (err) {
        console.warn('portrait failed', err);
      }
    }
  }

  pickChar(id) {
    const g = this.game;
    if (g.settings.character !== id) g.audio.sfx('uiMove');
    g.settings.character = id;
    this.refreshSelect();
  }

  async pickTrack(id) {
    const g = this.game;
    g.settings.track = id;
    g.audio.sfx('uiMove');
    this.refreshSelect();
    await g.previewTrack(id);
  }

  refreshSelect() {
    const g = this.game;
    this.ensurePortraits();
    const s = g.settings;
    this.root.querySelectorAll('.char').forEach((b) => b.classList.toggle('sel', b.dataset.id === s.character));
    this.root.querySelectorAll('.track').forEach((b) => {
      b.classList.toggle('sel', b.dataset.id === s.track);
      const rec = g.records[g.recordKey(b.dataset.id, s.laps)];
      b.querySelector('.trec').textContent = rec?.race ? '🏆 ' + fmtTime(rec.race) : '';
    });
    this.root.querySelectorAll('.seg.diff button').forEach((b) => b.classList.toggle('sel', b.dataset.v === s.difficulty));
    this.root.querySelectorAll('.seg.laps button').forEach((b) => b.classList.toggle('sel', +b.dataset.v === s.laps));
    const c = CHARACTERS.find((x) => x.id === s.character);
    const info = this.$('.char-info');
    info.style.setProperty('--c1', c.kart);
    info.style.setProperty('--c2', c.hair);
    info.querySelector('.ci-jp').textContent = c.jp;
    info.querySelector('.ci-name').textContent = c.name;
    info.querySelector('.ci-title').textContent = c.title;
    for (const k of ['speed', 'accel', 'handling']) info.querySelector(`[data-s="${k}"]`).style.width = (c.stats[k] / 5) * 100 + '%';
    info.classList.remove('bump');
    void info.offsetWidth;
    info.classList.add('bump');
  }

  // ---------------------------------------------------------------- настройки
  buildSettings() {
    const g = this.game;
    const q = this.$('.seg.quality');
    q.innerHTML = [['auto', { label: 'Авто' }], ...Object.entries(QUALITY_PRESETS)]
      .map(([k, v]) => `<button class="focusable" data-v="${k}">${v.label}</button>`)
      .join('');
    q.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      g.setQuality(b.dataset.v);
      g.audio.sfx('uiMove');
      this.syncSettings();
    });
    const m = this.$('.seg.mute');
    m.innerHTML = `<button class="focusable" data-v="on">Вкл</button><button class="focusable" data-v="off">Выкл</button>`;
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      g.settings.muted = b.dataset.v === 'off';
      g.audio.setMuted(g.settings.muted);
      g.saveSettings();
      this.syncSettings();
    });
    const ag = this.$('.seg.autogas');
    ag.innerHTML = `<button class="focusable" data-v="on">Вкл</button><button class="focusable" data-v="off">Выкл</button>`;
    ag.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      g.settings.autoGas = b.dataset.v === 'on';
      g.input.autoGas = g.settings.autoGas;
      g.saveSettings();
      this.syncSettings();
    });
    const vm = this.$('.vol-music');
    vm.addEventListener('input', () => {
      g.settings.music = +vm.value;
      g.audio.setMusicVolume(g.settings.music);
      g.saveSettings();
    });
    const vs = this.$('.vol-sfx');
    vs.addEventListener('input', () => {
      g.settings.sfx = +vs.value;
      g.audio.setSfxVolume(g.settings.sfx);
      g.saveSettings();
    });
    vs.addEventListener('change', () => g.audio.sfx('itemGet'));
    this.root.querySelector('.settings-modal').classList.toggle('has-touch', !!this.isTouch());
  }

  syncSettings() {
    const s = this.game.settings;
    this.root.querySelectorAll('.seg.quality button').forEach((b) => b.classList.toggle('sel', b.dataset.v === (QUALITY_PRESETS[s.quality] ? s.quality : 'auto')));
    this.root.querySelectorAll('.seg.mute button').forEach((b) => b.classList.toggle('sel', (b.dataset.v === 'off') === !!s.muted));
    this.root.querySelectorAll('.seg.autogas button').forEach((b) => b.classList.toggle('sel', (b.dataset.v === 'on') === !!s.autoGas));
    this.$('.vol-music').value = s.music;
    this.$('.vol-sfx').value = s.sfx;
  }

  // ---------------------------------------------------------------- пауза и результаты
  showPause(on) {
    if (on) this.showScreen('pause');
    else {
      this.hideScreens();
      this.closeModal();
    }
  }

  showResults(results, player, record = null) {
    this.ensurePortraits();
    const idx = results.findIndex((r) => r.kart === player);
    const place = idx + 1;
    const head = this.$('.res-place');
    head.textContent = place === 1 ? '1-е МЕСТО!' : `${place}-е место`;
    head.dataset.place = place <= 3 ? place : 'n';
    const sub = this.$('.res-sub');
    const msgs = ['', 'Великолепно! Настоящий чемпион!', 'Почти! Ещё чуть-чуть до победы.', 'Пьедестал твой!', 'Неплохо! Попробуй дрифтовать больше.', 'Используй мини-турбо в поворотах!', 'Собирай кристаллы с предметами!', 'Отстающим выпадают сильные предметы — не сдавайся!', 'Каждый чемпион с чего-то начинал!'];
    sub.textContent = msgs[place] || '';
    const recEl = this.$('.res-record');
    recEl.innerHTML = '';
    if (record && player.finished) {
      const parts = [];
      if (record.race) parts.push(`<span class="new">НОВЫЙ РЕКОРД!</span> ${fmtTime(record.current.race)}`);
      else if (record.current?.race) parts.push(`Рекорд трассы: ${fmtTime(record.current.race)}`);
      if (record.lap) parts.push(`<span class="new">Лучший круг!</span> ${fmtTime(record.current.lap)}`);
      recEl.innerHTML = parts.join(' · ');
    }
    const rows = results
      .map((r, i) => {
        const me = r.kart === player;
        const p = this.portraits[r.char.id];
        return `<tr class="${me ? 'me' : ''}" style="--c1:${r.char.kart};animation-delay:${i * 0.07}s">
          <td class="rp">${i + 1}</td>
          <td class="rimg"><div class="mini" style="${p ? `background-image:url(${p})` : ''}"></div></td>
          <td class="rn">${r.char.name}${me ? ' <span class="you">ТЫ</span>' : ''}</td>
          <td class="rt">${r.finished ? fmtTime(r.time) : '<span class="muted">' + fmtTime(r.time) + '</span>'}</td>
          <td class="rb">${r.best ? 'лучший ' + fmtTime(r.best) : ''}</td></tr>`;
      })
      .join('');
    this.$('.res-table tbody').innerHTML = rows;
    this.hud.show(false);
    this.showScreen('results');
  }
}
