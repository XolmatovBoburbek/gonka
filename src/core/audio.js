/**
 * audio.js — fully procedural sound + music engine (Web Audio API only).
 *
 * No audio files, no dependencies. Everything (drums, synths, SFX, kart engine)
 * is synthesized at runtime from oscillators and one shared noise buffer.
 *
 * Signal flow
 *   theme players ─┬─ channels ─→ fade ─→ musicIn ─→ musicGain ─→ duck ─→ musicPause ─┐
 *                  ├─ delay send (ping-pong, per theme) ─→ fade                          │
 *                  └─ reverb send ─→ revFade ─→ music reverb ─→ musicGain               │
 *   sfx voices ─→ (volume, pan) ─→ gameSfx | uiSfx ─→ sfxGain ──────────────────────────┤
 *   engine layers ─→ engineBus ─→ gameSfx                                               │
 *                                         master (mute) ←───────────────────────────────┘
 *                                         master → DynamicsCompressor → soft clipper → destination
 *
 * Music is a lookahead step sequencer (25 ms timer, 0.12 s schedule-ahead) that
 * plays data-described themes (bpm, chords, drum/bass patterns, melody).
 * Drum hits are synthesized once into AudioBuffers at unlock (OfflineAudioContext)
 * so each hit costs 1-2 nodes; until that finishes they are synthesized live.
 * Every voice stops itself and disconnects its nodes when it ends.
 *
 * Usage: const audio = new AudioManager(); window.addEventListener('pointerdown', () => audio.unlock());
 */

const MASTER_LEVEL = 0.9;
const MUSIC_TRIM = 0.62; // internal music bus level (musicVolume scales on top)
const LOOKAHEAD = 0.12; // seconds scheduled ahead of ctx.currentTime
const TIMER_MS = 25;
const MAX_ACTIVE_SFX = 48;

function getAudioContextClass() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

// ---------------------------------------------------------------------------
// Note / chord parsing
// ---------------------------------------------------------------------------

const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const acc = (s) => (s === '#' ? 1 : s === 'b' ? -1 : 0);

/** 'C#5' -> 73 (MIDI). Returns null for anything else. */
function parseNote(str) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(str);
  if (!m) return null;
  return PITCH[m[1]] + acc(m[2]) + (parseInt(m[3], 10) + 1) * 12;
}

const CHORD_TYPES = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  '9': [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
};

/** 'F#m7/C#' -> { root: 6, intervals: [...], bass: 1 } (pitch classes) */
function parseChord(sym) {
  const [main, slash] = sym.split('/');
  const m = /^([A-G])([#b]?)(.*)$/.exec(main);
  if (!m) return { root: 0, intervals: CHORD_TYPES[''], bass: 0 };
  const root = (PITCH[m[1]] + acc(m[2]) + 12) % 12;
  const intervals = CHORD_TYPES[m[3]] || CHORD_TYPES[''];
  let bass = root;
  const b = slash && /^([A-G])([#b]?)$/.exec(slash);
  if (b) bass = (PITCH[b[1]] + acc(b[2]) + 12) % 12;
  return { root, intervals, bass };
}

/** Close-position voicing (<= maxNotes) whose average pitch is nearest `center`. */
function voiceChord(ch, center, maxNotes) {
  let ivs = ch.intervals.slice();
  if (ivs.length > maxNotes) ivs = ivs.filter((i) => i !== 7); // drop the fifth first
  if (ivs.length > maxNotes) ivs = ivs.slice(0, maxNotes);
  const pcs = ivs.map((i) => (ch.root + i) % 12);
  let best = null;
  let bestScore = Infinity;
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = pcs.slice(inv).concat(pcs.slice(0, inv));
    const lo = center - 12;
    const notes = [lo + ((((order[0] - lo) % 12) + 12) % 12)];
    for (let i = 1; i < order.length; i++) {
      let n = notes[i - 1] + 1;
      while (n % 12 !== order[i]) n++;
      notes.push(n);
    }
    const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
    const score = Math.abs(mean - center) + (notes[notes.length - 1] - notes[0]) * 0.08;
    if (score < bestScore) {
      bestScore = score;
      best = notes;
    }
  }
  return best;
}

const lowestAbove = (pc, low) => low + ((((pc - low) % 12) + 12) % 12);

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function osc(ctx, type, freq, t) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  return o;
}

function gainNode(ctx, value) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function biquad(ctx, type, freq, q) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (q !== undefined) f.Q.value = q;
  try {
    f.frequency.automationRate = 'k-rate'; // envelopes don't need per-sample coefficients
  } catch (e) {
    /* older implementations */
  }
  return f;
}

function stereo(ctx, pan) {
  if (!ctx.createStereoPanner) return null;
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  return p;
}

/** Disconnect every node of a voice once its source has finished. */
function releaseOnEnd(src, nodes) {
  src.onended = () => {
    for (let i = 0; i < nodes.length; i++) {
      try {
        nodes[i].disconnect();
      } catch (e) {
        /* already disconnected */
      }
    }
  };
}

function makeNoiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Synthetic stereo room impulse: decaying noise that darkens over time. */
function makeImpulse(ctx, seconds, power) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const pre = Math.floor(rate * 0.012);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const coef = 0.1 + 0.82 * x; // one-pole low-pass that closes over time
      lp += (1 - coef) * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - x, power);
    }
  }
  return buf;
}

function makeSoftClipCurve() {
  const n = 4096;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    c[i] = ax < 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((ax - 0.8) / 0.2));
  }
  return c;
}

/** Looping white-noise source starting at a random offset. */
function noiseSrc(S, t, dur) {
  const s = S.ctx.createBufferSource();
  s.buffer = S.noise;
  s.loop = true;
  s.start(t, Math.random() * (S.noise.duration - 0.5));
  if (dur !== undefined) s.stop(t + dur);
  return s;
}

// ---------------------------------------------------------------------------
// Instrument voices (shared by music + SFX). S = { ctx, noise }
// ---------------------------------------------------------------------------

function drumKick(S, out, t, vel) {
  const ctx = S.ctx;
  const o = osc(ctx, 'sine', 200, t);
  o.frequency.exponentialRampToValueAtTime(58, t + 0.055);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.4);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.045, 0.085);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.5);
  releaseOnEnd(o, [o, g]);
  // beater click
  const c = osc(ctx, 'square', 1100, t);
  c.frequency.exponentialRampToValueAtTime(220, t + 0.012);
  const cg = gainNode(ctx, 0);
  cg.gain.setValueAtTime(vel * 0.1, t);
  cg.gain.setTargetAtTime(0, t, 0.004);
  c.connect(cg).connect(out);
  c.start(t);
  c.stop(t + 0.04);
  releaseOnEnd(c, [c, cg]);
}

function drumSnare(S, out, t, vel) {
  const ctx = S.ctx;
  const o = osc(ctx, 'triangle', 230, t);
  o.frequency.exponentialRampToValueAtTime(165, t + 0.06);
  const og = gainNode(ctx, 0);
  og.gain.setValueAtTime(vel * 0.6, t);
  og.gain.setTargetAtTime(0, t + 0.004, 0.035);
  o.connect(og).connect(out);
  o.start(t);
  o.stop(t + 0.22);
  releaseOnEnd(o, [o, og]);
  const n = noiseSrc(S, t, 0.3);
  const hp = biquad(ctx, 'highpass', 1300, 0.7);
  const pk = biquad(ctx, 'peaking', 4200, 1);
  pk.gain.value = 5;
  const ng = gainNode(ctx, 0);
  ng.gain.setValueAtTime(vel * 0.62, t);
  ng.gain.setTargetAtTime(0, t + 0.004, 0.055);
  n.connect(hp).connect(pk).connect(ng).connect(out);
  releaseOnEnd(n, [n, hp, pk, ng]);
}

function drumClap(S, out, t, vel) {
  const ctx = S.ctx;
  const n = noiseSrc(S, t, 0.35);
  const bp = biquad(ctx, 'bandpass', 1150, 0.9);
  const hp = biquad(ctx, 'highpass', 600, 0.7);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.0105;
    g.gain.setValueAtTime(vel, tt);
    g.gain.setTargetAtTime(vel * 0.08, tt + 0.001, 0.0028);
  }
  g.gain.setValueAtTime(vel, t + 0.032);
  g.gain.setTargetAtTime(0, t + 0.033, 0.06);
  n.connect(hp).connect(bp).connect(g).connect(out);
  releaseOnEnd(n, [n, hp, bp, g]);
}

function drumHat(S, out, t, vel, open) {
  const ctx = S.ctx;
  const n = noiseSrc(S, t, open ? 0.5 : 0.1);
  const hp = biquad(ctx, 'highpass', open ? 6800 : 7800, 0.9);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(vel, t);
  g.gain.setTargetAtTime(0, t + 0.002, open ? 0.085 : 0.017);
  n.connect(hp).connect(g).connect(out);
  releaseOnEnd(n, [n, hp, g]);
}

function drumShaker(S, out, t, vel) {
  const ctx = S.ctx;
  const n = noiseSrc(S, t, 0.12);
  const bp = biquad(ctx, 'bandpass', 6200, 1.3);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.012);
  g.gain.setTargetAtTime(0, t + 0.012, 0.022);
  n.connect(bp).connect(g).connect(out);
  releaseOnEnd(n, [n, bp, g]);
}

function drumCrash(S, out, t, vel) {
  const ctx = S.ctx;
  const n = noiseSrc(S, t, 2.0);
  const hp = biquad(ctx, 'highpass', 3600, 0.6);
  const pk = biquad(ctx, 'peaking', 7500, 1.2);
  pk.gain.value = 6;
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(vel, t);
  g.gain.setTargetAtTime(vel * 0.35, t + 0.002, 0.08);
  g.gain.setTargetAtTime(0, t + 0.12, 0.42);
  n.connect(hp).connect(pk).connect(g).connect(out);
  releaseOnEnd(n, [n, hp, pk, g]);
}

function drumTom(S, out, t, vel, freq) {
  const ctx = S.ctx;
  const o = osc(ctx, 'sine', freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.22);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(vel, t);
  g.gain.setTargetAtTime(0, t + 0.01, 0.08);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.45);
  releaseOnEnd(o, [o, g]);
}

/** Тайко (нагадо-дайко): глубокий «дон» — тон с падающей высотой, второй мод кожи и удар бати. */
function drumTaiko(S, out, t, vel) {
  const ctx = S.ctx;
  const o = osc(ctx, 'sine', 120, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.1);
  o.frequency.exponentialRampToValueAtTime(56, t + 1.1); // хвост к ля большой октавы — не спорит с басом
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.003);
  g.gain.setTargetAtTime(0, t + 0.03, 0.2);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 1.25);
  releaseOnEnd(o, [o, g]);
  const m = osc(ctx, 'sine', 205, t);
  m.frequency.exponentialRampToValueAtTime(128, t + 0.12);
  const mg = gainNode(ctx, 0);
  mg.gain.setValueAtTime(vel * 0.3, t);
  mg.gain.setTargetAtTime(0, t + 0.003, 0.08);
  m.connect(mg).connect(out);
  m.start(t);
  m.stop(t + 0.6);
  releaseOnEnd(m, [m, mg]);
  const n = noiseSrc(S, t, 0.6);
  const lp = biquad(ctx, 'lowpass', 1100, 0.7);
  const ng = gainNode(ctx, 0);
  ng.gain.setValueAtTime(vel * 0.55, t);
  ng.gain.setTargetAtTime(vel * 0.06, t + 0.002, 0.01);
  ng.gain.setTargetAtTime(0, t + 0.03, 0.14);
  n.connect(lp).connect(ng).connect(out);
  releaseOnEnd(n, [n, lp, ng]);
}

/** «Ка» — удар по деревянному ободу тайко: сухой короткий щелчок. */
function drumKa(S, out, t, vel) {
  const ctx = S.ctx;
  const o = osc(ctx, 'triangle', 1250, t);
  o.frequency.exponentialRampToValueAtTime(1080, t + 0.03);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(vel * 0.5, t);
  g.gain.setTargetAtTime(0, t, 0.016);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.12);
  releaseOnEnd(o, [o, g]);
  const n = noiseSrc(S, t, 0.08);
  const bp = biquad(ctx, 'bandpass', 2200, 2.5);
  const ng = gainNode(ctx, 0);
  ng.gain.setValueAtTime(vel * 0.9, t);
  ng.gain.setTargetAtTime(0, t, 0.008);
  n.connect(bp).connect(ng).connect(out);
  releaseOnEnd(n, [n, bp, ng]);
}

/** Хёсиги — две деревянные колотушки: звонкий высокий «тён» с коротким звоном. */
function drumClack(S, out, t, vel) {
  const ctx = S.ctx;
  for (const [f, a, d] of [[2450, 0.7, 0.042], [3900, 0.35, 0.024]]) {
    const o = osc(ctx, 'sine', f, t);
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(vel * a, t);
    g.gain.setTargetAtTime(0, t, d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.28);
    releaseOnEnd(o, [o, g]);
  }
  const n = noiseSrc(S, t, 0.03);
  const hp = biquad(ctx, 'highpass', 3000, 0.7);
  const ng = gainNode(ctx, 0);
  ng.gain.setValueAtTime(vel * 0.6, t);
  ng.gain.setTargetAtTime(0, t, 0.003);
  n.connect(hp).connect(ng).connect(out);
  releaseOnEnd(n, [n, hp, ng]);
}

// Атаригане: негармоничные призвуки [отношение, амплитуда, спад (с)]
const KANE_P = [[1, 1, 0.14], [1.48, 0.6, 0.11], [2.27, 0.45, 0.08], [2.93, 0.3, 0.06], [3.89, 0.2, 0.045]];

/** Атаригане — маленький ручной гонг праздничного оркестра (матсури-баяси): металлическое «тян». */
function drumKane(S, out, t, vel) {
  const ctx = S.ctx;
  for (const [r, a, d] of KANE_P) {
    const o = osc(ctx, 'sine', 1180 * r, t);
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(vel * a * 0.3, t);
    g.gain.setTargetAtTime(0, t, d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.75);
    releaseOnEnd(o, [o, g]);
  }
  const n = noiseSrc(S, t, 0.03);
  const hp = biquad(ctx, 'highpass', 5000, 0.7);
  const ng = gainNode(ctx, 0);
  ng.gain.setValueAtTime(vel * 0.4, t);
  ng.gain.setTargetAtTime(0, t, 0.004);
  n.connect(hp).connect(ng).connect(out);
  releaseOnEnd(n, [n, hp, ng]);
}

/** Евробит: «большой» клэп-снейр — три вспышки хлопка и плотный шумовой хвост, резко обрезанный гейтом. */
function drumGatedSnare(S, out, t, vel) {
  const ctx = S.ctx;
  const o = osc(ctx, 'triangle', 210, t);
  o.frequency.exponentialRampToValueAtTime(160, t + 0.05);
  const og = gainNode(ctx, 0);
  og.gain.setValueAtTime(vel * 0.4, t);
  og.gain.setTargetAtTime(0, t + 0.004, 0.04);
  o.connect(og).connect(out);
  o.start(t);
  o.stop(t + 0.2);
  releaseOnEnd(o, [o, og]);
  const n = noiseSrc(S, t, 0.3);
  const hp = biquad(ctx, 'highpass', 900, 0.7);
  const pk = biquad(ctx, 'peaking', 2400, 1);
  pk.gain.value = 4;
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.009;
    g.gain.setValueAtTime(vel * 0.5, tt);
    g.gain.setTargetAtTime(vel * 0.12, tt + 0.001, 0.003);
  }
  g.gain.setValueAtTime(vel * 0.45, t + 0.027);
  g.gain.setTargetAtTime(vel * 0.17, t + 0.028, 0.06);
  g.gain.setTargetAtTime(0, t + 0.19, 0.006); // гейт
  n.connect(hp).connect(pk).connect(g).connect(out);
  releaseOnEnd(n, [n, hp, pk, g]);
}

/** Конга / бонго (открытый удар ладонью): тон с лёгким падением высоты, второй мод и шлепок. */
function drumHand(S, out, t, vel, f, decay, slap) {
  const ctx = S.ctx;
  const o = osc(ctx, 'sine', f * 1.08, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * 0.8, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.002, decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + decay * 5.5);
  releaseOnEnd(o, [o, g]);
  const m = osc(ctx, 'sine', f * 1.52, t);
  const mg = gainNode(ctx, 0);
  mg.gain.setValueAtTime(vel * 0.22, t);
  mg.gain.setTargetAtTime(0, t, decay * 0.3);
  m.connect(mg).connect(out);
  m.start(t);
  m.stop(t + decay * 2);
  releaseOnEnd(m, [m, mg]);
  const n = noiseSrc(S, t, 0.05);
  const bp = biquad(ctx, 'bandpass', slap, 1.2);
  const ng = gainNode(ctx, 0);
  ng.gain.setValueAtTime(vel * 0.4, t);
  ng.gain.setTargetAtTime(0, t, 0.006);
  n.connect(bp).connect(ng).connect(out);
  releaseOnEnd(n, [n, bp, ng]);
}

/** Рок-бочка: плотный короткий удар — быстрый спуск высоты, «тук» пластика и щелчок колотушки. */
function drumRockKick(S, out, t, vel) {
  const ctx = S.ctx;
  const o = osc(ctx, 'sine', 160, t);
  o.frequency.exponentialRampToValueAtTime(62, t + 0.028);
  o.frequency.exponentialRampToValueAtTime(47, t + 0.3);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.035, 0.065);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.4);
  releaseOnEnd(o, [o, g]);
  const k = osc(ctx, 'triangle', 480, t);
  k.frequency.exponentialRampToValueAtTime(170, t + 0.018);
  const kg = gainNode(ctx, 0);
  kg.gain.setValueAtTime(vel * 0.32, t);
  kg.gain.setTargetAtTime(0, t, 0.009);
  k.connect(kg).connect(out);
  k.start(t);
  k.stop(t + 0.07);
  releaseOnEnd(k, [k, kg]);
  const n = noiseSrc(S, t, 0.03);
  const bp = biquad(ctx, 'bandpass', 3400, 1.1);
  const ng = gainNode(ctx, 0);
  ng.gain.setValueAtTime(vel * 0.55, t);
  ng.gain.setTargetAtTime(0, t, 0.0035);
  n.connect(bp).connect(ng).connect(out);
  releaseOnEnd(n, [n, bp, ng]);
}

/** Рок-малый: низкий плотный тон, второй мод пластика и долгий яркий шум пружин. */
function drumRockSnare(S, out, t, vel) {
  const ctx = S.ctx;
  for (const [f0, f1, a, d] of [[205, 172, 0.62, 0.05], [335, 300, 0.26, 0.03]]) {
    const o = osc(ctx, 'triangle', f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.05);
    const og = gainNode(ctx, 0);
    og.gain.setValueAtTime(vel * a, t);
    og.gain.setTargetAtTime(0, t + 0.004, d);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.3);
    releaseOnEnd(o, [o, og]);
  }
  const n = noiseSrc(S, t, 0.45);
  const hp = biquad(ctx, 'highpass', 750, 0.7);
  const pk = biquad(ctx, 'peaking', 2700, 0.9);
  pk.gain.value = 5;
  const ng = gainNode(ctx, 0);
  ng.gain.setValueAtTime(vel * 0.55, t);
  ng.gain.setTargetAtTime(vel * 0.28, t + 0.004, 0.018);
  ng.gain.setTargetAtTime(0, t + 0.03, 0.1);
  n.connect(hp).connect(pk).connect(ng).connect(out);
  releaseOnEnd(n, [n, hp, pk, ng]);
}

// Райд: негармоничные призвуки [частота, амплитуда, спад (с)] — «пинг» палочки над шипящим звоном
const RIDE_P = [[2960, 0.5, 0.42], [4180, 0.42, 0.34], [5310, 0.33, 0.28], [6870, 0.26, 0.22], [8450, 0.2, 0.18]];

/** Тарелка райд: звонкий «пинг» и мягкое шипение, короче и суше крэша. */
function drumRide(S, out, t, vel) {
  const ctx = S.ctx;
  for (const [f, a, d] of RIDE_P) {
    const o = osc(ctx, 'sine', f, t);
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(vel * a * 0.22, t);
    g.gain.setTargetAtTime(0, t, d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + d * 5);
    releaseOnEnd(o, [o, g]);
  }
  const n = noiseSrc(S, t, 1.2);
  const hp = biquad(ctx, 'highpass', 5200, 0.7);
  const pk = biquad(ctx, 'peaking', 9000, 1);
  pk.gain.value = 4;
  const ng = gainNode(ctx, 0);
  ng.gain.setValueAtTime(vel * 0.3, t);
  ng.gain.setTargetAtTime(vel * 0.1, t + 0.002, 0.012);
  ng.gain.setTargetAtTime(0, t + 0.03, 0.28);
  n.connect(hp).connect(pk).connect(ng).connect(out);
  releaseOnEnd(n, [n, hp, pk, ng]);
}

