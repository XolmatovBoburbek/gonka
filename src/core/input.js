// Управление: клавиатура, геймпад и сенсорные кнопки — всё сводится к одному состоянию.
const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  drift: ['Space', 'ShiftLeft', 'ShiftRight'],
  item: ['KeyE', 'Enter', 'ControlLeft', 'ControlRight', 'KeyQ'],
  back: ['KeyC'],
  pause: ['Escape', 'KeyP'],
  respawn: ['KeyR'],
  mute: ['KeyM'],
};

export class Input {
  constructor() {
    this.down = new Set();
    this.edges = new Set();
    this.touch = { steer: 0, gas: false, brake: false, drift: false, item: false, itemEdge: false, driftEdge: false };
    this.touchMode = false;
    this.autoGas = false;
    this.padPrev = [];
    this.lastDevice = 'keyboard';
    this.enabled = true;
    this._onKeyDown = (e) => {
      if (e.repeat) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      this.down.add(e.code);
      this.edges.add(e.code);
      this.lastDevice = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.down.delete(e.code);
    this._onBlur = () => this.down.clear();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  isDown(action) {
    return KEYS[action].some((k) => this.down.has(k));
  }

  pressed(action) {
    return KEYS[action].some((k) => this.edges.has(k));
  }

  _gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Считывает состояние на кадр (edge-события сбрасываются после вызова endFrame). */
  poll() {
    const s = {
      steer: 0,
      throttle: 0,
      brake: 0,
      driftHeld: false,
      driftPressed: false,
      item: false,
      lookBack: false,
      pause: false,
      respawn: false,
      mute: false,
      confirm: false,
      menuDir: 0,
    };
    if (!this.enabled) return s;
    let steer = 0;
    if (this.isDown('left')) steer -= 1;
    if (this.isDown('right')) steer += 1;
    s.throttle = this.isDown('up') ? 1 : 0;
    s.brake = this.isDown('down') ? 1 : 0;
    s.driftHeld = this.isDown('drift');
    s.driftPressed = this.pressed('drift');
    s.item = this.pressed('item');
    s.lookBack = this.isDown('back');
    s.pause = this.pressed('pause');
    s.respawn = this.pressed('respawn');
    s.mute = this.pressed('mute');

    // геймпад
    const gp = this._gamepad();
    if (gp) {
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const v = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      const prev = this.padPrev;
      const edge = (i) => b(i) && !prev[i];
      const ax = gp.axes[0] || 0;
      const dz = Math.abs(ax) > 0.15 ? (ax - Math.sign(ax) * 0.15) / 0.85 : 0;
      const dpad = (b(15) ? 1 : 0) - (b(14) ? 1 : 0);
      if (Math.abs(dz) > 0.01 || dpad) {
        steer = dpad || dz;
        this.lastDevice = 'gamepad';
      }
      const gas = Math.max(v(7), b(0) ? 1 : 0);
      const brk = Math.max(v(6), b(1) ? 1 : 0);
      if (gas > 0.05 || brk > 0.05) this.lastDevice = 'gamepad';
      s.throttle = Math.max(s.throttle, gas);
      s.brake = Math.max(s.brake, brk);
      s.driftHeld = s.driftHeld || b(5) || b(2);
      s.driftPressed = s.driftPressed || edge(5) || edge(2);
      s.item = s.item || edge(4) || edge(3);
      s.lookBack = s.lookBack || b(8);
      s.pause = s.pause || edge(9);
      s.confirm = edge(0);
      s.menuDir = (edge(15) || edge(13) ? 1 : 0) - (edge(14) || edge(12) ? 1 : 0);
      this.padPrev = gp.buttons.map((x) => x.pressed);
    }

    // сенсорные кнопки
    if (this.touchMode) {
      const t = this.touch;
      if (t.steer) steer = t.steer;
      if (t.gas || this.autoGas) s.throttle = Math.max(s.throttle, 1);
      if (t.brake) {
        s.brake = 1;
        if (this.autoGas) s.throttle = 0;
      }
      s.driftHeld = s.driftHeld || t.drift;
      s.driftPressed = s.driftPressed || t.driftEdge;
      s.item = s.item || t.itemEdge;
      t.itemEdge = false;
      t.driftEdge = false;
    }
    s.steer = Math.max(-1, Math.min(1, steer));
    return s;
  }

  endFrame() {
    this.edges.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }
}