/** One-shot AudioBuffer playback (pre-rendered drums). */
function playBuffer(ctx, buf, out, t, vel, rate) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  if (rate && rate !== 1) s.playbackRate.value = rate;
  if (vel === 1) {
    s.connect(out);
    releaseOnEnd(s, [s]);
  } else {
    const g = gainNode(ctx, vel);
    s.connect(g).connect(out);
    releaseOnEnd(s, [s, g]);
  }
  s.start(t);
}

const TOM_BASE = 200;
const DRUM_KIT = [
  ['kick', 0.5, (S, o, t) => drumKick(S, o, t, 1)],
  ['snare', 0.36, (S, o, t) => drumSnare(S, o, t, 1)],
  ['clap', 0.4, (S, o, t) => drumClap(S, o, t, 1)],
  ['hat', 0.12, (S, o, t) => drumHat(S, o, t, 1, false)],
  ['hat2', 0.12, (S, o, t) => drumHat(S, o, t, 1, false)],
  ['openHat', 0.55, (S, o, t) => drumHat(S, o, t, 1, true)],
  ['shaker', 0.16, (S, o, t) => drumShaker(S, o, t, 1)],
  ['crash', 2.0, (S, o, t) => drumCrash(S, o, t, 1)],
  ['tom', 0.46, (S, o, t) => drumTom(S, o, t, 1, TOM_BASE)],
  // перкуссия тем локаций (вызываются и напрямую, пока набор не готов)
  ['taiko', 1.3, drumTaiko],
  ['ka', 0.15, drumKa],
  ['clack', 0.3, drumClack],
  ['kane', 0.8, drumKane],
  ['gsnare', 0.32, drumGatedSnare],
  ['conga', 0.66, (S, o, t, v) => drumHand(S, o, t, v, 262, 0.12, 1500)],
  ['bongo', 0.36, (S, o, t, v) => drumHand(S, o, t, v, 523, 0.065, 2600)],
  // рок-установка «Кленового Перевала» (kickKind / snareKind, партия ride)
  ['rkick', 0.4, drumRockKick],
  ['rsnare', 0.5, drumRockSnare],
  ['ride', 1.3, drumRide],
];
// Перкуссия, которую темы пишут отдельными партиями (см. PERC_HIT)
const PERC = ['taiko', 'ka', 'clack', 'kane', 'conga', 'bongo', 'ride'];

/**
 * Renders every drum voice once into AudioBuffers (OfflineAudioContext) so the
 * sequencer can play each hit with 1-2 nodes instead of 3-7 filtered ones.
 * Calls done(null) when offline rendering is unavailable.
 */
function renderDrumKit(ctx, done) {
  const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!OAC) return done(null);
  const rate = ctx.sampleRate;
  // каждый звук в своём отрезке (его длина + зазор 0.1 с)
  const at = [];
  let total = 0;
  for (const [, len] of DRUM_KIT) {
    at.push(total);
    total += len + 0.1;
  }
  let finished = false;
  const finish = (rendered) => {
    if (finished) return;
    finished = true;
    if (!rendered) return done(null);
    const data = rendered.getChannelData(0);
    const kit = {};
    DRUM_KIT.forEach(([name, len], i) => {
      const n = Math.floor(len * rate);
      const b = ctx.createBuffer(1, n, rate);
      b.getChannelData(0).set(data.subarray(Math.floor(at[i] * rate), Math.floor(at[i] * rate) + n));
      kit[name] = b;
    });
    done(kit);
  };
  try {
    const off = new OAC(1, Math.ceil(rate * total), rate);
    const S = { ctx: off, noise: makeNoiseBuffer(off, 2) };
    DRUM_KIT.forEach(([, , fn], i) => fn(S, off.destination, at[i], 1));
    off.oncomplete = (e) => finish(e.renderedBuffer);
    const p = off.startRendering();
    if (p && p.then) p.then(finish, () => finish(null));
  } catch (e) {
    finish(null);
  }
}

/** Bass voice. kind: 'saw' | 'pluck' (squelchy eurobeat) | 'sub' | 'funk' */
function synthBass(S, out, t, dur, midi, vel, kind) {
  const ctx = S.ctx;
  const f = mtof(midi);
  dur = Math.max(0.04, dur);
  const end = t + dur;
  const lp = biquad(ctx, 'lowpass', 800, 1);
  const g = gainNode(ctx, 0);
  const srcs = [];
  if (kind === 'sub') {
    srcs.push(osc(ctx, 'sine', f, t), osc(ctx, 'triangle', f, t));
    lp.frequency.setValueAtTime(1100, t);
    lp.frequency.setTargetAtTime(480, t, 0.08);
  } else if (kind === 'pluck') {
    const a = osc(ctx, 'sawtooth', f, t);
    const b = osc(ctx, 'sawtooth', f, t);
    b.detune.setValueAtTime(11, t);
    srcs.push(a, b);
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.setTargetAtTime(300, t, 0.065);
  } else if (kind === 'funk') {
    srcs.push(osc(ctx, 'square', f, t), osc(ctx, 'sawtooth', f, t));
    lp.Q.value = 3.5;
    lp.frequency.setValueAtTime(1900, t);
    lp.frequency.setTargetAtTime(420, t, 0.09);
  } else {
    const a = osc(ctx, 'sawtooth', f, t);
    const b = osc(ctx, 'square', f, t);
    b.detune.setValueAtTime(-7, t);
    srcs.push(a, b);
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(1500, t);
    lp.frequency.setTargetAtTime(430, t, 0.1);
  }
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.005);
  g.gain.setTargetAtTime(vel * 0.72, t + 0.005, 0.12);
  g.gain.setTargetAtTime(0, end, 0.025);
  const mix = gainNode(ctx, 0.5);
  for (const s of srcs) {
    s.connect(mix);
    s.start(t);
    s.stop(end + 0.2);
  }
  mix.connect(lp).connect(g).connect(out);
  releaseOnEnd(srcs[srcs.length - 1], srcs.concat([mix, lp, g]));
}

/**
 * Detuned-saw chord (pads and stabs). Two saws per note panned L/R for width.
 * o: { attack, release, cut0, cut1, cutTc, detune, sustain, swell, scoop }
 * swell — медь: фильтр раскрывается от этой частоты до cut0 за атаку; scoop — подъезд высоты снизу (центы).
 */
function synthChordSaw(S, out, t, dur, notes, vel, o) {
  const ctx = S.ctx;
  const attack = o.attack;
  dur = Math.max(dur, attack + 0.02);
  const lp = biquad(ctx, 'lowpass', o.cut0, 0.7);
  lp.frequency.setValueAtTime(o.swell || o.cut0, t);
  if (o.swell) lp.frequency.linearRampToValueAtTime(o.cut0, t + attack);
  lp.frequency.setTargetAtTime(o.cut1, t + (o.swell ? attack : 0), o.cutTc);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + attack);
  if (o.sustain < 1) g.gain.setTargetAtTime(vel * o.sustain, t + attack, 0.1);
  g.gain.setTargetAtTime(0, t + dur, o.release / 4);
  const pl = stereo(ctx, -0.6);
  const pr = stereo(ctx, 0.6);
  const all = [lp, g];
  if (pl) {
    pl.connect(lp);
    pr.connect(lp);
    all.push(pl, pr);
  }
  lp.connect(g).connect(out);
  const stopAt = t + dur + o.release + 0.05;
  let last = null;
  for (const m of notes) {
    const f = mtof(m);
    const a = osc(ctx, 'sawtooth', f, t);
    const b = osc(ctx, 'sawtooth', f, t);
    const sc = o.scoop || 0;
    a.detune.setValueAtTime(-o.detune - sc, t);
    b.detune.setValueAtTime(o.detune - sc, t);
    if (sc) {
      a.detune.linearRampToValueAtTime(-o.detune, t + 0.05);
      b.detune.linearRampToValueAtTime(o.detune, t + 0.05);
    }
    a.connect(pl || lp);
    b.connect(pr || lp);
    a.start(t);
    b.start(t);
    a.stop(stopAt);
    b.stop(stopAt);
    all.push(a, b);
    last = b;
  }
  if (last) releaseOnEnd(last, all);
}

/** FM electric piano (DX-style "city pop" EP). */
function synthEP(S, out, t, dur, notes, vel) {
  const ctx = S.ctx;
  const stopAt = t + dur + 0.4;
  notes.forEach((m) => {
    const f = mtof(m);
    const car = osc(ctx, 'sine', f, t);
    const mod = osc(ctx, 'sine', f, t);
    const mg = gainNode(ctx, 0);
    mg.gain.setValueAtTime(f * 1.9, t);
    mg.gain.setTargetAtTime(f * 0.22, t, 0.22);
    const tine = osc(ctx, 'sine', f * 14, t);
    const tg = gainNode(ctx, 0);
    tg.gain.setValueAtTime(f * 1.4, t);
    tg.gain.setTargetAtTime(0, t, 0.012);
    mod.connect(mg).connect(car.frequency);
    tine.connect(tg).connect(car.frequency);
    const amp = gainNode(ctx, 0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.004);
    amp.gain.setTargetAtTime(vel * 0.25, t + 0.004, 0.7);
    amp.gain.setTargetAtTime(0, t + dur, 0.07);
    car.connect(amp).connect(out);
    const nodes = [car, mod, mg, tine, tg, amp];
    for (const o of [car, mod, tine]) {
      o.start(t);
      o.stop(stopAt);
    }
    releaseOnEnd(car, nodes);
  });
}

/** Sine partial bell / glockenspiel. partials: how many partials (1..4). */
const BELL_P = [
  [1, 1, 1],
  [2, 0.42, 0.55],
  [3, 0.18, 0.32],
  [4.2, 0.1, 0.2],
];
function synthBell(S, out, t, freq, vel, decay, partials) {
  const ctx = S.ctx;
  const n = Math.min(partials || 4, 4);
  for (let i = 0; i < n; i++) {
    const [r, a, d] = BELL_P[i];
    const o = osc(ctx, 'sine', freq * r, t);
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * a, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, (decay * d) / 3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay * d * 2.2 + 0.05);
    releaseOnEnd(o, [o, g]);
  }
}

/** Short filtered pluck (arps). o: { wave, bright, decay, detune } */
function synthPluck(S, out, t, midi, vel, o) {
  const ctx = S.ctx;
  const f = mtof(midi);
  const a = osc(ctx, o.wave || 'sawtooth', f, t);
  const srcs = [a];
  if (o.detune) {
    const b = osc(ctx, o.wave || 'sawtooth', f, t);
    b.detune.setValueAtTime(o.detune, t);
    srcs.push(b);
  }
  const lp = biquad(ctx, 'lowpass', o.bright || 4000, 2);
  lp.frequency.setValueAtTime(o.bright || 4000, t);
  lp.frequency.setTargetAtTime(450, t, (o.decay || 0.1) * 0.7);
  const g = gainNode(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.002, o.decay || 0.1);
  const stopAt = t + (o.decay || 0.1) * 6 + 0.02;
  for (const s of srcs) {
    s.connect(lp);
    s.start(t);
    s.stop(stopAt);
  }
  lp.connect(g).connect(out);
  releaseOnEnd(a, srcs.concat([lp, g]));
}

/** Mallet (marimba-ish) for tropical plucks. */
function synthMarimba(S, out, t, midi, vel, decay) {
  const ctx = S.ctx;
  const f = mtof(midi);
  const a = osc(ctx, 'sine', f, t);
  const b = osc(ctx, 'sine', f * 3.97, t);
  const ga = gainNode(ctx, 0);
  const gb = gainNode(ctx, 0);
  ga.gain.setValueAtTime(0, t);
  ga.gain.linearRampToValueAtTime(vel, t + 0.003);
  ga.gain.setTargetAtTime(0, t + 0.003, decay);
  gb.gain.setValueAtTime(vel * 0.4, t);
  gb.gain.setTargetAtTime(0, t, decay * 0.18);
  a.connect(ga).connect(out);
  b.connect(gb).connect(out);
  const stopAt = t + decay * 6 + 0.02;
  a.start(t);
  b.start(t);
  a.stop(stopAt);
  b.stop(stopAt);
  releaseOnEnd(a, [a, b, ga, gb]);
}

/**
 * Lead voice with delayed vibrato, optional second oscillator, portamento and
 * optional breath noise (flute-ish).
 * o: { wave, wave2, ratio2, mix2, detune, cutoff, q, attack, sustain, release, vibrato, vibRate, breath }
 */
function synthLead(S, out, t, dur, midi, vel, o, glideFrom) {
  const ctx = S.ctx;
  const f = mtof(midi);
  dur = Math.max(0.05, dur);
  const end = t + dur;
  const release = o.release || 0.05;
  const stopAt = end + release * 6 + 0.02;
  const lp = biquad(ctx, 'lowpass', o.cutoff * 2, o.q || 1);
  lp.frequency.setValueAtTime(o.cutoff * 2, t);
  lp.frequency.setTargetAtTime(o.cutoff, t, 0.09);
  const nodes = [lp];
  const oscs = [];
  const a = osc(ctx, o.wave || 'square', f, t);
  a.connect(lp);
  oscs.push([a, 1]);
  if (o.wave2) {
    const r = o.ratio2 || 1;
    const b = osc(ctx, o.wave2, f * r, t);
    b.detune.setValueAtTime(o.detune || 0, t);
    const bg = gainNode(ctx, o.mix2 === undefined ? 1 : o.mix2);
    b.connect(bg).connect(lp);
    nodes.push(bg);
    oscs.push([b, r]);
  }
  if (glideFrom) {
    for (const [ob, r] of oscs) {
      ob.frequency.setValueAtTime(glideFrom * r, t);
      ob.frequency.exponentialRampToValueAtTime(f * r, t + 0.05);
    }
  }
  if (o.vibrato && dur > 0.2) {
    const lfo = osc(ctx, 'sine', o.vibRate || 5.5, t);
    const lg = gainNode(ctx, 0);
    lg.gain.setValueAtTime(0, t);
    lg.gain.setValueAtTime(0, t + 0.14);
    lg.gain.linearRampToValueAtTime(f * o.vibrato, t + Math.min(0.45, dur));
    lfo.connect(lg);
    for (const [ob] of oscs) lg.connect(ob.frequency);
    lfo.start(t);
    lfo.stop(stopAt);
    nodes.push(lfo, lg);
  }
  const g = gainNode(ctx, 0);
  const atk = o.attack || 0.006;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + atk);
  g.gain.setTargetAtTime(vel * (o.sustain || 0.8), t + atk, 0.15);
  g.gain.setTargetAtTime(0, Math.max(end, t + atk + 0.001), release / 3);
  lp.connect(g).connect(out);
  nodes.push(g);
  if (o.breath) {
    const n = noiseSrc(S, t, dur + 0.1);
    const bp = biquad(ctx, 'bandpass', Math.min(f * 2.5, 9000), 1.5);
    const bg = gainNode(ctx, 0);
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(vel * o.breath, t + 0.02);
    bg.gain.setTargetAtTime(vel * o.breath * 0.25, t + 0.02, 0.06);
    bg.gain.setTargetAtTime(0, end, 0.03);
    n.connect(bp).connect(bg).connect(out);
    releaseOnEnd(n, [n, bp, bg]);
  }
  for (const [ob] of oscs) {
    ob.start(t);
    ob.stop(stopAt);
    nodes.push(ob);
  }
  releaseOnEnd(a, nodes);
}

// ---------------------------------------------------------------------------
// Тоны, синтезированные в JS прямо в AudioBuffer (по разу на ноту, кэш в S.tones):
// щипковые струны по Карплусу–Стронгу, стил-пэн и перегруженные электрогитары. Нота потом
// стоит 2 узла. Синтез — генераторы, уступающие управление после каждого куска (не длиннее
// CHUNK отсчётов): плеер греет тоны темы кусками, не дольше WARM_MS за тик, в порядке первого
// звучания, и главный поток не замирает на десятки миллисекунд, когда тема стартует.
// ---------------------------------------------------------------------------

const CHUNK = 4096; // генераторы синтеза уступают управление не реже чем через CHUNK отсчётов
const WARM_MS = 3; // бюджет прогрева тонов за тик планировщика, мс
const HOLD_MAX = 0.6; // сколько тема может ждать тоны первого такта, с
const HOLD_STEPS = 4; // шаги начала темы, чьи тоны должны быть готовы до старта
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// secs — длина буфера, t60 — затухание (с), damp — фильтр петли (0..0.5, больше — глуше),
// tone — яркость щипка (0..1), pos — точка щипка (доля струны), buzz — порог «савари»
// (жужжание струны сямисэна о порожек), click — удар ногтя-цумэ / бати по коже.
const STRINGS = {
  koto: { secs: 1.2, t60: 1.5, damp: 0.18, tone: 0.8, pos: 0.13, buzz: 0, click: 0.12 },
  shamisen: { secs: 0.8, t60: 0.9, damp: 0.08, tone: 1, pos: 0.07, buzz: 0.45, click: 0.6 },
  uke: { secs: 0.9, t60: 0.8, damp: 0.45, tone: 0.3, pos: 0.22, buzz: 0, click: 0.03 },
};

// Синтез тонов разбит на «ядра» — обычные функции над отрезком [from, to) массива (их циклы V8
// оптимизирует; состояние между кусками — в Float64Array), и тонкие генераторы, которые вызывают
// ядра кусками по CHUNK отсчётов и уступают управление между ними.

// Длина куска подстраивается под скорость: пока ядро не оптимизировано (первые вызовы) или процессор
// медленный, кусок короче, чтобы один кусок не занимал больше ~0.3 мс.
let chunkLen = 256;

/** Вызывает fn(from, to) кусками из n отсчётов, уступая управление после каждого. Генератор. */
function* chunks(n, fn) {
  for (let i = 0; i < n; ) {
    const j = Math.min(n, i + chunkLen);
    const t = clock();
    fn(i, j);
    const dt = clock() - t;
    if (dt > 0.3 && chunkLen > 64) chunkLen >>= 1;
    else if (dt < 0.1 && chunkLen < CHUNK) chunkLen <<= 1;
    i = j;
    yield;
  }
}

/** Петля струны Карплуса–Стронга на [from, to): состояние — сам массив d (уже посчитанные отсчёты). */
function ksRun(d, from, to, Di, fr, loss, damp, buzz, exc, E, ep) {
  for (let i = from; i < to; i++) {
    const j = i - Di;
    const a = j >= 0 ? d[j] : 0;
    const b = j >= 1 ? d[j - 1] : 0;
    const c = j >= 2 ? d[j - 2] : 0;
    const x0 = a + fr * (b - a);
    let v = loss * (x0 + damp * (b + fr * (c - b) - x0));
    if (buzz && v < -buzz) v = -buzz + (v + buzz) * 0.25;
    d[i] = i < E ? v + exc[i] / ep : v;
  }
}

/**
 * Струна по Карплусу–Стронгу в массив d: шумовой щипок бежит по дробной линии задержки
 * с фильтром потерь. o: { t60, damp, tone, pos, buzz } (см. STRINGS). Генератор.
 */
function* pluck(d, rate, f, o) {
  const P = rate / f;
  const D = P - o.damp; // двухотводный фильтр петли добавляет damp отсчётов задержки
  const Di = Math.floor(D);
  const fr = D - Di;
  const loss = Math.pow(0.001, P / (rate * o.t60));
  // возбуждение: период окрашенного шума минус его сдвинутая копия (точка щипка)
  const E = Math.ceil(P);
  const exc = new Float32Array(E);
  let lp = 0;
  for (let i = 0; i < E; i++) {
    lp += o.tone * (Math.random() * 2 - 1 - lp);
    exc[i] = lp;
  }
  const pd = Math.max(1, Math.round(P * o.pos));
  for (let i = E - 1; i >= pd; i--) exc[i] -= exc[i - pd];
  let ep = 1e-9;
  for (let i = 0; i < E; i++) ep = Math.max(ep, Math.abs(exc[i]));
  const buzz = o.buzz || 0;
  yield* chunks(d.length, (a, b) => ksRun(d, a, b, Di, fr, loss, o.damp, buzz, exc, E, ep));
}

/** Щелчок атаки (первые clickLen отсчётов), срез постоянной составляющей и пик на [from, to); st = [prev, y, peak]. */
function strPost(d, from, to, st, rate, click, clickLen) {
  let prev = st[0];
  let y = st[1];
  let peak = st[2];
  for (let i = from; i < to; i++) {
    let x = d[i];
    if (i < clickLen) x += click * (Math.random() * 2 - 1) * Math.exp(-i / (rate * 0.003));
    y = x - prev + 0.995 * y;
    prev = x;
    d[i] = y;
    if (Math.abs(y) > peak) peak = Math.abs(y);
  }
  st[0] = prev;
  st[1] = y;
  st[2] = peak;
}

/** Нормировка (g = 0.9 / пик) с затухающим краем в fade отсчётов на [from, to). */
function normRun(d, from, to, g, n, fade) {
  for (let i = from; i < to; i++) d[i] *= g * (i > n - fade ? (n - i) / fade : 1);
}

/** Струна (кото, сямисэн, укулеле) в буфер: щипок, щелчок атаки, нормировка. Генератор, вернёт AudioBuffer. */
function* stringGen(ctx, f, o) {
  const rate = ctx.sampleRate;
  const n = Math.floor(rate * o.secs);
  const buf = ctx.createBuffer(1, n, rate);
  const d = buf.getChannelData(0);
  yield* pluck(d, rate, f, o);
  // щелчок атаки, срез постоянной составляющей, нормировка и затухающий край
  const st = new Float64Array([0, 0, 1e-9]);
  const clickLen = Math.floor(rate * 0.02);
  yield* chunks(n, (a, b) => strPost(d, a, b, st, rate, o.click, clickLen));
  const g = 0.9 / st[2];
  const fade = Math.floor(rate * 0.03);
  yield* chunks(n, (a, b) => normRun(d, a, b, g, n, fade));
  return buf;
}

// Перегруженные электрогитары и бас-гитара. Струны по Карплусу–Стронгу (t60, damp, tone, pos — как
// в STRINGS) → предусилитель: ФВЧ pre (Гц), усиление drive, мягкое насыщение sat (≈ tanh) со
// смещением bias (чётные гармоники) при двукратной передискретизации → «кабинет»: ФВЧ hp, горб
// середины mid / midDb, крутой ФНЧ lp; mid2 / mid2Db — второй эквалайзер (провал, чтобы ритм-гитары
// не закрывали соло). iv — струны (полутоны от ноты: квинтаккорд 0, 7, 12), strum — разнос струн
// при ударе (с), takes: 2 — два разных дубля (свой шум щипка, строй ±spread центов) в левом и правом
// канале, env — спад после перегруза (с; глушение ладонью), sub — синус основного тона (бас).
// Буфер — на половинной частоте дискретизации: выше 5 кГц кабинет всё равно ничего не пропускает.
const AMPS = {
  gtr: { secs: 0.8, iv: [0, 7, 12], mix: [1, 0.85, 0.6], takes: 2, strum: 0.011, spread: 5, t60: 3, damp: 0.16, tone: 0.8, pos: 0.13, pre: 180, drive: 14, bias: 0.25, hp: 90, mid: 600, midDb: 2, mid2: 1500, mid2Db: -5, lp: 4600 },
  gmute: { secs: 0.34, iv: [0, 7, 12], mix: [1, 0.8, 0.5], takes: 2, strum: 0.004, spread: 5, t60: 0.14, damp: 0.38, tone: 0.55, pos: 0.13, pre: 110, drive: 10, bias: 0.25, env: 0.07, hp: 90, mid: 850, midDb: 3, lp: 2800 },
  glead: { secs: 1.8, iv: [0], takes: 1, spread: 0, t60: 5, damp: 0.1, tone: 0.9, pos: 0.1, pre: 350, drive: 24, bias: 0.2, hp: 110, mid: 1500, midDb: 6, lp: 5000 },
  griff: { secs: 0.7, iv: [0], takes: 1, spread: 0, t60: 1.2, damp: 0.16, tone: 0.8, pos: 0.12, pre: 200, drive: 12, bias: 0.25, hp: 90, mid: 1200, midDb: 4, lp: 4200 },
  gbass: { secs: 0.9, iv: [0], takes: 1, spread: 0, t60: 1.6, damp: 0.3, tone: 0.45, pos: 0.2, pre: 0, drive: 1.6, bias: 0.1, sub: 0.25, hp: 38, mid: 750, midDb: 3, lp: 2300 },
};

/** Коэффициенты биквада (RBJ) [b0, b1, b2, a1, a2]: type 'lp' | 'hp' | 'peak'. */
function bqCoefs(type, f, q, db, rate) {
  const w = (2 * Math.PI * f) / rate;
  const cw = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const A = Math.pow(10, db / 40);
  let b0, b1, b2, a1, a2, a0;
  if (type === 'lp') {
    b1 = 1 - cw;
    b0 = b2 = b1 / 2;
  } else if (type === 'hp') {
    b1 = -(1 + cw);
    b0 = b2 = (1 + cw) / 2;
  }
  if (type === 'peak') {
    b0 = 1 + al * A;
    b1 = -2 * cw;
    b2 = 1 - al * A;
    a0 = 1 + al / A;
    a2 = 1 - al / A;
  } else {
    a0 = 1 + al;
    a2 = 1 - al;
  }
  a1 = -2 * cw;
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Биквад c = [b0, b1, b2, a1, a2] на месте на [from, to); st = [x1, x2, y1, y2]. */
function bqRun(d, from, to, c, st) {
  const b0 = c[0];
  const b1 = c[1];
  const b2 = c[2];
  const a1 = c[3];
  const a2 = c[4];
  let x1 = st[0];
  let x2 = st[1];
  let y1 = st[2];
  let y2 = st[3];
  for (let i = from; i < to; i++) {
    const x = d[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    d[i] = y;
  }
  st[0] = x1;
  st[1] = x2;
  st[2] = y1;
  st[3] = y2;
}

/** Мягкое насыщение: рациональное приближение tanh, гладко (с нулевой производной) выходит на ±1 при |x| = 3. */
const sat = (x) => (x <= -3 ? -1 : x >= 3 ? 1 : (x * (27 + x * x)) / (27 + 9 * x * x));

/**
 * Предусилитель и перегруз на [from, to): ФВЧ первого порядка ka, усиление drive, насыщение со
 * смещением bias на удвоенной частоте (промежуточный отсчёт — линейная интерполяция), ФНЧ
 * Баттерворта 4-го порядка aa (два биквада подряд) и прореживание; после hold отсчётов — спад ke.
 * st — состояние (12 чисел: ФВЧ, интерполятор, огибающая, два биквада).
 */
function ampRun(d, from, to, st, ka, drive, bias, aa, ke, hold) {
  const tb = sat(bias);
  const p0 = aa[0];
  const p1 = aa[1];
  const p2 = aa[2];
  const pa1 = aa[3];
  const pa2 = aa[4];
  const q0 = aa[5];
  const q1 = aa[6];
  const q2 = aa[7];
  const qa1 = aa[8];
  const qa2 = aa[9];
  let hx = st[0];
  let hy = st[1];
  let pu = st[2];
  let e = st[3];
  let px1 = st[4];
  let px2 = st[5];
  let py1 = st[6];
  let py2 = st[7];
  let qx1 = st[8];
  let qx2 = st[9];
  let qy1 = st[10];
  let qy2 = st[11];
  for (let i = from; i < to; i++) {
    const x = d[i];
    hy = ka ? ka * (hy + x - hx) : x;
    hx = x;
    const u = hy * drive;
    const vm = sat(0.5 * (u + pu) + bias) - tb;
    const vc = sat(u + bias) - tb;
    pu = u;
    let y = p0 * vm + p1 * px1 + p2 * px2 - pa1 * py1 - pa2 * py2;
    px2 = px1;
    px1 = vm;
    py2 = py1;
    py1 = y;
    let z = q0 * y + q1 * qx1 + q2 * qx2 - qa1 * qy1 - qa2 * qy2;
    qx2 = qx1;
    qx1 = y;
    qy2 = qy1;
    qy1 = z;
    y = p0 * vc + p1 * px1 + p2 * px2 - pa1 * py1 - pa2 * py2;
    px2 = px1;
    px1 = vc;
    py2 = py1;
    py1 = y;
    z = q0 * y + q1 * qx1 + q2 * qx2 - qa1 * qy1 - qa2 * qy2;
    qx2 = qx1;
    qx1 = y;
    qy2 = qy1;
    qy1 = z;
    if (i >= hold) e *= ke;
    d[i] = z * e; // прореживание: остаётся каждый второй отсчёт
  }
  st[0] = hx;
  st[1] = hy;
  st[2] = pu;
  st[3] = e;
  st[4] = px1;
  st[5] = px2;
  st[6] = py1;
  st[7] = py2;
  st[8] = qx1;
  st[9] = qx2;
  st[10] = qy1;
  st[11] = qy2;
}

/** Струна str со сдвигом at и громкостью g — в сумму d на [from, to). */
function addRun(d, from, to, str, at, g) {
  for (let i = Math.max(from, at); i < to; i++) d[i] += g * str[i - at];
}

/** Основной тон синусом (поворот фазора) с атакой atk отсчётов и спадом kd — в сумму d на [from, to); st = [x, y, амплитуда]. */
function subRun(d, from, to, st, cw, sw, kd, atk) {
  let x = st[0];
  let y = st[1];
  let a = st[2];
  for (let i = from; i < to; i++) {
    const nx = x * cw + y * sw;
    y = y * cw - x * sw;
    x = nx;
    d[i] += x * a * (i < atk ? i / atk : 1);
    a *= kd;
  }
  st[0] = x;
  st[1] = y;
  st[2] = a;
}

/** Пик |d| на [from, to) с учётом уже найденного st[0]. */
function peakRun(d, from, to, st) {
  let peak = st[0];
  for (let i = from; i < to; i++) if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
  st[0] = peak;
}

/** Электрогитара / бас-гитара (параметры AMPS) для ноты midi. Генератор, вернёт AudioBuffer (дубли — каналы). */
function* ampGen(ctx, midi, o) {
  const rate = Math.max(22050, ctx.sampleRate / 2); // старый Safari не создаёт буферы ниже 22050 Гц
  const n = Math.floor(rate * o.secs);
  const buf = ctx.createBuffer(o.takes, n, rate);
  const str = new Float32Array(n);
  // ФНЧ Баттерворта 4-го порядка на удвоенной частоте: всё выше 0.45·rate убрать до прореживания
  const aa = new Float64Array(bqCoefs('lp', 0.45 * rate, 0.541, 0, 2 * rate).concat(bqCoefs('lp', 0.45 * rate, 1.307, 0, 2 * rate)));
  const cab = [bqCoefs('hp', o.hp, 0.707, 0, rate), bqCoefs('peak', o.mid, 0.9, o.midDb, rate), bqCoefs('lp', o.lp, 0.541, 0, rate), bqCoefs('lp', o.lp, 1.307, 0, rate)];
  if (o.mid2) cab.push(bqCoefs('peak', o.mid2, 0.9, o.mid2Db, rate));
  const ka = o.pre ? Math.exp((-2 * Math.PI * o.pre) / rate) : 0;
  const ke = o.env ? Math.exp(-1 / (rate * o.env)) : 1;
  const hold = Math.floor(rate * 0.015);
  const pk = new Float64Array([1e-9]);
  for (let c = 0; c < o.takes; c++) {
    const d = buf.getChannelData(c);
    for (let k = 0; k < o.iv.length; k++) {
      str.fill(0);
      const det = Math.pow(2, ((Math.random() * 2 - 1) * o.spread) / 1200);
      yield* pluck(str, rate, mtof(midi + o.iv[k]) * det, o);
      // удар по струнам сверху вниз: каждая следующая чуть позже
      const at = k ? Math.floor(rate * o.strum * k * (0.7 + 0.6 * Math.random())) : 0;
      const g = o.mix ? o.mix[k] : 1;
      yield* chunks(n, (a, b) => addRun(d, a, b, str, at, g));
    }
    if (o.sub) {
      const w = (2 * Math.PI * mtof(midi)) / rate;
      const kd = Math.exp(-1 / (rate * o.t60 * 0.35));
      const atk = Math.floor(rate * 0.004);
      const s = new Float64Array([0, 1, o.sub]);
      yield* chunks(n, (a, b) => subRun(d, a, b, s, Math.cos(w), Math.sin(w), kd, atk));
    }
    const st = new Float64Array(12);
    st[3] = 1;
    yield* chunks(n, (a, b) => ampRun(d, a, b, st, ka, o.drive, o.bias, aa, ke, hold));
    for (const cc of cab) {
      const s = new Float64Array(4);
      yield* chunks(n, (a, b) => bqRun(d, a, b, cc, s));
    }
    yield* chunks(n, (a, b) => peakRun(d, a, b, pk));
  }
  const g = 0.9 / pk[0];
  const fade = Math.floor(rate * 0.03);
  for (let c = 0; c < o.takes; c++) {
    const d = buf.getChannelData(c);
    yield* chunks(n, (a, b) => normRun(d, a, b, g, n, fade));
  }
  return buf;
}

// Стил-пэн: [отношение частоты, амплитуда, спад (с), «расцвет» (с)]. Октава и дуодецима чуть
// завышены, основной тон расщеплён (медленные биения), верхние призвуки негармоничны.
const PAN_P = [
  [1, 1, 0.36, 0],
  [1.0025, 0.28, 0.45, 0],
  [2.005, 0.6, 0.26, 0.018],
  [3.01, 0.22, 0.14, 0.006],
  [4.16, 0.07, 0.05, 0],
  [5.43, 0.04, 0.035, 0],
];

/** Затухающий призвук стил-пэна (поворот фазора, «расцвет» kb) на [from, to); st = [x, y, e, b]. */
function panRun(d, from, to, st, cw, sw, kd, kb) {
  let x = st[0];
  let y = st[1];
  let e = st[2];
  let b = st[3];
  for (let i = from; i < to; i++) {
    const nx = x * cw + y * sw;
    y = y * cw - x * sw;
    x = nx;
    e *= kd;
    b *= kb;
    d[i] += x * e * (1 - b);
  }
  st[0] = x;
  st[1] = y;
  st[2] = e;
  st[3] = b;
}

/** Удар резиновой палочки (шум через ФНЧ), атака atk отсчётов и пик на [from, to); st = [lp, peak]. */
function panPost(d, from, to, st, rate, atk) {
  let lp = st[0];
  let peak = st[1];
  for (let i = from; i < to; i++) {
    lp += 0.15 * (Math.random() * 2 - 1 - lp);
    const v = d[i] * (i < atk ? i / atk : 1) + lp * 0.5 * Math.exp(-i / (rate * 0.005));
    d[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  st[0] = lp;
  st[1] = peak;
}

/** Нота стил-пэна: сумма затухающих синусов (поворот фазора) + мягкий удар резиновой палочки. Генератор. */
function* panGen(ctx, f) {
  const rate = ctx.sampleRate;
  const n = Math.floor(rate * 1.3);
  const buf = ctx.createBuffer(1, n, rate);
  const d = buf.getChannelData(0);
  const k = Math.pow(523 / f, 0.3); // высокие ноты звенят короче
  for (const [r, amp, dec, bloom] of PAN_P) {
    const w = (2 * Math.PI * f * r) / rate;
    if (w > 2.6) continue;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const kd = Math.exp(-1 / (rate * dec * k));
    const kb = bloom ? Math.exp(-1 / (rate * bloom)) : 0;
    const st = new Float64Array([0, 1, amp, 1]);
    yield* chunks(n, (a, b) => panRun(d, a, b, st, cw, sw, kd, kb));
  }
  const st = new Float64Array([0, 1e-9]);
  const atk = Math.floor(rate * 0.0015);
  yield* chunks(n, (a, b) => panPost(d, a, b, st, rate, atk));
  const g = 0.9 / st[1];
  const fade = Math.floor(rate * 0.05);
  yield* chunks(n, (a, b) => normRun(d, a, b, g, n, fade));
  return buf;
}

/** Есть ли у инструмента kind буферы тонов (кото, сямисэн, укулеле, стил-пэн, гитары). */
const isTone = (kind) => kind === 'pan' || !!STRINGS[kind] || !!AMPS[kind];

/**
 * Синтезирует (или дорабатывает начатый) тон kind для ноты midi до момента deadline
 * (clock(), мс): true — буфер готов и лежит в S.tones, false — время вышло, продолжим позже.
 */
function warmTone(S, kind, midi, deadline) {
  const key = kind + midi;
  if (S.tones.has(key)) return true;
  let job = S.jobs.get(key);
  if (!job) {
    const f = mtof(midi);
    job = kind === 'pan' ? panGen(S.ctx, f) : AMPS[kind] ? ampGen(S.ctx, midi, AMPS[kind]) : stringGen(S.ctx, f, STRINGS[kind]);
    S.jobs.set(key, job);
  }
  for (;;) {
    const r = job.next();
    if (r.done) {
      S.tones.set(key, r.value);
      S.jobs.delete(key);
      S.pending.delete(key);
      return true;
    }
    if (clock() >= deadline) return false;
  }
}

/**
 * Буфер тона kind для ноты midi. Тон из очереди прогрева, который ещё не готов, — null: нота
 * пропускается (счётчик S.missed), чтобы не синтезировать его целиком посреди тика. Тон вне
 * очереди синтезируется сразу.
 */
function toneBuffer(S, kind, midi) {
  const key = kind + midi;
  const b = S.tones.get(key);
  if (b) return b;
  if (S.pending.has(key)) {
    S.missed++;
    return null;
  }
  warmTone(S, kind, midi, Infinity);
  return S.tones.get(key);
}

/**
 * Нота из кэша тонов: источник (bend — подтяжка высоты на атаке, центы) → громкость → out.
 * dur > 0 — приглушить через dur секунд, иначе звучит до конца буфера.
 */
function playTone(S, out, t, kind, midi, vel, dur, bend) {
  const buf = toneBuffer(S, kind, midi);
  if (!buf) return;
  const ctx = S.ctx;
  const s = ctx.createBufferSource();
  s.buffer = buf;
  if (bend && s.detune) {
    s.detune.setValueAtTime(bend, t);
    s.detune.linearRampToValueAtTime(0, t + 0.045);
  }
  const g = gainNode(ctx, vel);
  s.connect(g).connect(out);
  s.start(t);
  if (dur > 0 && dur < s.buffer.duration) {
    g.gain.setValueAtTime(vel, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.025);
    s.stop(t + dur + 0.15);
  }
  releaseOnEnd(s, [s, g]);
}

/**
 * Соло-гитара: нота из кэша тонов с подтяжкой (bend центов → 0 за bt с: бенд или слайд от
 * предыдущей ноты) и вибрато o.vib центов с частотой o.vibRate, вступающим постепенно. Высота
 * ведётся кривой detune самого источника — нота стоит те же 2 узла.
 */
function playGuitar(S, out, t, kind, midi, vel, dur, o, bend, bt) {
  const buf = toneBuffer(S, kind, midi);
  if (!buf) return;
  const ctx = S.ctx;
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const g = gainNode(ctx, vel);
  s.connect(g).connect(out);
  const end = t + Math.max(0.03, Math.min(dur, buf.duration - 0.05));
  const p = s.detune;
  let t1 = t;
  if (bend && p) {
    t1 = t + bt;
    p.setValueAtTime(bend, t);
    p.linearRampToValueAtTime(0, t1);
  }
  const v0 = t1 + 0.1;
  if (o.vib && p && end - v0 > 0.2) {
    const len = end - v0;
    const n = Math.ceil(len * o.vibRate * 16) + 2;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * len;
      curve[i] = o.vib * Math.min(1, x / 0.3) * Math.sin(2 * Math.PI * o.vibRate * x);
    }
    p.setValueCurveAtTime(curve, v0, len);
  }
  s.start(t);
  g.gain.setValueAtTime(vel, end);
  g.gain.setTargetAtTime(0, end, 0.03);
  s.stop(end + 0.2);
  releaseOnEnd(s, [s, g]);
}

/**
 * Кото: щипок с подтяжкой высоты на атаке; долгие ноты мелодии (от o.trem шагов) —
 * тремоло повторными щипками по шестнадцатым, каждый глушится следующим.
 */
function synthKoto(S, out, t, dur, midi, vel, o, sd) {
  playTone(S, out, t, 'koto', midi, vel, dur + 0.3, -40);
  if (!o.trem || dur < o.trem * sd) return;
  for (let tt = t + 2 * sd; tt < t + dur - sd * 0.5; tt += sd) {
    playTone(S, out, tt, 'koto', midi, vel * (0.4 + Math.random() * 0.1), sd * 1.5, 0);
  }
}

/** Стил-пэн: удар, а на долгих нотах (от o.roll шагов) — «ролл» частыми ударами по тридцать вторым. */
function synthPan(S, out, t, dur, midi, vel, o, sd) {
  playTone(S, out, t, 'pan', midi, vel, 0, 0);
  if (!o.roll || dur < o.roll * sd) return;
  const step = sd / 2;
  for (let tt = t + step * 2; tt < t + dur - step; tt += step) {
    playTone(S, out, tt, 'pan', midi, vel * (0.42 + Math.random() * 0.1), step * 1.6, 0);
  }
}

/**
 * Укулеле: бой по четырём струнам с разносом во времени. kind: x — вниз (снизу вверх),
 * u — вверх (три верхние струны, тише), m — глушёный «чк».
 */
function strumUke(S, out, t, notes, vel, kind, gate) {
  const strings = (notes.length < 4 ? notes.concat(notes[0] + 12) : notes.slice(0, 4)).sort((a, b) => a - b);
  const up = kind === 'u';
  const order = up ? strings.slice(1).reverse() : strings;
  const len = kind === 'm' ? 0.06 : gate;
  const v = vel * (up ? 0.7 : kind === 'm' ? 0.8 : 1);
  order.forEach((m, i) => playTone(S, out, t + i * (up ? 0.009 : 0.013), 'uke', m, v * (1 - i * 0.06), len, 0));
}

/**
 * Японская бамбуковая флейта (синобуэ / сякухати): треугольник + синус октавой выше, полоса
 * шума дыхания с «чиффом» на атаке, подъезд к ноте снизу или форшлаг сверху (у связных нот —
 * портаменто от предыдущей) и вибрато через detune, вступающее с задержкой.
 * bend — медленный подъезд снизу на bend центов (мери-кари сякухати, нота с «^» в мелодии).
 * o: { breath, scoop (полутона), grace (доля нот с форшлагом), slide (с), vibCents, vibRate, attack, release, cutoff, mix2, bendT }
 */
function synthFue(S, out, t, dur, midi, vel, o, glideFrom, bend) {
  const ctx = S.ctx;
  const f = mtof(midi);
  dur = Math.max(0.05, dur);
  const end = t + dur;
  const rel = o.release || 0.08;
  const stopAt = end + rel * 3 + 0.02;
  const a = osc(ctx, 'triangle', f, t);
  const b = osc(ctx, 'sine', f * 2, t);
  const bg = gainNode(ctx, o.mix2 || 0.2);
  const lp = biquad(ctx, 'lowpass', o.cutoff || 4500, 0.7);
  const g = gainNode(ctx, 0);
  a.connect(lp);
  b.connect(bg).connect(lp);
  lp.connect(g).connect(out);
  const nodes = [a, b, bg, lp, g];
  const grace = !glideFrom && !bend && dur > 0.2 && Math.random() < (o.grace || 0);
  for (const [ob, r] of [[a, 1], [b, 2]]) {
    const p = ob.frequency;
    if (glideFrom) {
      p.setValueAtTime(glideFrom * r, t);
      p.exponentialRampToValueAtTime(f * r, t + (o.slide || 0.05));
    } else if (bend) {
      p.setValueAtTime(f * r * Math.pow(2, -bend / 1200), t);
      p.setValueAtTime(f * r * Math.pow(2, -bend / 1200), t + 0.03);
      p.exponentialRampToValueAtTime(f * r, t + (o.bendT || 0.15));
    } else if (grace) {
      // форшлаг: палец на мгновение открывает отверстие — нота на тон выше
      p.setValueAtTime(f * r * 1.122, t);
      p.setValueAtTime(f * r * 1.122, t + 0.03);
      p.exponentialRampToValueAtTime(f * r, t + 0.042);
    } else if (dur > 0.2) {
      p.setValueAtTime(f * r * Math.pow(2, -(o.scoop || 1) / 12), t);
      p.exponentialRampToValueAtTime(f * r, t + 0.06);
    }
  }
  if (o.vibCents && dur > 0.25) {
    const lfo = osc(ctx, 'sine', o.vibRate || 5.5, t);
    const lg = gainNode(ctx, 0);
    lg.gain.setValueAtTime(0, t + 0.18);
    lg.gain.linearRampToValueAtTime(o.vibCents, t + Math.min(0.5, dur));
    lfo.connect(lg);
    lg.connect(a.detune);
    lg.connect(b.detune);
    lfo.start(t);
    lfo.stop(stopAt);
    nodes.push(lfo, lg);
  }
  const atk = o.attack || 0.035;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + atk);
  g.gain.setTargetAtTime(vel * 0.85, t + atk, 0.12);
  g.gain.setTargetAtTime(0, Math.max(end, t + atk + 0.001), rel / 3);
  if (o.breath) {
    const n = noiseSrc(S, t, dur + rel + 0.05);
    const bp = biquad(ctx, 'bandpass', Math.min(f * 2, 8000), 0.9);
    const ng = gainNode(ctx, 0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(vel * o.breath * 2, t + 0.015);
    ng.gain.setTargetAtTime(vel * o.breath * 0.5, t + 0.015, 0.04);
    ng.gain.setTargetAtTime(0, end, rel / 3);
    n.connect(bp).connect(ng).connect(out);
    releaseOnEnd(n, [n, bp, ng]);
  }
  a.start(t);
  b.start(t);
  a.stop(stopAt);
  b.stop(stopAt);
  releaseOnEnd(a, nodes);
}

// Расстройка пил суперсо относительно o.detune (центы)
const SAW_SPREAD = [-1, -0.45, 0, 0.5, 0.95];

/**
 * Суперсо — лид евробита: пять расстроенных пил (крайние разведены по стерео), яркий фильтр,
 * портаменто и вибрато через detune. Пилы стартуют с микросдвигом — без общего пика на атаке.
 * o: { detune, cutoff, q, vibCents, vibRate, attack, sustain, release }
 */
function synthSupersaw(S, out, t, dur, midi, vel, o, glideFrom) {
  const ctx = S.ctx;
  const f = mtof(midi);
  dur = Math.max(0.05, dur);
  const end = t + dur;
  const rel = o.release || 0.08;
  const stopAt = end + rel * 3 + 0.02;
  const lp = biquad(ctx, 'lowpass', o.cutoff * 1.6, o.q || 0.8);
  lp.frequency.setValueAtTime(o.cutoff * 1.6, t);
  lp.frequency.setTargetAtTime(o.cutoff, t, 0.12);
  const g = gainNode(ctx, 0);
  const pl = stereo(ctx, -0.6);
  const pr = stereo(ctx, 0.6);
  const nodes = [lp, g];
  if (pl) {
    pl.connect(lp);
    pr.connect(lp);
    nodes.push(pl, pr);
  }
  lp.connect(g).connect(out);
  let lg = null;
  if (o.vibCents && dur > 0.2) {
    const lfo = osc(ctx, 'sine', o.vibRate || 5.8, t);
    lg = gainNode(ctx, 0);
    lg.gain.setValueAtTime(0, t + 0.15);
    lg.gain.linearRampToValueAtTime(o.vibCents, t + Math.min(0.45, dur));
    lfo.connect(lg);
    lfo.start(t);
    lfo.stop(stopAt);
    nodes.push(lfo, lg);
  }
  const saws = SAW_SPREAD.map((k, i) => {
    const s = osc(ctx, 'sawtooth', f, t);
    s.detune.setValueAtTime(k * o.detune, t);
    if (glideFrom) {
      s.frequency.setValueAtTime(glideFrom, t);
      s.frequency.exponentialRampToValueAtTime(f, t + 0.045);
    }
    if (lg) lg.connect(s.detune);
    s.connect(i < 2 && pl ? pl : i > 2 && pr ? pr : lp);
    s.start(t + i * 0.0011);
    s.stop(stopAt);
    nodes.push(s);
    return s;
  });
  const atk = o.attack || 0.008;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + atk);
  g.gain.setTargetAtTime(vel * (o.sustain || 0.85), t + atk, 0.15);
  g.gain.setTargetAtTime(0, Math.max(end, t + atk + 0.001), rel / 3);
  releaseOnEnd(saws[0], nodes);
}

// ---------------------------------------------------------------------------
// Music themes (pure data)
//
// chords : one entry per bar, a symbol or [firstHalf, secondHalf]
// melody : one string per bar; 8 tokens = 8th notes, 16 tokens = 16ths.
//          'A5' note, '-' hold (ties across bars), '.' rest; 'A5^' — нота с подтяжкой снизу
//          (бенд гитары, мери сякухати) на lead.bend центов
// parts  : per-section 16-step patterns. form picks the section per bar;
//          'fill' replaces the drums on the last bar of every 8.
//   kick/snare: x = hit, o = ghost   hat: x accent, h soft, o open
//   bass: R root(slash bass), O octave, 5 fifth, '-' hold, '.' rest
//   chord/arp: x = hit
//   riff: как bass, но инструментом def.riff на def.riff.octave выше (сямисэн)
//   chord: у укулеле x — бой вниз, u — вверх, m — глушёный; у стабов o — оркестровый удар;
//          у электрогитары (kind из AMPS) x — открытый квинтаккорд звенит до следующего удара,
//          o — он же с акцентом, m — глушёный ладонью «чанк» (def.chord.mute)
//   taiko/ka/clack/kane/conga/bongo/ride: x удар, o тихий, l низкий барабан
//   gliss: x — глиссандо кото по ладу def.gliss вверх, d — вниз
//   altLead: true — мелодию секции играет def.altLead вместо def.lead
//   voice: 'имя' — мелодию секции играет голос def[имя] (вместо lead / altLead)
// extra  : layers added by setMusicIntensity(1) (plus lead doubled an octave up)
// lead.kind: fue (синобуэ), shaku (сякухати, тот же голос), supersaw, pan (стил-пэн), koto,
// shamisen, электрогитара из AMPS (glead — соло с бендами и вибрато vib/vibRate), иначе synthLead;
// lead.double — интервал дублирования мелодии на финальном круге (по умолчанию +12);
// lead.with — второй инструмент в унисон ({ kind, vel, shift — сдвиг в полутонах }, канал riff).
// kickKind / snareKind / hatKind — замена сэмпла бочки / малого / хэта (rkick; gsnare, rsnare; shaker).
// ---------------------------------------------------------------------------

const THEMES = {
  // Bright, relaxed city-pop / anime-opening intro (F major, maj7/9 colours).
  menu: {
    bpm: 118,
    swing: 0.08,
    form: 'AAAAAAAABBBBBBBB',
    padCenter: 63,
    bassLow: 36,
    chords: [
      'Fmaj7', 'Dm9', 'Gm7', 'C7sus4', 'Fmaj7', 'Dm9', 'Bbmaj7', 'C7sus4',
      'Bbmaj7', 'A7', 'Dm7', ['Cm7', 'F7'], 'Bbmaj7', 'A7', 'Dm7', ['Gm7', 'C7sus4'],
    ],
    melody: [
      'C6 - - A5 - G5 A5 -',
      '- - - - . . A5 C6',
      'Bb5 - - A5 - G5 F5 -',
      'G5 - - - - - . .',
      'C6 - - A5 - G5 A5 -',
      '- - - D6 - C6 A5 -',
      'F5 - - A5 - C6 - D6',
      '- - - C6 - - . .',
      'D6 - - - C6 - A5 -',
      'C#6 - - - A5 - G5 -',
      'F5 - - - A5 - C6 -',
      'Bb5 - G5 - A5 - C6 -',
      'D6 - - - C6 - A5 -',
      'C#6 - - E6 - - C#6 -',
      'D6 - - C6 - A5 - F5',
      'F5 - G5 - Bb5 - - -',
    ],
    lead: { wave: 'triangle', wave2: 'square', mix2: 0.16, cutoff: 2600, vibrato: 0.009, vibRate: 5.2, attack: 0.02, sustain: 0.85, release: 0.12, breath: 0.05, vel: 0.2, glide: true },
    bass: { kind: 'funk', vel: 0.42, gate: 0.8 },
    pad: { vel: 0.022, attack: 0.35, release: 0.6, cut0: 700, cut1: 1500, cutTc: 0.5, detune: 10, sustain: 1 },
    chord: { kind: 'ep', vel: 0.055 },
    arp: { kind: 'bell', vel: 0.03, decay: 0.55, partials: 3, octave: 12, seq: [0, 1, 2, 3, 4, 3, 2, 1] },
    mix: { lead: { d: 0.3, r: 0.28 }, arp: { d: 0.35, r: 0.3 }, chord: { d: 0.05, r: 0.22 } },
    parts: {
      A: {
        kick: 'x......x..x.....',
        snare: '....x.......x...',
        hat: 'h.h.h.h.h.h.h.o.',
        bass: 'R-.R..O.R-..5.O.',
        chord: 'x.....x...x.....',
        arp: 'x.x.x.x.x.x.x.x.',
        pad: true,
      },
      B: {
        kick: 'x......x..x..x..',
        snare: '....x.......x...',
        clap: '............x...',
        hat: 'h.hhh.hhh.hhh.o.',
        bass: 'R-.R..O.R-.R.5O.',
        chord: 'x..x..x...x..x..',
        arp: 'x.x.x.x.x.x.x.x.',
        pad: true,
      },
      fill: {
        kick: 'x......x..x.....',
        snare: '....x.......x.xx',
        hat: 'h.h.h.h.h.h.....',
        tom: '........x.x.....',
      },
    },
    extra: { hat: '..h...h...h...h.' },
  },

  // «Сакура-Долина» — вафу-поп-рок, 152 BPM, ля минор с японским ладом ин (A–B–C–E–F,
  // мияко-буси от ми). A: кото ведёт мотив народной «Сакура-сакура» под тайко и рифф сямисэна;
  // B: куплет синобуэ, кото арпеджирует, атаригане на долях; C: припев на «королевской дороге»
  // IV–V–iii–vi с праздничным «тян-тики». Каждые 8 тактов — сбивка: дробь тайко, «тён-тён»
  // хёсиги и глиссандо кото по ладу. Кадансы на Esus4 — ладовое «фа → ми».
  sakura: {
    bpm: 152,
    swing: 0,
    form: 'AAAAAAAABBBBBBBBCCCCCCCC',
    padCenter: 62,
    bassLow: 33,
    chords: [
      'Am', 'G', 'C', 'Dm', 'Fmaj7', 'G', 'Dm7', 'Esus4',
      'Am', 'F', 'G', 'Em7', 'Am', 'F', 'G', 'Esus4',
      'F', 'G', 'Em7', 'Am', 'F', 'G', 'Dm7', 'Esus4',
    ],
    melody: [
      'A4 - A4 - B4 - - -',
      'A4 - A4 - B4 - - -',
      'A4 - B4 - C5 - B4 -',
      'A4 - B4 A4 F4 - - -',
      'E4 - C4 - E4 - F4 -',
      'E4 - E4 C4 B3 - - -',
      'E4 - F4 - B4 A4 F4 -',
      'E4 - - - - - . .',
      'E5 - A5 - B5 - C6 B5',
      'A5 - - - F5 - E5 -',
      'D5 - E5 - G5 - A5 B5',
      'B5 - - - - - . .',
      'E5 - A5 - B5 - C6 E6',
      'F6 - E6 - C6 - A5 -',
      'B5 - D6 - B5 A5 G5 -',
      'A5 - B5 - E5 - - -',
      'A5 - C6 - E6 - - F6',
      'E6 - D6 - B5 - - -',
      'B5 - A5 - G5 - E5 -',
      'A5 - - - - - C6 B5',
      'A5 - C6 - E6 - F6 E6',
      'D6 - - B5 - - G5 A5',
      'F5 - A5 - C6 - B5 A5',
      'F5 E5 - - - - . .',
    ],
    lead: { kind: 'fue', vel: 0.22, breath: 0.3, scoop: 1, grace: 0.3, slide: 0.05, vibCents: 22, vibRate: 5.6, attack: 0.035, release: 0.08, cutoff: 5000, mix2: 0.22, glide: true, double: -12 },
    altLead: { kind: 'koto', vel: 0.85, trem: 6, double: -12 },
    bass: { kind: 'saw', vel: 0.44, gate: 0.8 },
    pad: { vel: 0.018, attack: 0.1, release: 0.4, cut0: 800, cut1: 1700, cutTc: 0.3, detune: 10, sustain: 1 },
    riff: { kind: 'shamisen', vel: 0.55, octave: 24, gate: 0.9 },
    arp: { kind: 'koto', vel: 0.26, octave: 12, seq: [0, 2, 1, 3, 2, 4, 3, 5] },
    gliss: { scale: 'A B C E F', from: 'E4', to: 'E6', vel: 0.3 },
    mix: { lead: { d: 0.2, r: 0.3 }, arp: { d: 0.18, r: 0.2 }, perc: { g: 0.25, r: 0.25 } },
    parts: {
      A: {
        kick: 'x.......x.x.....',
        snare: '....x.......x...',
        hat: 'x.h.x.h.x.h.x.h.',
        taiko: 'x.........x.....',
        ka: '......x.......x.',
        bass: 'R.R.R.R.R.R.R.O.',
        riff: 'R..R..R.O..R..5.',
        pad: true,
        altLead: true,
      },
      B: {
        kick: 'x.....x.x.......',
        snare: '....x.......x...',
        hat: 'x.hhx.hhx.hhx.hh',
        kane: 'o...o...o...o...',
        bass: 'R.R.R.RRR.R.R.OR',
        riff: 'R.RO.RO.R.RO.R5O',
        arp: 'x.x.x.x.x.x.x.x.',
        pad: true,
      },
      C: {
        kick: 'x...x...x...x...',
        snare: '....x.......x...',
        hat: 'h.o.h.o.h.o.h.o.',
        taiko: 'x.......x.......',
        kane: 'x.oox.oox.oox.oo',
        bass: 'R.R.O.R.R.R.O.R.',
        riff: 'R.RO.RO.R.RO.R5O',
        arp: 'x.x.x.x.x.x.x.x.',
        pad: true,
      },
      fill: {
        kick: 'x.......x.......',
        snare: '....x...........',
        hat: 'x.h.x.h.........',
        taiko: 'x.....x.x.x.xxxx',
        ka: '..x..x..........',
        clack: '............x.x.',
        gliss: '........x.......',
      },
    },
    extra: { hat: 'xhhhxhhhxhhhxhhh', ka: '..x...x...x...x.' },
  },

  // «Неон-Токио» — классический евробит (как в Initial D), 155 BPM, ре минор: октавный бас
  // с верхней нотой на слабых долях, суперсо-лид из пяти пил, медные стабы с «подъездом»
  // и оркестровые удары, арпеджио шестнадцатыми, гейтированный клэп-снейр, тарелка в начале
  // каждой секции и «насос» сайдчейна от бочки. Куплет i–VI–VII–i, предприпев iv–V,
  // драматичный припев VI–VII–v–i с доминантой A7 перед повтором.
  neon: {
    bpm: 155,
    swing: 0,
    form: 'AAAAAAAABBBBBBBBCCCCCCCC',
    padCenter: 62,
    bassLow: 33,
    pump: 0.5,
    snareKind: 'gsnare',
    chords: [
      'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'C', 'A7',
      'Gm', 'A', 'Dm', 'Bb', 'Gm', 'A', 'Bb', ['C', 'A7'],
      'Bb', 'C', 'Am', 'Dm', 'Bb', 'C', 'Asus4', 'A7',
    ],
    melody: [
      'D5 - F5 - A5 - D6 -',
      'C6 - Bb5 - A5 - F5 -',
      'G5 - - E5 - G5 C6 -',
      'A5 - - - - - . .',
      'D5 - F5 - A5 - D6 E6',
      'F6 - D6 - C6 - Bb5 -',
      'C6 - - D6 - - E6 -',
      'E6 - C#6 - A5 - . .',
      'D5 - G5 - Bb5 - A5 G5',
      'A5 - - - C#6 - E6 -',
      'D6 - C6 - A5 - F5 -',
      'F5 - - - D5 - . .',
      'D5 - G5 - Bb5 - D6 -',
      'E6 - - - C#6 - A5 -',
      'D6 - - - F6 - D6 -',
      'E6 - - - E6 - C#6 -',
      'D6 - - - F6 - D6 -',
      'E6 - - - G6 - E6 -',
      'E6 - - - D6 - - - C6 - B5 - A5 - - -',
      'A5 - - - - - D6 E6',
      'F6 - - - D6 - F6 -',
      'G6 - - - E6 - C6 -',
      'D6 - - - E6 - D6 -',
      'C#6 - - - E6 - . .',
    ],
    lead: { kind: 'supersaw', vel: 0.11, detune: 24, cutoff: 5200, q: 0.9, vibCents: 16, vibRate: 5.8, attack: 0.008, sustain: 0.85, release: 0.1, glide: true, double: -12 },
    bass: { kind: 'pluck', vel: 0.46, gate: 0.7 },
    pad: { vel: 0.024, attack: 0.12, release: 0.4, cut0: 1200, cut1: 3000, cutTc: 0.4, detune: 16, sustain: 1 },
    chord: { kind: 'brass', vel: 0.05, attack: 0.014, release: 0.14, cut0: 5500, cut1: 1500, cutTc: 0.09, detune: 12, sustain: 0.7, maxGate: 0.2, swell: 700, scoop: 45 },
    arp: { kind: 'pluck', wave: 'sawtooth', vel: 0.065, decay: 0.06, bright: 4500, octave: 12, seq: [0, 1, 2, 3, 4, 5, 4, 3] },
    mix: { lead: { d: 0.25, r: 0.2 }, arp: { d: 0.3, r: 0.12 }, chord: { d: 0.1, r: 0.22 } },
    parts: {
      A: {
        kick: 'x...x...x...x...',
        snare: '....x.......x...',
        hat: '..o...o...o...o.',
        bass: 'R.O.R.O.R.O.R.O.',
        chord: '..........x..x..',
        arp: 'xxxxxxxxxxxxxxxx',
      },
      B: {
        kick: 'x...x...x...x...',
        snare: '....x.......x...',
        hat: 'hhohhhohhhohhhoh',
        bass: 'R.O.R.O.R.O.R.O.',
        chord: 'x..x..x...x..x..',
        arp: 'xxxxxxxxxxxxxxxx',
        pad: true,
      },
      C: {
        kick: 'x...x...x...x...',
        snare: '....x.......x...',
        hat: 'hhohhhohhhohhhoh',
        bass: 'R.O.R.O.R.O.R.O.',
        chord: 'o.....x.......x.',
        arp: 'xxxxxxxxxxxxxxxx',
        pad: true,
      },
      fill: {
        kick: 'x...x...x...x...',
        snare: '....x...x.x.xxxx',
        hat: 'h.o.h.o.........',
      },
    },
    extra: { hat: 'xhhhxhhhxhhhxhhh' },
  },

  // «Закатный Берег» — тропический грув, 114 BPM, фа мажор, лёгкий свинг. Мелодия — стил-пэн
  // с «роллами» на долгих нотах, укулеле бьёт офф-биты (в припеве — калипсо-бой «вниз,
  // вниз-вверх, вверх-вниз-вверх»), маримба, шейкер, конги и бонго, тёплый пэд и суб-бас.
  // Куплет I–vi–ii–V, припев IV–I–V–vi, бридж vi–IV–I–V с бочкой-тресильо (3-3-2).
  sunset: {
    bpm: 114,
    swing: 0.1,
    form: 'AAAAAAAABBBBBBBBCCCCCCCC',
    padCenter: 63,
    bassLow: 34,
    pump: 0.3,
    hatKind: 'shaker',
    chords: [
      'Fmaj7', 'Dm7', 'Gm7', 'C7', 'Fmaj7', 'Dm7', 'Gm7', ['C7sus4', 'C7'],
      'Bbmaj7', 'F', 'C', 'Dm7', 'Bbmaj7', 'F', 'Gm7', 'C7',
      'Dm7', 'Bbmaj7', 'F', 'C', 'Dm7', 'Bbmaj7', 'Gm7', ['C7sus4', 'C7'],
    ],
    melody: [
      '. C5 F5 A5 - G5 A5 -',
      'C6 - - A5 - F5 - -',
      '. Bb5 A5 G5 - F5 G5 -',
      'E5 - - - - - . .',
      '. C5 F5 A5 - G5 A5 -',
      'D6 - - C6 - A5 - F5',
      'G5 - Bb5 - D6 - C6 Bb5',
      'F5 - G5 - - - . .',
      'D6 - - D6 - C6 D6 -',
      'C6 - A5 - - - . F5',
      'G5 - - G5 - E5 G5 -',
      'A5 - - - - - . .',
      'D6 - - D6 - C6 D6 -',
      'F6 - - E6 - C6 - A5',
      'Bb5 - A5 - G5 - F5 -',
      'G5 - - - E5 - . .',
      'A5 - F5 - A5 - C6 -',
      'D6 - - - C6 - Bb5 -',
      'A5 - C6 - F6 - E6 -',
      'E6 - - - D6 - C6 -',
      'D6 - - C6 - A5 - F5',
      'F5 - - D5 - F5 - A5',
      'Bb5 - - A5 - G5 - F5',
      'G5 - - - - - . .',
    ],
    lead: { kind: 'pan', vel: 0.38, roll: 6, double: -12 },
    bass: { kind: 'sub', vel: 0.5, gate: 0.9 },
    pad: { vel: 0.02, attack: 0.3, release: 0.5, cut0: 600, cut1: 1400, cutTc: 0.4, detune: 9, sustain: 1 },
    chord: { kind: 'uke', vel: 0.24, maxGate: 0.35 },
    arp: { kind: 'marimba', vel: 0.05, decay: 0.12, seq: [0, 1, 2, 3, 4, 3, 2, 1] },
    mix: { lead: { d: 0.28, r: 0.25 }, chord: { d: 0.08, r: 0.15 }, arp: { d: 0.2, r: 0.2 }, perc: { g: 0.25, r: 0.15 } },
    parts: {
      A: {
        kick: 'x.......x.......',
        clap: '....x.......x...',
        hat: 'x.hhx.hhx.hhx.hh',
        conga: 'o...x...o...x.xl',
        bass: 'R-.R..5.R-.R..O.',
        chord: '..x...x...x...x.',
        pad: true,
      },
      B: {
        kick: 'x...x...x...x...',
        clap: '....x.......x...',
        hat: 'xhhhxhhhxhhhxhhh',
        conga: 'o...x...o...x.xl',
        bongo: 'x.o.x.o.x.o.x.o.',
        bass: 'R-.R..5.R-.R..O.',
        chord: 'x...x.u...u.x.u.',
        arp: 'x.x.x.x.x.x.x.x.',
        pad: true,
      },
      C: {
        kick: 'x..x..x.x..x..x.',
        clap: '....x.......x...',
        hat: 'x.hhx.hhx.hhx.hh',
        conga: 'o.x.x.l.o.x.x.l.',
        bongo: '..x...x...x...x.',
        bass: 'R..R..R.R..R..O.',
        chord: '..x.m.x...x.m.x.',
        arp: 'x.xx.xx.x.xx.xx.',
        pad: true,
      },
      fill: {
        kick: 'x...x...x...x...',
        clap: '....x.......x...',
        hat: 'x.hhx.hhx.......',
        conga: '........x.xlx.ll',
        bongo: '........xx.x....',
      },
    },
    extra: { hat: 'hhxhhhxhhhxhhhxh', bongo: '..o...o...o...o.', arp: 'x.xxx.xxx.xxx.xx' },
  },

  // «Кленовый Перевал» — японский рок в духе аниме-опенингов и «вагакки-бэнда», 168 BPM, ми минор
  // с японским ладом ин (E–F–A–B–C) в мелодиях. Каркас — перегруженные гитары двумя дублями L/R
  // и бас-гитара восьмыми. A/H: рифф сямисэна в унисон с гитарой октавой ниже (во второй
  // четвёрке — глушёные «чанки» и тайко); B: куплет сякухати под глушёные восьмые;
  // C: предприпев по квинтовому кругу Am7–D–Gmaj7–Cmaj7 и iv–V–i с открытыми аккордами на
  // «3+3+2», райдом и тайко; D: припев — соло-гитара с бендами и вибрато на андалусском ходе
  // Em–D–C–B7, открытые аккорды восьмыми. Тарелка в начале каждой секции, сбивка — томы и тайко.
  momiji: {
    bpm: 168,
    swing: 0,
    form: 'AAAAHHHHBBBBBBBBCCCCCCCCDDDDDDDD',
    padCenter: 64,
    bassLow: 28,
    kickKind: 'rkick',
    snareKind: 'rsnare',
    chords: [
      'Em', 'Em', ['C', 'D'], 'Em', 'Em', 'Em', ['C', 'D'], 'B7',
      'Em', 'Em', 'Cmaj7', 'D', 'Em', 'Em', 'Am7', ['Bsus4', 'B7'],
      'Am7', 'D', 'Gmaj7', 'Cmaj7', 'Am7', 'B7', 'Em', ['C', 'D'],
      'Em', 'D', 'C', 'B7', 'Em', 'D', 'C', 'B7',
    ],
    melody: [
      'E4 F4 A4 B4 C5 - B4 A4 B4 - E5 - D5 - B4 -',
      'A4 - B4 - C5 B4 A4 F4 E4 - - - . . . .',
      'E5 - C5 - G4 - C5 - F#5 - D5 - A4 - D5 -',
      'E5 - B4 - G4 - B4 - E5 - F5 - E5 - . .',
      'E4 F4 A4 B4 C5 - B4 A4 B4 - E5 - D5 - B4 -',
      'A4 - B4 - C5 B4 A4 F4 E4 - - - . . . .',
      'E5 - C5 - G4 - C5 - F#5 - D5 - A4 - D5 -',
      'D#5 - B4 - F#4 - B4 - A4 - F#4 - D#4 - B3 -',
      'B4 - E5 - F5 E5 G5 -',
      'A5 - - - G5 F5 E5 -',
      'G5 - - - E5 - D5 E5',
      'F#5^ - - - - - . .',
      'B4 - E5 - F5 E5 G5 -',
      'B5 - - - C6 B5 A5 -',
      'C6^ - - - B5 - A5 -',
      'B5 - - - F#5 - A5 -',
      'E5 - A5 - C6 - - B5',
      'A5 - - - F#5 - D5 -',
      'D5 - G5 - B5 - - A5',
      'G5 - - - E5^ - - -',
      'C5 - E5 - A5 - - G5',
      'F#5 - - - A5 - C6 B5',
      'B5^ - - - - - . .',
      'E5 - G5 - A5 - B5 -',
      'B4 - E5 - G5 - B5^ -',
      '- - A5 - - - F#5 -',
      'G5 - - - E5 - C6 -',
      'B5 - - - - - - -',
      'B4 - E5 - G5 - E6^ -',
      '- - D6 - - - A5 -',
      'C6 - - - B5 - G5 -',
      'F#5 - - - A5 - B5 -',
    ],
    lead: { kind: 'shaku', vel: 0.19, breath: 0.42, scoop: 1, grace: 0.12, slide: 0.07, vibCents: 28, vibRate: 4.9, attack: 0.05, release: 0.14, cutoff: 3800, mix2: 0.14, glide: true, bend: 100, bendT: 0.18, double: -12 },
    hook: { kind: 'shamisen', vel: 0.8, double: 12, with: { kind: 'griff', vel: 0.17, shift: -12 } },
    solo: { kind: 'glead', vel: 0.57, vib: 26, vibRate: 5.7, bend: 200, bendT: 0.11, double: -12 },
    bass: { kind: 'gbass', vel: 0.69, gate: 0.85 },
    pad: { vel: 0.01, attack: 0.5, release: 0.7, cut0: 1600, cut1: 2600, cutTc: 0.6, detune: 12, sustain: 1 },
    chord: { kind: 'gtr', mute: 'gmute', low: 40, vel: 0.41 },
    mix: { kick: { g: 0.37 }, lead: { d: 0.22, r: 0.24 }, lead2: { d: 0.15, r: 0.2 }, riff: { d: 0.06, r: 0.08 }, chord: { d: 0, r: 0.07 }, bass: { g: 0.75 }, perc: { g: 0.27, r: 0.14 }, snare: { g: 0.58, r: 0.16 } },
    parts: {
      A: {
        kick: 'x.....x.x.......',
        snare: '....x.......x...',
        hat: 'x.h.x.h.x.h.x.h.',
        taiko: 'x...............',
        bass: 'R.R.R.R.R.R.R.R.',
        voice: 'hook',
      },
      H: {
        kick: 'x.....x.x.....x.',
        snare: '....x.......x...',
        hat: 'x.h.x.h.x.h.x.h.',
        taiko: 'x.......x.......',
        bass: 'R.R.R.R.R.R.O.R.',
        chord: 'm.m.m.m.m.m.m.m.',
        voice: 'hook',
      },
      B: {
        kick: 'x.......x.x.....',
        snare: '....x.......x...',
        hat: 'x.h.x.h.x.h.x.h.',
        bass: 'R.R.R.R.R.R.R.RR',
        chord: 'x.m.m.m.m.m.m.mm',
      },
      C: {
        kick: 'x.....x.....x...',
        snare: '........x.......',
        ride: 'x.o.x.o.x.o.x.o.',
        taiko: 'x.....x.....x...',
        bass: 'R-----R-----R-O-',
        chord: 'x.....x.....x...',
        pad: true,
      },
      D: {
        kick: 'x.....x.x.....x.',
        snare: '....x.......x...',
        ride: 'x.o.x.o.x.o.x.o.',
        taiko: 'x...............',
        bass: 'R.R.O.R.R.R.O.R.',
        chord: 'x.x.x.x.x.x.x.x.',
        voice: 'solo',
      },
      fill: {
        kick: 'x.......x.......',
        snare: '....x.......xxxx',
        hat: 'x.h.x.h.........',
        tom: '......x.x.x.....',
        taiko: 'x.......x.....x.',
      },
    },
    extra: { hat: '.h.h.h.h.h.h.h.h', taiko: '......o.......o.' },
  },

  // Short, loopable victory-lap disco groove (C major).
  results: {
    bpm: 124,
    swing: 0,
    form: 'AAAABBBB',
    padCenter: 64,
    bassLow: 36,
    chords: ['Cadd9', 'Am7', 'Dm7', 'G7', 'Cadd9', 'Am7', 'Fmaj7', ['G7sus4', 'G7']],
    melody: [
      'E5 - G5 - C6 - B5 C6',
      '- - A5 - G5 - E5 -',
      'F5 - A5 - D6 - C6 D6',
      '- - B5 - G5 - . .',
      'E6 - - D6 C6 - G5 -',
      'A5 - - G5 - E5 - -',
      'F5 - A5 - C6 - E6 -',
      'D6 - - C6 B5 - G5 -',
    ],
    lead: { wave: 'square', wave2: 'square', detune: 10, mix2: 0.5, cutoff: 3400, vibrato: 0.01, vibRate: 5.6, sustain: 0.75, release: 0.06, vel: 0.1, glide: true },
    bass: { kind: 'funk', vel: 0.42, gate: 0.75 },
    pad: { vel: 0.022, attack: 0.1, release: 0.4, cut0: 900, cut1: 2000, cutTc: 0.3, detune: 11, sustain: 1 },
    chord: { kind: 'stab', vel: 0.05, attack: 0.006, release: 0.1, cut0: 3000, cut1: 1100, cutTc: 0.07, detune: 10, sustain: 0.7, maxGate: 0.14 },
    arp: { kind: 'bell', vel: 0.028, decay: 0.4, partials: 3, octave: 12, seq: [0, 1, 2, 3, 4, 5, 4, 3] },
    mix: { lead: { d: 0.25, r: 0.2 } },
    parts: {
      A: {
        kick: 'x...x...x...x...',
        clap: '....x.......x...',
        hat: 'h.o.h.o.h.o.h.o.',
        bass: 'R..R..O.R.R..5O.',
        chord: '..x...x...x...x.',
      },
      B: {
        kick: 'x...x...x...x...',
        snare: '....x.......x...',
        clap: '....x.......x...',
        hat: 'hhohhhohhhohhhoh',
        bass: 'R..R..O.R.R..5O.',
        chord: '..x..x..x.x...x.',
        arp: 'x.x.x.x.x.x.x.x.',
        pad: true,
      },
      fill: {
        kick: 'x...x...x...x...',
        snare: '....x...x.x.xxxx',
        hat: 'h.o.h.o.h.o.....',
      },
    },
    extra: { hat: 'xhhhxhhhxhhhxhhh' },
  },
};

// ---------------------------------------------------------------------------
// Theme compilation (done once per theme, cached)
// ---------------------------------------------------------------------------

function parseMelody(bars) {
  const map = new Map();
  let last = null;
  let pos = 0;
  for (const bar of bars) {
    const toks = bar.trim().split(/\s+/);
    const stepLen = 16 / toks.length;
    for (const tok of toks) {
      if (tok === '-') {
        if (last) last.len += stepLen;
      } else {
        const bend = tok.endsWith('^');
        const m = tok === '.' ? null : parseNote(bend ? tok.slice(0, -1) : tok);
        if (m !== null) {
          last = { step: Math.round(pos), len: stepLen, midi: m };
          if (bend) last.bend = true;
          map.set(last.step, last);
        } else last = null;
      }
      pos += stepLen;
    }
  }
  return map;
}

function parseBassPattern(str) {
  const out = new Array(16).fill(null);
  for (let s = 0; s < 16; s++) {
    const c = str[s];
    if (c === 'R' || c === 'O' || c === '5') {
      let len = 1;
      while (s + len < 16 && str[s + len] === '-') len++;
      out[s] = { kind: c, len };
    }
  }
  return out;
}

/** For each hit, the number of steps until the next hit (legato comping). */
function gatesFor(str) {
  const out = new Array(16).fill(0);
  for (let s = 0; s < 16; s++) {
    if (str[s] === '.') continue;
    let d = 1;
    while (d < 16 && str[(s + d) % 16] === '.') d++;
    out[s] = d;
  }
  return out;
}

function compilePart(p) {
  const r = Object.assign({}, p);
  if (p.bass) r.bassSeq = parseBassPattern(p.bass);
  if (p.riff) r.riffSeq = parseBassPattern(p.riff);
  if (p.chord) r.chordGates = gatesFor(p.chord);
  return r;
}

/** Нота шаблона bass/riff для аккорда h: R — бас аккорда, O — октавой выше, 5 — квинта. */
function patNote(kind, h) {
  let m = h.bass;
  if (kind === 'O') m += 12;
  else if (kind === '5') {
    m = h.root + 7;
    if (m - h.bass > 12) m -= 12;
  }
  return m;
}

/** Голос мелодии секции: part.voice (ключ def), altLead или lead. */
const leadOf = (def, part) => (part.voice && def[part.voice]) || (part.altLead && def.altLead) || def.lead;

/**
 * Тоны [инструмент, нота, первый шаг, первый шаг с финальным кругом], которые понадобятся теме,
 * в порядке первого звучания: плеер греет их заранее, кусками (MusicPlayer.warmUp). Тоны только
 * финального круга (дубль мелодии, партии extra) и слоёв, которых нет в партиях секций, — в конце.
 */
function themeTones(th) {
  const def = th.def;
  const keys = new Map();
  const add = (kind, m, first, firstI) => {
    if (!isTone(kind)) return;
    const e = keys.get(kind + m);
    if (!e) keys.set(kind + m, [kind, m, first, firstI]);
    else {
      e[2] = Math.min(e[2], first);
      e[3] = Math.min(e[3], firstI);
    }
  };
  const NEVER = Infinity;
  for (const [step, ev] of th.melody) {
    const L = leadOf(def, th.parts[def.form[step >> 4]]);
    add(L.kind, ev.midi, step, step);
    add(L.kind, ev.midi + (L.double || 12), NEVER, step);
    if (L.with) add(L.with.kind, ev.midi + (L.with.shift || 0), step, step);
  }
  th.harm.forEach((hb, bar) => {
    const part = th.parts[def.form[bar]];
    for (const h of hb) {
      const at = bar * 16 + h.from;
      if (def.arp) {
        const on = part.arp ? at : NEVER;
        for (const i of def.arp.seq) add(def.arp.kind, h.ext[i % h.ext.length], on, on === NEVER && th.extra.arp ? at : on);
      }
      if (def.riff) for (const k of 'RO5') add(def.riff.kind, patNote(k, h) + def.riff.octave, part.riffSeq ? at : NEVER, part.riffSeq ? at : NEVER);
      if (def.chord && AMPS[def.chord.kind]) {
        // электрогитара: открытый и глушёный квинтаккорд от основного тона аккорда
        const m = lowestAbove(h.root % 12, def.chord.low);
        const pat = part.chord || '';
        if (/[xo]/.test(pat)) add(def.chord.kind, m, at, at);
        if (pat.includes('m')) add(def.chord.mute, m, at, at);
      } else if (def.chord) {
        const on = part.chord ? at : NEVER;
        for (const m of h.chordNotes.length < 4 ? h.chordNotes.concat(h.chordNotes[0] + 12) : h.chordNotes) add(def.chord.kind, m, on, on);
      }
      if (part.bassSeq && def.bass && isTone(def.bass.kind)) for (const b of part.bassSeq) if (b) add(def.bass.kind, patNote(b.kind, h), at, at);
    }
  });
  if (th.gliss) {
    const g = (th.parts.fill && th.parts.fill.gliss) || '';
    const at = 7 * 16 + Math.max(0, g.search(/[xd]/));
    for (const m of th.gliss) add('koto', m, at, at);
  }
  return [...keys.values()].sort((a, b) => a[2] - b[2]);
}

/** Ноты лада g.scale ('A B C E F') от g.from до g.to — пробег для глиссандо. */
function scaleRun(g) {
  const pcs = g.scale.split(' ').map((n) => parseChord(n).root);
  const out = [];
  for (let m = parseNote(g.from); m <= parseNote(g.to); m++) if (pcs.includes(m % 12)) out.push(m);
  return out;
}

const compiledThemes = new Map();

function compileTheme(name) {
  const cached = compiledThemes.get(name);
  if (cached) return cached;
  const def = THEMES[name];
  const bars = def.form.length;
  const arpOff = def.arp && def.arp.octave ? def.arp.octave : 0;
  const chordOff = def.chord && def.chord.octave ? def.chord.octave : 0;
  const harm = [];
  for (let b = 0; b < bars; b++) {
    const c = def.chords[b % def.chords.length];
    const list = Array.isArray(c) ? c : [c];
    const len = 16 / list.length;
    harm.push(
      list.map((sym, i) => {
        const ch = parseChord(sym);
        const voicing = voiceChord(ch, def.padCenter, 4);
        return {
          from: i * len,
          len,
          sym,
          voicing,
          chordNotes: voicing.map((n) => n + chordOff),
          ext: voicing.concat(voicing.map((n) => n + 12)).map((n) => n + arpOff),
          bass: lowestAbove(ch.bass, def.bassLow),
          root: lowestAbove(ch.root, def.bassLow),
        };
      })
    );
  }
  const parts = {};
  for (const k of Object.keys(def.parts)) parts[k] = compilePart(def.parts[k]);
  const out = {
    name,
    def,
    bars,
    totalSteps: bars * 16,
    harm,
    melody: parseMelody(def.melody),
    parts,
    extra: compilePart(def.extra || {}),
    gliss: def.gliss ? scaleRun(def.gliss) : null,
  };
  out.tones = themeTones(out);
  compiledThemes.set(name, out);
  return out;
}

// Mixer channels of a theme player: g = level, d = delay send, r = reverb send, hp = optional high-pass
const CHANNELS = {
  kick: { g: 0.5, d: 0, r: 0 },
  snare: { g: 0.85, d: 0, r: 0.12 },
  clap: { g: 0.8, d: 0, r: 0.16 },
  hat: { g: 0.3, d: 0, r: 0.04 },
  perc: { g: 0.35, d: 0, r: 0.2 },
  bass: { g: 0.7, d: 0, r: 0 },
  pad: { g: 1, d: 0, r: 0.35 },
  chord: { g: 1, d: 0.08, r: 0.18 },
  arp: { g: 1.2, d: 0.28, r: 0.18 },
  lead: { g: 1.25, d: 0.24, r: 0.2 },
  lead2: { g: 1.25, d: 0.18, r: 0.2 },
  riff: { g: 1, d: 0.12, r: 0.15 },
};
const PUMPED = ['pad', 'chord', 'arp'];
const HAT_VEL = { x: 1, h: 0.55, o: 0.75 };
// Символы партий перкуссии → [громкость, скорость воспроизведения сэмпла]
const PERC_HIT = { x: [1, 1], o: [0.45, 1], l: [0.9, 0.75] };

// ---------------------------------------------------------------------------
// MusicPlayer: one playing theme (its own mixer, delay and fader)
// ---------------------------------------------------------------------------

class MusicPlayer {
  constructor(mgr, theme, startTime) {
    const ctx = mgr.ctx;
    const def = theme.def;
    this.mgr = mgr;
    this.ctx = ctx;
    this.S = mgr.S;
    this.th = theme;
    this.def = def;
    this.name = theme.name;

    this.fade = gainNode(ctx, 0);
    this.fade.connect(mgr.musicIn);
    this.revFade = gainNode(ctx, 0);
    this.revFade.connect(mgr.reverbIn);
    const nodes = (this.nodes = [this.fade, this.revFade]);

    // Tempo-synced ping-pong delay with a filtered feedback loop.
    const dIn = gainNode(ctx, 1);
    const dHp = biquad(ctx, 'highpass', 320, 0.7);
    const dl = ctx.createDelay(2);
    const dr = ctx.createDelay(2);
    const dLp = biquad(ctx, 'lowpass', 3000, 0.7);
    const fb = gainNode(ctx, def.delayFb || 0.34);
    const wet = gainNode(ctx, 0.55);
    const pl = stereo(ctx, -0.75);
    const pr = stereo(ctx, 0.75);
    dIn.connect(dHp).connect(dl);
    dl.connect(dr);
    dr.connect(dLp).connect(fb).connect(dl);
    if (pl) {
      dl.connect(pl).connect(wet);
      dr.connect(pr).connect(wet);
      nodes.push(pl, pr);
    } else {
      dl.connect(wet);
      dr.connect(wet);
    }
    wet.connect(this.fade);
    nodes.push(dIn, dHp, dl, dr, dLp, fb, wet);
    this.delayL = dl;
    this.delayR = dr;

    this.ch = {};
    for (const name of Object.keys(CHANNELS)) {
      const cfg = Object.assign({}, CHANNELS[name], (def.mix && def.mix[name]) || {});
      const g = gainNode(ctx, cfg.g);
      let head = g;
      if (cfg.hp) {
        head = biquad(ctx, 'highpass', cfg.hp, 0.7);
        g.connect(head);
        nodes.push(head);
      }
      head.connect(this.fade);
      if (cfg.d > 0) {
        const s = gainNode(ctx, cfg.d);
        head.connect(s).connect(dIn);
        nodes.push(s);
      }
      if (cfg.r > 0) {
        const s = gainNode(ctx, cfg.r);
        head.connect(s).connect(this.revFade);
        nodes.push(s);
      }
      nodes.push(g);
      this.ch[name] = { input: g, level: cfg.g };
    }

    this.step = 0;
    this.nextTime = startTime;
    this.intensity = mgr._intensity;
    this._applyTempo();
    const dt = this.stepDur * (def.delaySteps || 3);
    dl.delayTime.value = dt;
    dr.delayTime.value = dt;
    this.stopTime = Infinity;
    this.lastLead = null;
    // очередь прогрева: ещё не готовые тоны темы в порядке первого звучания (с финальным кругом — свой порядок)
    const S = this.S;
    this.pr = this.intensity ? 3 : 2;
    this.warm = theme.tones.filter((e) => !S.tones.has(e[0] + e[1]));
    if (this.intensity) this.warm.sort((a, b) => a[3] - b[3]);
    for (const e of this.warm) S.pending.add(e[0] + e[1]);
    this.started = false;
    this.startTime = startTime;
    this.holdUntil = startTime + HOLD_MAX;
  }

  /** Греет тоны очереди до момента deadline (clock(), мс) — синтез кусками, начатый тон продолжится в следующий раз. */
  warmUp(deadline) {
    const w = this.warm;
    while (w.length && clock() < deadline) {
      if (!warmTone(this.S, w[0][0], w[0][1], deadline)) return;
      w.shift();
    }
  }

  _applyTempo() {
    const d = this.def;
    this.bpm = d.bpm * (this.intensity ? d.intensityTempo || 1.07 : 1);
    this.stepDur = 60 / this.bpm / 4;
  }

  _ramp(param, now, target, dur) {
    const v = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(v, now);
    param.linearRampToValueAtTime(target, now + Math.max(0.01, dur));
  }

  fadeIn(now, dur) {
    this._ramp(this.fade.gain, now, 1, dur);
    this._ramp(this.revFade.gain, now, 1, dur);
  }

  fadeOut(now, dur) {
    this._ramp(this.fade.gain, now, 0, dur);
    this._ramp(this.revFade.gain, now, 0, dur);
    this.stopTime = now + Math.max(0.01, dur) + 0.02;
  }

  /** Called by the manager's timer: schedule every step that starts before `horizon`. */
  scheduleUntil(horizon, now) {
    if (!this.started) {
      // начало темы ждёт тоны первых HOLD_STEPS шагов (не дольше HOLD_MAX): вступает чуть позже, зато целиком
      const w = this.warm;
      if (w.length && w[0][this.pr] < HOLD_STEPS && now < this.holdUntil) {
        this.nextTime = Math.max(this.nextTime, now + 0.06);
        return;
      }
      this.started = true;
      this.holdMs = Math.round((this.nextTime - this.startTime) * 1000);
    }
    if (this.nextTime < now - 0.08) {
      // Fell behind (throttled timer / hiccup): skip ahead but stay on the grid.
      const skip = Math.ceil((now - this.nextTime) / this.stepDur);
      this.step = (this.step + skip) % this.th.totalSteps;
      this.nextTime += skip * this.stepDur;
    }
    while (this.nextTime < horizon && this.nextTime < this.stopTime) {
      this._scheduleStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step = (this.step + 1) % this.th.totalSteps;
    }
  }

  /** Plays a drum hit from the pre-rendered kit (falls back to live synthesis). */
  _drum(kind, out, t, vel, rate) {
    const kit = this.mgr._kit;
    const S = this.S;
    if (kit) {
      const name = kind === 'hat' && Math.random() < 0.5 ? 'hat2' : kind;
      playBuffer(this.ctx, kit[name], out, t, vel, rate);
      return;
    }
    if (kind === 'kick') drumKick(S, out, t, vel);
    else if (kind === 'snare') drumSnare(S, out, t, vel);
    else if (kind === 'clap') drumClap(S, out, t, vel);
    else if (kind === 'hat') drumHat(S, out, t, vel, false);
    else if (kind === 'openHat') drumHat(S, out, t, vel, true);
    else if (kind === 'shaker') drumShaker(S, out, t, vel);
    else if (kind === 'crash') drumCrash(S, out, t, vel);
    else if (kind === 'tom') drumTom(S, out, t, vel, TOM_BASE * rate);
    else {
      const d = DRUM_KIT.find((k) => k[0] === kind);
      if (d) d[2](S, out, t, vel);
    }
  }

  _hat(c, t, scale) {
    const v = (HAT_VEL[c] || 0) * scale * (0.88 + Math.random() * 0.12);
    if (v <= 0) return;
    const out = this.ch.hat.input;
    if (c !== 'o' && this.def.hatKind === 'shaker') this._drum('shaker', out, t, v * 1.3);
    else this._drum(c === 'o' ? 'openHat' : 'hat', out, t, v);
  }

  _pump(t) {
    const amt = this.def.pump;
    for (const name of PUMPED) {
      const c = this.ch[name];
      c.input.gain.setTargetAtTime(c.level * (1 - amt), t, 0.006);
      c.input.gain.setTargetAtTime(c.level, t + 0.035, 0.09);
    }
  }

  _chord(t, gate, h, hit) {
    const c = this.def.chord;
    const out = this.ch.chord.input;
    const S = this.S;
    if (c.kind === 'ep') synthEP(S, out, t, gate * 0.95, h.chordNotes, c.vel);
    else if (c.kind === 'marimba') for (const n of h.chordNotes) synthMarimba(S, out, t, n, c.vel, c.decay);
    else if (c.kind === 'uke') strumUke(S, out, t, h.chordNotes, c.vel, hit, Math.min(gate * 0.95, c.maxGate || 0.4));
    else if (AMPS[c.kind]) {
      // электрогитара: квинтаккорд от основного тона; открытый звенит до следующего удара
      const m = lowestAbove(h.root % 12, c.low);
      if (hit === 'm') playTone(S, out, t, c.mute, m, c.vel, Math.min(gate, 0.3), 0);
      else playTone(S, out, t, c.kind, m, c.vel * (hit === 'o' ? 1.25 : 1), gate * 0.97, 0);
    } else if (hit === 'o') {
      // оркестровый удар: тот же аккорд с басом октавой ниже, громче, с шумовой атакой
      synthChordSaw(S, out, t, Math.min(gate * 0.9, 0.3), [h.chordNotes[0] - 12].concat(h.chordNotes), c.vel * 1.3, c);
      sNoise(S, out, t, { type: 'bandpass', f: 2400, f1: 500, q: 0.7, a: 0.001, peak: c.vel * 4, dur: 0.14 });
    } else synthChordSaw(S, out, t, Math.min(gate * 0.9, c.maxGate || 0.2), h.chordNotes, c.vel, c);
  }

  _arp(t, midi) {
    const a = this.def.arp;
    const out = this.ch.arp.input;
    if (a.kind === 'bell') synthBell(this.S, out, t, mtof(midi), a.vel, a.decay, a.partials || 3);
    else if (a.kind === 'marimba') synthMarimba(this.S, out, t, midi, a.vel, a.decay);
    else if (a.kind === 'koto') playTone(this.S, out, t, 'koto', midi, a.vel, this.stepDur * 3, -30);
    else synthPluck(this.S, out, t, midi, a.vel, a);
  }

  /** Глиссандо кото по ладу темы (сбивки): пробег вверх или вниз (down) за четверть такта. */
  _gliss(t, down) {
    const notes = this.th.gliss;
    const G = this.def.gliss;
    const dt = (this.stepDur * 4) / notes.length;
    for (let i = 0; i < notes.length; i++) {
      const m = notes[down ? notes.length - 1 - i : i];
      playTone(this.S, this.ch.arp.input, t + i * dt, 'koto', m, G.vel * (0.6 + (0.4 * i) / notes.length), 0.35, 0);
    }
  }

  /** Мелодия голосом из настроек L (kind выбирает инструмент); bend — нота с «^» (подтяжка снизу). */
  _lead(out, t, dur, midi, vel, L, glide, bend) {
    const S = this.S;
    if (L.kind === 'fue' || L.kind === 'shaku') synthFue(S, out, t, dur, midi, vel, L, glide, bend ? L.bend || 100 : 0);
    else if (L.kind === 'supersaw') synthSupersaw(S, out, t, dur, midi, vel, L, glide);
    else if (L.kind === 'pan') synthPan(S, out, t, dur, midi, vel, L, this.stepDur);
    else if (L.kind === 'koto') synthKoto(S, out, t, dur, midi, vel, L, this.stepDur);
    else if (L.kind === 'shamisen') playTone(S, out, t, 'shamisen', midi, vel, dur + 0.02, 20);
    else if (AMPS[L.kind]) {
      // слайд от предыдущей связной ноты или бенд на тон снизу
      if (glide) playGuitar(S, out, t, L.kind, midi, vel, dur, L, 1200 * Math.log2(glide / mtof(midi)), 0.05);
      else playGuitar(S, out, t, L.kind, midi, vel, dur, L, bend ? -(L.bend || 200) : 0, L.bendT || 0.1);
    } else synthLead(S, out, t, dur, midi, vel, L, glide);
  }

  _scheduleStep(step, t0) {
    const th = this.th;
    const def = this.def;
    const S = this.S;
    const ch = this.ch;
    const s = step & 15;
    const bar = step >> 4;

    if (s === 0) {
      const want = this.mgr._intensity;
      if (want !== this.intensity) {
        this.intensity = want;
        this._applyTempo();
        const dt = this.stepDur * (def.delaySteps || 3);
        this.delayL.delayTime.setTargetAtTime(dt, t0, 0.05);
        this.delayR.delayTime.setTargetAtTime(dt, t0, 0.05);
      }
    }
    const sd = this.stepDur;
    const t = t0 + (s & 1 ? (def.swing || 0) * sd : 0);
    const inten = this.intensity;
    const part = th.parts[def.form[bar]];
    const fill = th.parts.fill && bar % 8 === 7 ? th.parts.fill : null;
    const dr = fill || part;

    // --- drums
    if (s === 0 && bar % 8 === 0 && def.crash !== false) this._drum('crash', ch.perc.input, t, 0.8);
    let c = dr.kick && dr.kick[s];
    if (c === 'x' || c === 'o') {
      this._drum(def.kickKind || 'kick', ch.kick.input, t, c === 'x' ? 1 : 0.6);
      if (def.pump) this._pump(t);
    }
    c = dr.snare && dr.snare[s];
    if (c === 'x' || c === 'o') this._drum(def.snareKind || 'snare', ch.snare.input, t, (c === 'x' ? 1 : 0.4) * (fill ? 0.5 + (0.5 * s) / 15 : 1));
    c = dr.clap && dr.clap[s];
    if (c === 'x') this._drum('clap', ch.clap.input, t, 1);
    c = dr.hat && dr.hat[s];
    if (c && c !== '.') this._hat(c, t, 1);
    if (inten && th.extra.hat) {
      c = th.extra.hat[s];
      if (c && c !== '.') this._hat(c, t, 0.7);
    }
    c = dr.tom && dr.tom[s];
    if (c === 'x') this._drum('tom', ch.perc.input, t, 1.2, (250 - s * 8) / TOM_BASE);
    for (const name of PERC) {
      c = dr[name] && dr[name][s];
      if ((!c || c === '.') && inten && th.extra[name]) c = th.extra[name][s];
      const hit = c && PERC_HIT[c];
      if (hit) this._drum(name, ch.perc.input, t, hit[0], hit[1]);
    }

    // --- harmony
    const hb = th.harm[bar];
    const h = hb.length > 1 && s >= hb[1].from ? hb[1] : hb[0];

    const bs = part.bassSeq && part.bassSeq[s];
    if (bs) {
      const B = def.bass;
      if (AMPS[B.kind]) playTone(S, ch.bass.input, t, B.kind, patNote(bs.kind, h), B.vel, bs.len * sd * (B.gate || 0.85), 0);
      else synthBass(S, ch.bass.input, t, bs.len * sd * (B.gate || 0.85), patNote(bs.kind, h), B.vel, B.kind);
    }

    const rs = part.riffSeq && part.riffSeq[s];
    if (rs && def.riff) {
      const R = def.riff;
      playTone(S, ch.riff.input, t, R.kind, patNote(rs.kind, h) + R.octave, R.vel * (s % 4 ? 0.75 : 1), rs.len * sd * (R.gate || 0.9), 20);
    }

    if (part.pad && def.pad && s === h.from) {
      synthChordSaw(S, ch.pad.input, t, h.len * sd + 0.03, h.voicing, def.pad.vel, def.pad);
    }

    const cc = part.chord && part.chord[s];
    if (cc && cc !== '.' && def.chord) {
      const gate = Math.min(part.chordGates[s], h.from + h.len - s) * sd;
      this._chord(t, gate, h, cc);
    }

    const arpPat = part.arp || (inten ? th.extra.arp : null);
    if (arpPat && def.arp && arpPat[s] === 'x') {
      const seq = def.arp.seq;
      this._arp(t, h.ext[seq[s % seq.length] % h.ext.length]);
    }

    c = dr.gliss && dr.gliss[s];
    if ((c === 'x' || c === 'd') && th.gliss) this._gliss(t, c === 'd');

    // --- melody
    const ev = th.melody.get(step);
    if (ev) {
      const L = leadOf(def, part);
      const dur = ev.len * sd - 0.012;
      const prev = this.lastLead;
      let glide = null;
      if (L.glide && prev && prev.midi !== ev.midi && Math.abs(prev.end - t) < 0.03 && Math.abs(ev.midi - prev.midi) <= 7) {
        glide = mtof(prev.midi);
      }
      this._lead(ch.lead.input, t, dur, ev.midi, L.vel, L, glide, ev.bend);
      if (L.with) {
        const W = L.with;
        this._lead(ch.riff.input, t, dur, ev.midi + (W.shift || 0), W.vel, W, null, false);
      }
      if (inten) {
        const dbl = L.double || 12;
        this._lead(ch.lead2.input, t, dur, ev.midi + dbl, L.vel * 0.3, L, glide ? glide * Math.pow(2, dbl / 12) : null, ev.bend);
      }
      this.lastLead = { midi: ev.midi, end: t + ev.len * sd };
    }
  }

  dispose() {
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
    this.nodes.length = 0;
  }
}

// ---------------------------------------------------------------------------
// SFX building blocks
// ---------------------------------------------------------------------------

/** Envelope: 'perc' (attack then exponential decay over dur) or 'gate' (hold, then release). */
function env(p, t, a, peak, dur, kind, rel) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  if (kind === 'gate') {
    const r = Math.min(rel || 0.05, dur - a);
    p.setValueAtTime(peak, t + dur - r);
    p.linearRampToValueAtTime(0, t + dur);
  } else {
    p.setTargetAtTime(0, t + a, Math.max(0.004, (dur - a) / 4.5));
  }
}

/**
 * One oscillator with pitch glide, optional vibrato and low-pass.
 * o: { type, f, f1, gt (glide time), lin, detune, vib: [rate, depthHz], lp, q, a, peak, dur, env, rel }
 */
function sTone(S, out, t, o) {
  const ctx = S.ctx;
  const dur = o.dur;
  const end = t + dur;
  const src = osc(ctx, o.type || 'sine', o.f, t);
  if (o.f1) {
    const gt = t + (o.gt || dur);
    if (o.lin) src.frequency.linearRampToValueAtTime(o.f1, gt);
    else src.frequency.exponentialRampToValueAtTime(o.f1, gt);
  }
  if (o.detune) src.detune.setValueAtTime(o.detune, t);
  const nodes = [src];
  let head = src;
  if (o.vib) {
    const l = osc(ctx, 'sine', o.vib[0], t);
    const lg = gainNode(ctx, o.vib[1]);
    l.connect(lg).connect(src.frequency);
    l.start(t);
    l.stop(end + 0.06);
    nodes.push(l, lg);
  }
  if (o.lp) {
    const f = biquad(ctx, 'lowpass', o.lp, o.q || 0.8);
    head.connect(f);
    head = f;
    nodes.push(f);
  }
  const g = gainNode(ctx, 0);
  env(g.gain, t, o.a || 0.004, o.peak, dur, o.env, o.rel);
  head.connect(g).connect(out);
  nodes.push(g);
  src.start(t);
  src.stop(end + 0.06);
  releaseOnEnd(src, nodes);
}

/** Filtered noise burst. o: { type, f, f1, gt, q, a, peak, dur, env, rel } */
function sNoise(S, out, t, o) {
  const ctx = S.ctx;
  const n = noiseSrc(S, t, o.dur + 0.06);
  const f = biquad(ctx, o.type || 'bandpass', o.f, o.q || 1);
  f.frequency.setValueAtTime(o.f, t);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.gt || o.dur));
  const g = gainNode(ctx, 0);
  env(g.gain, t, o.a || 0.003, o.peak, o.dur, o.env, o.rel);
  n.connect(f).connect(g).connect(out);
  releaseOnEnd(n, [n, f, g]);
}

const semi = (f, st) => f * Math.pow(2, st / 12);
const own = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
const rnd = (a, b) => a + Math.random() * (b - a);

const BRASS = { wave: 'sawtooth', wave2: 'sawtooth', detune: 12, mix2: 0.9, cutoff: 2300, q: 1, attack: 0.02, sustain: 0.85, release: 0.14, vibrato: 0.012, vibRate: 5.5 };
const BRASS_CHORD = { attack: 0.03, release: 0.35, cut0: 3200, cut1: 1500, cutTc: 0.25, detune: 10, sustain: 0.8 };
const SOFT_LEAD = { wave: 'triangle', wave2: 'sine', ratio2: 2, mix2: 0.25, cutoff: 3000, attack: 0.02, sustain: 0.8, release: 0.15, vibrato: 0.008, vibRate: 5 };

function miniTurbo(S, o, t, p, level) {
  const len = 0.28 + 0.16 * level;
  sNoise(S, o, t, { type: 'bandpass', f: 450 * p, f1: (1300 + 700 * level) * p, gt: len * 0.7, q: 1.6, a: 0.02, peak: 0.16 + 0.08 * level, dur: len });
  sTone(S, o, t, { type: 'sawtooth', f: 200 * p * (1 + 0.12 * level), f1: 520 * p * (1 + 0.25 * level), gt: len * 0.6, dur: len, a: 0.01, peak: 0.05 + 0.02 * level, lp: 2400 });
  if (level >= 2) sTone(S, o, t, { type: 'sine', f: 110 * p, f1: 60, dur: 0.25, peak: 0.25 });
  if (level >= 2) synthBell(S, o, t + 0.05, 1568 * p * (level === 3 ? 1.5 : 1.26), 0.05, 0.3, 2);
  if (level === 3) synthBell(S, o, t + 0.11, 2349 * p * 1.5, 0.045, 0.35, 2);
  return len + 0.2;
}

// Each SFX: fn(S, out, t, pitch) -> duration in seconds; rev = reverb send; ui = UI sound
const SFX = {
  countdown: {
    rev: 0.12,
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'square', f: 880 * p, dur: 0.2, peak: 0.1, env: 'gate', rel: 0.05, lp: 3200 });
      sTone(S, o, t, { type: 'sine', f: 880 * p, dur: 0.3, peak: 0.28 });
      sTone(S, o, t, { type: 'sine', f: 1760 * p, dur: 0.12, peak: 0.05 });
      return 0.35;
    },
  },
  go: {
    rev: 0.2,
    fn(S, o, t, p) {
      const f = 1760 * p;
      sTone(S, o, t, { type: 'square', f, dur: 0.7, peak: 0.07, env: 'gate', rel: 0.3, lp: 5200, vib: [7, 8] });
      sTone(S, o, t, { type: 'sine', f, dur: 0.75, peak: 0.26, env: 'gate', rel: 0.35, vib: [7, 8] });
      sTone(S, o, t, { type: 'sine', f: f / 2, dur: 0.55, peak: 0.14 });
      sNoise(S, o, t, { type: 'highpass', f: 7000, q: 0.7, peak: 0.06, dur: 0.35 });
      return 0.8;
    },
  },
  boost: {
    rev: 0.1,
    fn(S, o, t, p) {
      sNoise(S, o, t, { type: 'bandpass', f: 350 * p, f1: 3200 * p, gt: 0.5, q: 1.4, a: 0.04, peak: 0.42, dur: 0.95 });
      sTone(S, o, t, { type: 'sawtooth', f: 170 * p, f1: 700 * p, gt: 0.45, dur: 0.75, a: 0.02, peak: 0.08, lp: 2200 });
      sTone(S, o, t, { type: 'square', f: 340 * p, f1: 1400 * p, gt: 0.45, dur: 0.6, a: 0.02, peak: 0.03, lp: 3000, detune: 8 });
      sTone(S, o, t, { type: 'sine', f: 95 * p, f1: 50, dur: 0.4, peak: 0.34 });
      return 1.0;
    },
  },
  miniturbo1: { rev: 0.08, fn: (S, o, t, p) => miniTurbo(S, o, t, p, 1) },
  miniturbo2: { rev: 0.1, fn: (S, o, t, p) => miniTurbo(S, o, t, p, 2) },
  miniturbo3: { rev: 0.12, fn: (S, o, t, p) => miniTurbo(S, o, t, p, 3) },
  driftStart: {
    fn(S, o, t, p) {
      sNoise(S, o, t, { type: 'bandpass', f: 2300 * p, f1: 1600 * p, q: 6, peak: 0.34, dur: 0.15 });
      sTone(S, o, t, { type: 'triangle', f: 1750 * p, f1: 1400 * p, dur: 0.11, peak: 0.035 });
      return 0.2;
    },
  },
  driftLevel: {
    rev: 0.25,
    fn(S, o, t, p) {
      const f = 1568 * p;
      synthBell(S, o, t, f, 0.16, 0.4, 3);
      synthBell(S, o, t + 0.06, f * 1.5, 0.1, 0.35, 2);
      sNoise(S, o, t, { type: 'highpass', f: 8000, q: 0.7, peak: 0.05, dur: 0.2 });
      return 0.5;
    },
  },
  itemBox: {
    rev: 0.25,
    fn(S, o, t, p) {
      sNoise(S, o, t, { type: 'highpass', f: 2600, q: 0.7, a: 0.001, peak: 0.3, dur: 0.32 });
      sNoise(S, o, t, { type: 'bandpass', f: 1300, q: 1, peak: 0.22, dur: 0.1 });
      for (let i = 0; i < 4; i++) synthBell(S, o, t + rnd(0, 0.1), rnd(2200, 5000) * p, 0.05, 0.22, 2);
      [0, 4, 7, 12, 16].forEach((st, i) => synthBell(S, o, t + 0.05 + i * 0.04, semi(1046.5, st) * p, 0.07, 0.35, 2));
      return 0.7;
    },
  },
  roulette: {
    fn(S, o, t, p) {
      const f = 1400 * p * rnd(0.98, 1.02);
      sTone(S, o, t, { type: 'square', f, dur: 0.035, peak: 0.06, lp: 4000 });
      sTone(S, o, t, { type: 'sine', f: f * 2, dur: 0.03, peak: 0.04 });
      return 0.08;
    },
  },
  itemGet: {
    rev: 0.25,
    fn(S, o, t, p) {
      [0, 4, 7, 12].forEach((st, i) => {
        synthBell(S, o, t + i * 0.055, semi(1046.5, st) * p, 0.12, 0.6, 3);
        sTone(S, o, t + i * 0.055, { type: 'triangle', f: semi(1046.5, st) * p, dur: 0.12, peak: 0.05 });
      });
      return 0.9;
    },
  },
  orbFire: {
    rev: 0.12,
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'square', f: 1600 * p, f1: 260 * p, gt: 0.2, dur: 0.22, peak: 0.09, lp: 3500 });
      sTone(S, o, t, { type: 'sine', f: 2400 * p, f1: 600 * p, dur: 0.18, peak: 0.12 });
      sNoise(S, o, t, { type: 'bandpass', f: 3000 * p, f1: 800 * p, q: 2, peak: 0.08, dur: 0.15 });
      synthBell(S, o, t + 0.02, 2637 * p, 0.04, 0.2, 2);
      return 0.3;
    },
  },
  hit: {
    rev: 0.1,
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'sine', f: 150, f1: 42, gt: 0.2, dur: 0.3, peak: 0.55 });
      sNoise(S, o, t, { type: 'lowpass', f: 2400, f1: 400, q: 0.7, a: 0.001, peak: 0.4, dur: 0.25 });
      sTone(S, o, t + 0.04, { type: 'triangle', f: 720 * p, f1: 160 * p, gt: 0.55, dur: 0.62, a: 0.01, peak: 0.16, vib: [14, 45] });
      sTone(S, o, t + 0.04, { type: 'square', f: 360 * p, f1: 80 * p, gt: 0.4, dur: 0.4, peak: 0.04, lp: 1500 });
      return 0.7;
    },
  },
  spin: {
    rev: 0.12,
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'triangle', f: 1000 * p, f1: 220 * p, gt: 1.0, dur: 1.1, a: 0.02, peak: 0.14, vib: [9, 70], env: 'gate', rel: 0.3 });
      sTone(S, o, t, { type: 'sine', f: 1500 * p, f1: 330 * p, gt: 1.0, dur: 1.1, a: 0.02, peak: 0.06, vib: [9, 95], env: 'gate', rel: 0.3 });
      return 1.2;
    },
  },
  shieldUp: {
    rev: 0.3,
    fn(S, o, t, p) {
      [72, 76, 79, 84].forEach((m, i) => {
        const f = mtof(m) * p;
        sTone(S, o, t + i * 0.06, { type: 'triangle', f: f * 0.89, f1: f, gt: 0.22, dur: 0.85 - i * 0.06, a: 0.03, peak: 0.07, vib: [7, f * 0.006], env: 'gate', rel: 0.35 });
      });
      sNoise(S, o, t, { type: 'highpass', f: 6500, q: 0.7, a: 0.2, peak: 0.035, dur: 0.7 });
      return 0.9;
    },
  },
  shieldBreak: {
    rev: 0.2,
    fn(S, o, t, p) {
      sNoise(S, o, t, { type: 'highpass', f: 3000, q: 0.7, a: 0.001, peak: 0.36, dur: 0.1 });
      sNoise(S, o, t, { type: 'bandpass', f: 5200, f1: 2400, q: 3, peak: 0.12, dur: 0.4 });
      [2637, 3322, 4186].forEach((f) => sTone(S, o, t, { type: 'sine', f: f * p * rnd(0.97, 1.03), f1: f * p * 0.85, dur: 0.35, peak: 0.06 }));
      sTone(S, o, t, { type: 'sine', f: 320, f1: 90, dur: 0.15, peak: 0.2 });
      return 0.5;
    },
  },
  trapDrop: {
    rev: 0.1,
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'sine', f: 2100 * p, dur: 0.12, peak: 0.11 });
      sTone(S, o, t + 0.02, { type: 'sine', f: 3150 * p, dur: 0.09, peak: 0.06 });
      sTone(S, o, t, { type: 'triangle', f: 900 * p, f1: 700 * p, dur: 0.08, peak: 0.1 });
      return 0.2;
    },
  },
  freeze: {
    rev: 0.3,
    fn(S, o, t, p) {
      for (let i = 0; i < 9; i++) sNoise(S, o, t + rnd(0, 0.55), { type: 'highpass', f: rnd(5000, 8000), q: 0.8, a: 0.001, peak: rnd(0.04, 0.14), dur: 0.03 });
      [1, 1.26, 1.5, 2].forEach((r, i) => sTone(S, o, t + i * 0.05, { type: 'sine', f: 1760 * r * p, dur: 0.8, a: 0.05, peak: 0.035, vib: [11, 25] }));
      sNoise(S, o, t, { type: 'bandpass', f: 7000, q: 4, a: 0.1, peak: 0.08, dur: 0.8 });
      sTone(S, o, t, { type: 'sine', f: 2600 * p, f1: 1300 * p, dur: 0.6, peak: 0.04 });
      return 0.9;
    },
  },
  shatter: {
    rev: 0.25,
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'sine', f: 180, f1: 50, dur: 0.25, peak: 0.36 });
      sNoise(S, o, t, { type: 'bandpass', f: 3500, f1: 1500, q: 0.8, a: 0.001, peak: 0.34, dur: 0.5 });
      sNoise(S, o, t, { type: 'highpass', f: 6000, q: 0.7, a: 0.001, peak: 0.24, dur: 0.15 });
      for (let i = 0; i < 6; i++) synthBell(S, o, t + 0.02 + rnd(0, 0.3), rnd(1800, 5200) * p, 0.055 * (1 - i / 10), 0.2, 2);
      return 0.7;
    },
  },
  wallHit: {
    rev: 0.05,
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'sine', f: 95 * p, f1: 38, gt: 0.2, dur: 0.26, peak: 0.55 });
      sNoise(S, o, t, { type: 'lowpass', f: 520, f1: 150, q: 0.8, a: 0.001, peak: 0.36, dur: 0.18 });
      sTone(S, o, t, { type: 'square', f: 120 * p, f1: 60, dur: 0.08, peak: 0.05, lp: 600 });
      return 0.3;
    },
  },
  bump: {
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'sine', f: 330 * p, f1: 170 * p, dur: 0.14, peak: 0.28 });
      sTone(S, o, t, { type: 'triangle', f: 660 * p, f1: 340 * p, dur: 0.08, peak: 0.08 });
      sNoise(S, o, t, { type: 'bandpass', f: 1500, q: 1, a: 0.001, peak: 0.1, dur: 0.06 });
      return 0.2;
    },
  },
  jump: {
    rev: 0.08,
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'triangle', f: 220 * p, f1: 780 * p, gt: 0.22, dur: 0.32, peak: 0.15, vib: [28, 35] });
      sTone(S, o, t, { type: 'sine', f: 110 * p, f1: 390 * p, gt: 0.22, dur: 0.25, peak: 0.1 });
      return 0.35;
    },
  },
  land: {
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'sine', f: 120 * p, f1: 48, dur: 0.2, peak: 0.36 });
      sNoise(S, o, t, { type: 'lowpass', f: 900, f1: 200, q: 0.7, a: 0.001, peak: 0.16, dur: 0.12 });
      return 0.25;
    },
  },
  trick: {
    rev: 0.25,
    fn(S, o, t, p) {
      sNoise(S, o, t, { type: 'bandpass', f: 700 * p, f1: 3200 * p, gt: 0.28, q: 2, a: 0.1, peak: 0.24, dur: 0.32 });
      synthBell(S, o, t + 0.22, 2093 * p, 0.13, 0.5, 3);
      synthBell(S, o, t + 0.28, 3136 * p, 0.08, 0.45, 2);
      return 0.8;
    },
  },
  lap: {
    rev: 0.3,
    fn(S, o, t, p) {
      [79, 84, 88].forEach((m, i) => {
        const f = mtof(m) * p;
        synthBell(S, o, t + i * 0.12, f, 0.13, 0.8, 3);
        sTone(S, o, t + i * 0.12, { type: 'triangle', f, dur: i === 2 ? 0.6 : 0.2, a: 0.01, peak: 0.07 });
      });
      return 1.2;
    },
  },
  finalLap: {
    rev: 0.3,
    fn(S, o, t, p) {
      const tr = Math.round(12 * Math.log2(p));
      const b = 0.09;
      const mel = [[0, 72, 1], [1, 76, 1], [2, 79, 1], [3, 84, 5], [8, 79, 1], [9, 84, 7]];
      for (const [st, m, len] of mel) synthLead(S, o, t + st * b, len * b - 0.015, m + tr, 0.13, BRASS, null);
      synthChordSaw(S, o, t + 3 * b, 5 * b, [60 + tr, 64 + tr, 67 + tr], 0.045, BRASS_CHORD);
      synthChordSaw(S, o, t + 9 * b, 7 * b, [64 + tr, 67 + tr, 72 + tr], 0.045, BRASS_CHORD);
      synthBass(S, o, t + 3 * b, 5 * b, 36 + tr, 0.3, 'saw');
      synthBass(S, o, t + 9 * b, 7 * b, 36 + tr, 0.3, 'saw');
      for (let i = 0; i < 3; i++) drumSnare(S, o, t + i * b, 0.25 + i * 0.08);
      drumKick(S, o, t + 3 * b, 0.6);
      drumKick(S, o, t + 9 * b, 0.7);
      drumCrash(S, o, t + 9 * b, 0.3);
      [0, 4, 7, 12].forEach((st, i) => synthBell(S, o, t + 9 * b + 0.04 + i * 0.05, semi(1046.5, st + tr), 0.05, 0.6, 2));
      return 16 * b + 0.6;
    },
  },
  finishWin: {
    rev: 0.3,
    fn(S, o, t, p) {
      const tr = Math.round(12 * Math.log2(p));
      const b = 0.12;
      const mel = [[0, 67, 1], [1, 72, 1], [2, 76, 1], [3, 79, 3], [6, 76, 1], [7, 79, 1], [8, 81, 3], [11, 79, 1], [12, 81, 1], [13, 83, 3], [16, 84, 9]];
      for (const [st, m, len] of mel) synthLead(S, o, t + st * b, len * b - 0.015, m + tr, 0.13, BRASS, null);
      const chords = [[0, [60, 64, 67], 8], [8, [60, 65, 69], 5], [13, [62, 67, 71], 3], [16, [60, 64, 67, 72], 9]];
      for (const [st, notes, len] of chords) synthChordSaw(S, o, t + st * b, len * b, notes.map((n) => n + tr), 0.04, BRASS_CHORD);
      const bass = [[0, 36, 8], [8, 41, 5], [13, 43, 3], [16, 36, 9]];
      for (const [st, m, len] of bass) synthBass(S, o, t + st * b, len * b * 0.92, m + tr, 0.3, 'saw');
      drumKick(S, o, t, 0.6);
      drumCrash(S, o, t, 0.25);
      drumKick(S, o, t + 8 * b, 0.6);
      drumSnare(S, o, t + 4 * b, 0.4);
      for (let i = 0; i < 6; i++) drumSnare(S, o, t + (13 + i * 0.5) * b, 0.2 + i * 0.06);
      drumKick(S, o, t + 16 * b, 0.75);
      drumCrash(S, o, t + 16 * b, 0.35);
      [0, 4, 7, 12, 16].forEach((st, i) => synthBell(S, o, t + 16 * b + 0.05 + i * 0.06, semi(1046.5, st + tr), 0.06, 0.8, 3));
      return 25 * b + 0.8;
    },
  },
  finishLose: {
    rev: 0.35,
    fn(S, o, t, p) {
      const tr = Math.round(12 * Math.log2(p));
      const b = 0.3;
      const mel = [[0, 84, 1], [1, 81, 1], [2, 83, 1], [3, 79, 1], [4, 81, 1], [5, 77, 1], [6, 76, 2.4]];
      for (const [st, m, len] of mel) {
        synthLead(S, o, t + st * b, len * b - 0.03, m + tr, 0.1, SOFT_LEAD, null);
        synthBell(S, o, t + st * b, mtof(m + tr), 0.04, 0.6, 2);
      }
      const chords = [[0, [60, 64, 65, 69]], [2, [59, 62, 64, 67]], [4, [57, 60, 62, 65]], [6, [55, 59, 60, 64]]];
      chords.forEach(([st, notes], i) => synthEP(S, o, t + st * b, i === 3 ? 2.4 * b : 2 * b, notes.map((n) => n + tr), 0.035));
      [[0, 41], [2, 40], [4, 38], [6, 36]].forEach(([st, m], i) => synthBass(S, o, t + st * b, (i === 3 ? 2.4 : 1.9) * b, m + tr, 0.25, 'sub'));
      synthBell(S, o, t + 6.6 * b, mtof(88 + tr), 0.04, 0.8, 2);
      return 9 * b + 0.5;
    },
  },
  wrongWay: {
    fn(S, o, t, p) {
      for (let i = 0; i < 2; i++) {
        sTone(S, o, t + i * 0.36, { type: 'square', f: 880 * p, dur: 0.16, peak: 0.08, env: 'gate', rel: 0.03, lp: 2600 });
        sTone(S, o, t + 0.18 + i * 0.36, { type: 'square', f: 660 * p, dur: 0.16, peak: 0.08, env: 'gate', rel: 0.03, lp: 2600 });
      }
      return 0.75;
    },
  },
  uiMove: {
    ui: true,
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'sine', f: 1320 * p, f1: 1480 * p, dur: 0.06, peak: 0.12 });
      sTone(S, o, t, { type: 'triangle', f: 2640 * p, dur: 0.04, peak: 0.03 });
      return 0.1;
    },
  },
  uiSelect: {
    ui: true,
    rev: 0.12,
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'triangle', f: 880 * p, dur: 0.07, peak: 0.14 });
      sTone(S, o, t + 0.06, { type: 'triangle', f: 1320 * p, dur: 0.14, peak: 0.14 });
      sTone(S, o, t + 0.06, { type: 'sine', f: 2640 * p, dur: 0.1, peak: 0.04 });
      return 0.25;
    },
  },
  uiBack: {
    ui: true,
    fn(S, o, t, p) {
      sTone(S, o, t, { type: 'triangle', f: 660 * p, f1: 620 * p, dur: 0.07, peak: 0.13 });
      sTone(S, o, t + 0.06, { type: 'triangle', f: 440 * p, dur: 0.11, peak: 0.13 });
      return 0.2;
    },
  },
  uiStart: {
    ui: true,
    rev: 0.25,
    fn(S, o, t, p) {
      [0, 4, 7, 12].forEach((st, i) => {
        const f = semi(659.25, st) * p;
        sTone(S, o, t + i * 0.05, { type: 'triangle', f, dur: 0.16, peak: 0.1 });
        synthBell(S, o, t + i * 0.05, f * 2, 0.05, 0.4, 2);
      });
      sNoise(S, o, t, { type: 'bandpass', f: 600, f1: 4000, gt: 0.25, q: 1.5, a: 0.05, peak: 0.12, dur: 0.35 });
      sTone(S, o, t + 0.2, { type: 'sine', f: semi(659.25, 24) * p, dur: 0.5, peak: 0.06, vib: [6, 10] });
      return 0.8;
    },
  },
};

// Per-sound loudness trims (tuned with offline renders so peaks sit around -6..-12 dBFS).
const SFX_TRIM = {
  countdown: 1.5, go: 1.1, boost: 1.8, miniturbo1: 3, miniturbo2: 1.7, miniturbo3: 1.8,
  driftStart: 5, driftLevel: 1.2, itemBox: 1.4, roulette: 3, itemGet: 0.9, orbFire: 3,
  hit: 1.4, spin: 1.25, shieldUp: 1, shieldBreak: 2, trapDrop: 3, freeze: 1.9, shatter: 1.5,
  wallHit: 1.9, bump: 2.6, jump: 2.6, land: 2, trick: 1.3, lap: 1, finalLap: 0.7,
  finishWin: 0.7, finishLose: 0.9, wrongWay: 2.2, uiMove: 2.8, uiSelect: 1.6, uiBack: 1.6, uiStart: 1.35,
};

// ---------------------------------------------------------------------------
// AudioManager (public API)
// ---------------------------------------------------------------------------

export class AudioManager {
  constructor() {
    this._AC = getAudioContextClass();
    this.ctx = null;
    this.S = null;
    this._muted = false;
    this._musicVolume = 0.55;
    this._sfxVolume = 0.8;
    this._theme = null; // requested theme (kept while waiting for unlock)
    this._current = null; // MusicPlayer currently in charge
    this._players = []; // current + fading-out players
    this._intensity = 0;
    this._timer = null;
    this._paused = false;
    this._engine = null;
    this._activeSfx = 0;
    this._warned = new Set();
    this._analyser = null;
    this._kit = null; // pre-rendered drum buffers (null until ready / unsupported)
  }

  /** true when Web Audio is available in this environment. */
  get supported() {
    return !!this._AC;
  }

  get muted() {
    return this._muted;
  }

  // ----- lifecycle --------------------------------------------------------

  unlock() {
    if (!this._AC) return;
    try {
      if (!this.ctx) this._init();
      const ctx = this.ctx;
      if (ctx.state !== 'running' && ctx.state !== 'closed') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      if (!this._unlockedOnce) {
        // iOS: playing a buffer inside the gesture fully unlocks output.
        this._unlockedOnce = true;
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start(0);
        src.onended = () => src.disconnect();
      }
      if (this._theme && !this._current) this._startTheme(this._theme, 0.4);
    } catch (e) {
      this._warnOnce('unlock', 'AudioManager: could not start audio', e);
    }
  }

  _init() {
    const ctx = new this._AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    // tones — готовые буферы тонов, jobs — начатый синтез, pending — тоны в очередях прогрева,
    // missed — сколько нот пропущено, потому что их тон ещё не был готов
    this.S = { ctx, noise: makeNoiseBuffer(ctx, 2), tones: new Map(), jobs: new Map(), pending: new Set(), missed: 0 };

    this.master = gainNode(ctx, this._muted ? 0 : MASTER_LEVEL);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    this.clip = ctx.createWaveShaper();
    this.clip.curve = makeSoftClipCurve();
    this.master.connect(this.comp);
    this.comp.connect(this.clip);
    this.clip.connect(ctx.destination);

    // music chain
    this.musicGain = gainNode(ctx, this._musicVolume);
    this.duckGain = gainNode(ctx, 1);
    this.musicPause = gainNode(ctx, 1);
    this.musicGain.connect(this.duckGain).connect(this.musicPause).connect(this.master);
    this.musicIn = gainNode(ctx, MUSIC_TRIM);
    this.musicIn.connect(this.musicGain);
    this.reverbIn = gainNode(ctx, MUSIC_TRIM);
    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(ctx, 2.2, 2.6);
    const verbOut = gainNode(ctx, 0.9);
    this.reverbIn.connect(verb).connect(verbOut).connect(this.musicGain);

    // sfx chain
    this.sfxGain = gainNode(ctx, this._sfxVolume);
    this.sfxGain.connect(this.master);
    this.gameSfx = gainNode(ctx, 1);
    this.gameSfx.connect(this.sfxGain);
    this.uiSfx = gainNode(ctx, 1);
    this.uiSfx.connect(this.sfxGain);
    this.engineBus = gainNode(ctx, 1);
    this.engineBus.connect(this.gameSfx);
    this.sfxVerbIn = gainNode(ctx, 1);
    const sverb = ctx.createConvolver();
    sverb.buffer = makeImpulse(ctx, 1.3, 3);
    this.sfxVerbIn.connect(sverb).connect(this.sfxGain);

    if (this._paused) {
      this.musicPause.gain.value = 0;
      this.gameSfx.gain.value = 0;
    }

    renderDrumKit(ctx, (kit) => {
      if (kit && this.ctx === ctx) this._kit = kit;
    });
  }

  _warnOnce(key, msg, err) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    if (typeof console !== 'undefined') console.warn(msg, err || '');
  }

  _ready() {
    return !!(this.ctx && this.ctx.state !== 'closed');
  }

  // ----- volume -----------------------------------------------------------

  setMuted(b) {
    this._muted = !!b;
    if (!this._ready()) return;
    this.master.gain.setTargetAtTime(this._muted ? 0 : MASTER_LEVEL, this.ctx.currentTime, 0.03);
  }

  toggleMute() {
    this.setMuted(!this._muted);
    return this._muted;
  }

  setMusicVolume(v) {
    this._musicVolume = clamp(num(v, 0.55), 0, 1);
    if (this._ready()) this.musicGain.gain.setTargetAtTime(this._musicVolume, this.ctx.currentTime, 0.05);
  }

  setSfxVolume(v) {
    this._sfxVolume = clamp(num(v, 0.8), 0, 1);
    if (this._ready()) this.sfxGain.gain.setTargetAtTime(this._sfxVolume, this.ctx.currentTime, 0.05);
  }

  // ----- music ------------------------------------------------------------

  playMusic(theme) {
    if (!this._AC) return;
    if (!own(THEMES, theme)) {
      this._warnOnce('theme:' + theme, 'AudioManager: unknown music theme "' + theme + '"');
      return;
    }
    if (this._theme === theme && (this._current || !this.ctx)) return;
    this._theme = theme;
    if (!this._ready()) return; // starts on unlock()
    this._startTheme(theme, 1.0);
  }

  _startTheme(name, fade) {
    const t0 = clock(); // бюджет прогрева первого тика считается от начала вызова
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const hadMusic = !!this._current;
    if (this._current) this._current.fadeOut(now, fade);
    const player = new MusicPlayer(this, compileTheme(name), now + 0.06);
    player.fadeIn(now, hadMusic ? fade : Math.min(fade, 0.4));
    this._current = player;
    this._players.push(player);
    this._ensureTimer();
    this._tick(t0);
  }

  stopMusic(fade = 1.0) {
    this._theme = null;
    if (!this._current || !this._ready()) {
      this._current = null;
      return;
    }
    this._current.fadeOut(this.ctx.currentTime, Math.max(0.01, num(fade, 1)));
    this._current = null;
  }

  setMusicIntensity(level) {
    this._intensity = num(level, 0) >= 0.5 ? 1 : 0;
  }

  duck(amount = 0.5, time = 1.5) {
    if (!this._ready()) return;
    const g = this.duckGain.gain;
    const now = this.ctx.currentTime;
    const v = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(v, now);
    g.setTargetAtTime(clamp(1 - num(amount, 0.5), 0, 1), now, 0.06);
    g.setTargetAtTime(1, now + Math.max(0.05, num(time, 1.5)), 0.35);
  }

  _ensureTimer() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), TIMER_MS);
  }

  /** Тик планировщика; t0 — начало задачи (clock()), от него отсчитывается бюджет прогрева тонов. */
  _tick(t0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = t0 || clock();
    const now = ctx.currentTime;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const horizon = now + (hidden ? 1.5 : LOOKAHEAD);
    if (!this._paused) {
      for (const p of this._players) {
        try {
          p.scheduleUntil(horizon, now);
        } catch (e) {
          this._warnOnce('sched', 'AudioManager: music scheduling error', e);
        }
      }
    }
    // тоны текущей темы греются кусками в остаток бюджета WARM_MS от начала тика (и на паузе тоже)
    const cur = this._current;
    if (cur && cur.warm.length) cur.warmUp(start + WARM_MS);
    if (this._players.length) {
      const n = this._players.length;
      this._players = this._players.filter((p) => {
        if (p.stopTime !== Infinity && now > p.stopTime + 0.3) {
          p.dispose();
          return false;
        }
        return true;
      });
      if (this._players.length < n) {
        // тема отзвучала — её тоны больше не нужны, освобождаем память (и бросаем недоделанный синтез)
        const S = this.S;
        const keep = new Set();
        for (const p of this._players) for (const [k, m] of p.th.tones) keep.add(k + m);
        for (const key of S.tones.keys()) if (!keep.has(key)) S.tones.delete(key);
        for (const key of S.jobs.keys()) if (!keep.has(key)) S.jobs.delete(key);
        S.pending.clear();
        for (const p of this._players) for (const [k, m] of p.warm) S.pending.add(k + m);
      }
    }
    if (!this._players.length && this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // ----- one-shot sfx -----------------------------------------------------

  sfx(name, opts = {}) {
    const def = own(SFX, name) ? SFX[name] : null;
    if (!def) {
      this._warnOnce('sfx:' + name, 'AudioManager: unknown sfx "' + name + '"');
      return;
    }
    if (!this._ready() || this._muted || this._sfxVolume <= 0) return;
    if (this._activeSfx >= MAX_ACTIVE_SFX) return;
    opts = opts || {};
    const volume = clamp(num(opts.volume, 1), 0, 2);
    if (volume <= 0.001) return;
    const pan = clamp(num(opts.pan, 0), -1, 1);
    const pitch = clamp(num(opts.pitch, 1), 0.25, 4);
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const out = gainNode(ctx, volume * (SFX_TRIM[name] || 1));
    const nodes = [out];
    let head = out;
    if (pan) {
      const p = stereo(ctx, pan);
      if (p) {
        out.connect(p);
        head = p;
        nodes.push(p);
      }
    }
    head.connect(def.ui ? this.uiSfx : this.gameSfx);
    if (def.rev) {
      const rs = gainNode(ctx, def.rev);
      head.connect(rs).connect(this.sfxVerbIn);
      nodes.push(rs);
    }
    let dur = 1;
    try {
      dur = def.fn(this.S, out, t, pitch) || 1;
    } catch (e) {
      this._warnOnce('sfxerr:' + name, 'AudioManager: sfx "' + name + '" failed', e);
    }
    this._activeSfx++;
    setTimeout(() => {
      this._activeSfx--;
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch (e) {
          /* ignore */
        }
      }
    }, (dur + 0.6) * 1000);
  }

  // ----- continuous player-kart sounds -------------------------------------

  _createEngine() {
    const ctx = this.ctx;
    const S = this.S;
    const now = ctx.currentTime;
    const out = gainNode(ctx, 0);
    out.gain.setTargetAtTime(1, now, 0.08);
    out.connect(this.engineBus);

    // motor: saw + detuned square + sub sine → resonant low-pass → putter AM
    const o1 = osc(ctx, 'sawtooth', 60, now);
    const o2 = osc(ctx, 'square', 60, now);
    o2.detune.value = 9;
    const o3 = osc(ctx, 'sine', 30, now);
    const g2 = gainNode(ctx, 0.3);
    const g3 = gainNode(ctx, 0.55);
    const lp = biquad(ctx, 'lowpass', 600, 2.2);
    const am = gainNode(ctx, 0.75);
    const putter = osc(ctx, 'sine', 14, now);
    const putterDepth = gainNode(ctx, 0.25);
    const wob = osc(ctx, 'sine', 6.3, now);
    const wobDepth = gainNode(ctx, 0.8);
    const motor = gainNode(ctx, 0);
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    o3.connect(g3).connect(lp);
    lp.connect(am).connect(motor).connect(out);
    putter.connect(putterDepth).connect(am.gain);
    wob.connect(wobDepth);
    wobDepth.connect(o1.frequency);
    wobDepth.connect(o2.frequency);

    // boost jet: band-passed roaring noise
    const jn = noiseSrc(S, now);
    const jhp = biquad(ctx, 'highpass', 250, 0.7);
    const jbp = biquad(ctx, 'bandpass', 900, 0.7);
    const jet = gainNode(ctx, 0);
    jn.connect(jhp).connect(jbp).connect(jet).connect(out);

    // drift screech: narrow band noise with a little chatter
    const sn = noiseSrc(S, now);
    const sbp = biquad(ctx, 'bandpass', 1600, 7);
    const chat = osc(ctx, 'sine', 8.5, now);
    const chatDepth = gainNode(ctx, 90);
    chat.connect(chatDepth).connect(sbp.frequency);
    const screech = gainNode(ctx, 0);
    sn.connect(sbp).connect(screech).connect(out);

    // offroad rumble: low noise + gravel crunch band, through a bumpy tremolo
    const rn = noiseSrc(S, now);
    const rlp = biquad(ctx, 'lowpass', 300, 1.2);
    const gbp = biquad(ctx, 'bandpass', 1100, 1.2);
    const gravel = gainNode(ctx, 0.25);
    const trem = gainNode(ctx, 0.65);
    const rl = osc(ctx, 'triangle', 13, now);
    const rlDepth = gainNode(ctx, 0.35);
    rl.connect(rlDepth).connect(trem.gain);
    const rumble = gainNode(ctx, 0);
    rn.connect(rlp).connect(trem);
    rn.connect(gbp).connect(gravel).connect(trem);
    trem.connect(rumble).connect(out);

    const sources = [o1, o2, o3, putter, wob, chat, rl];
    for (const s of sources) s.start(now);
    sources.push(jn, sn, rn);
    const all = sources.concat([out, g2, g3, lp, am, putterDepth, wobDepth, motor, jhp, jbp, jet, sbp, chatDepth, screech, rlp, gbp, gravel, trem, rlDepth, rumble]);
    return { out, o1, o2, o3, putter, wobDepth, lp, motor, jet, jbp, screech, sbp, rumble, rlp, sources, all, last: {}, lastT: -1, flags: '' };
  }

  _setP(e, key, param, value, tc, now) {
    const prev = e.last[key];
    if (prev !== undefined && Math.abs(prev - value) <= Math.abs(prev) * 0.004 + 1e-5) return;
    e.last[key] = value;
    param.setTargetAtTime(value, now, tc);
  }

  updateEngine(state) {
    if (!state || !this._ready() || this.ctx.state !== 'running') return;
    try {
      if (!this._engine) this._engine = this._createEngine();
      const e = this._engine;
      const now = this.ctx.currentTime;
      const boosting = !!state.boosting;
      const drifting = !!state.drifting;
      const offroad = !!state.offroad;
      const air = !!state.airborne;
      const lvl = clamp(num(state.driftLevel, 0) | 0, 0, 3);
      const flags = '' + +boosting + +drifting + +offroad + +air + lvl;
      if (flags === e.flags && now - e.lastT < 0.03) return;
      e.flags = flags;
      e.lastT = now;

      const sp = clamp(num(state.speed01, 0), 0, 1.8);
      const thr = clamp(num(state.throttle, 0), 0, 1);
      const sp1 = Math.min(sp, 1);

      let f = 55 + 135 * Math.pow(sp1, 0.85) + Math.max(0, sp - 1) * 90;
      f *= 1 + thr * 0.04;
      if (boosting) f *= 1.12;
      if (air) f *= 1.06 + 0.06 * thr;
      f = clamp(f, 45, 320);
      this._setP(e, 'f', e.o1.frequency, f, 0.06, now);
      this._setP(e, 'f2', e.o2.frequency, f, 0.06, now);
      this._setP(e, 'f3', e.o3.frequency, f * 0.5, 0.06, now);
      this._setP(e, 'put', e.putter.frequency, f / 4.2, 0.06, now);
      this._setP(e, 'wob', e.wobDepth.gain, f * 0.012, 0.1, now);
      const cut = 380 + thr * 900 + sp1 * 1300 + (boosting ? 900 : 0) - (offroad ? 250 : 0);
      this._setP(e, 'cut', e.lp.frequency, clamp(cut, 200, 5000), 0.07, now);
      let mg = 0.042 + thr * 0.03 + sp1 * 0.02;
      if (air) mg *= 0.85;
      this._setP(e, 'mg', e.motor.gain, mg, 0.06, now);

      const jet = boosting ? 0.24 + 0.07 * Math.min(sp, 1.5) : 0;
      this._setP(e, 'jet', e.jet.gain, jet, boosting ? 0.04 : 0.15, now);
      this._setP(e, 'jf', e.jbp.frequency, 650 + sp * 900, 0.1, now);

      const scr = drifting && !air ? (0.3 + lvl * 0.07) * clamp(0.4 + sp, 0, 1) : 0;
      this._setP(e, 'scr', e.screech.gain, scr, scr ? 0.04 : 0.08, now);
      this._setP(e, 'sf', e.sbp.frequency, 1300 + lvl * 420, 0.08, now);

      const rum = offroad && !air ? 0.7 * clamp(sp * 1.6, 0.15, 1) : 0;
      this._setP(e, 'rum', e.rumble.gain, rum, 0.06, now);
      this._setP(e, 'rf', e.rlp.frequency, 200 + sp1 * 200, 0.1, now);
    } catch (err) {
      this._warnOnce('engine', 'AudioManager: engine update failed', err);
    }
  }

  stopEngine() {
    const e = this._engine;
    if (!e) return;
    this._engine = null;
    if (!this._ready()) return;
    const now = this.ctx.currentTime;
    try {
      e.out.gain.cancelScheduledValues(now);
      e.out.gain.setValueAtTime(e.out.gain.value, now);
      e.out.gain.setTargetAtTime(0, now, 0.04);
      for (const s of e.sources) s.stop(now + 0.3);
      releaseOnEnd(e.sources[0], e.all);
    } catch (err) {
      /* ignore */
    }
  }

  // ----- pause ------------------------------------------------------------

  /**
   * Pause menu: freezes the music sequencer and silences music, engine and
   * gameplay sfx. The context keeps running so UI sounds (ui*) still work.
   */
  pauseAll() {
    if (this._paused) return;
    this._paused = true;
    if (!this._ready()) return;
    const now = this.ctx.currentTime;
    this.musicPause.gain.setTargetAtTime(0, now, 0.03);
    this.gameSfx.gain.setTargetAtTime(0, now, 0.03);
  }

  resumeAll() {
    if (!this._paused) return;
    this._paused = false;
    if (!this._ready()) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
    const now = ctx.currentTime;
    for (const p of this._players) p.nextTime = Math.max(p.nextTime, now + 0.05);
    this.musicPause.gain.setTargetAtTime(1, now + 0.03, 0.05);
    this.gameSfx.gain.setTargetAtTime(1, now, 0.03);
  }

  // ----- debug ------------------------------------------------------------

  /** AnalyserNode tapping the compressor output (pre soft-clip), for level meters/tests. */
  _getAnalyser() {
    if (!this._ready()) return null;
    if (!this._analyser) {
      this._analyser = this.ctx.createAnalyser();
      this._analyser.fftSize = 2048;
      this.comp.connect(this._analyser);
    }
    return this._analyser;
  }
}

export default AudioManager;
