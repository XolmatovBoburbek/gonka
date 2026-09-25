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
];

/**
 * Renders every drum voice once into AudioBuffers (OfflineAudioContext) so the
 * sequencer can play each hit with 1-2 nodes instead of 3-7 filtered ones.
 * Calls done(null) when offline rendering is unavailable.
 */
function renderDrumKit(ctx, done) {
  const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!OAC) return done(null);
  const rate = ctx.sampleRate;
  const slot = 2.1;
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
      b.getChannelData(0).set(data.subarray(Math.floor(i * slot * rate), Math.floor(i * slot * rate) + n));
      kit[name] = b;
    });
    done(kit);
  };
  try {
    const off = new OAC(1, Math.ceil(rate * slot * DRUM_KIT.length), rate);
    const S = { ctx: off, noise: makeNoiseBuffer(off, 2) };
    DRUM_KIT.forEach(([, , fn], i) => fn(S, off.destination, i * slot));
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
 * o: { attack, release, cut0, cut1, cutTc, detune, sustain }
 */
function synthChordSaw(S, out, t, dur, notes, vel, o) {
  const ctx = S.ctx;
  const attack = o.attack;
  dur = Math.max(dur, attack + 0.02);
  const lp = biquad(ctx, 'lowpass', o.cut0, 0.7);
  lp.frequency.setValueAtTime(o.cut0, t);
  lp.frequency.setTargetAtTime(o.cut1, t, o.cutTc);
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
    a.detune.setValueAtTime(-o.detune, t);
    b.detune.setValueAtTime(o.detune, t);
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
  const stopAt = t + dur + 0.6;
  notes.forEach((m, i) => {
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
    amp.gain.setTargetAtTime(0, t + dur, 0.09);
    const pan = stereo(ctx, (i % 2 ? 0.25 : -0.25));
    const nodes = [car, mod, mg, tine, tg, amp];
    if (pan) {
      car.connect(amp).connect(pan).connect(out);
      nodes.push(pan);
    } else car.connect(amp).connect(out);
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
// Music themes (pure data)
//
// chords : one entry per bar, a symbol or [firstHalf, secondHalf]
// melody : one string per bar; 8 tokens = 8th notes, 16 tokens = 16ths.
//          'A5' note, '-' hold (ties across bars), '.' rest
// parts  : per-section 16-step patterns. form picks the section per bar;
//          'fill' replaces the drums on the last bar of every 8.
//   kick/snare: x = hit, o = ghost   hat: x accent, h soft, o open
//   bass: R root(slash bass), O octave, 5 fifth, '-' hold, '.' rest
//   chord/arp: x = hit
// extra  : layers added by setMusicIntensity(1) (plus lead doubled an octave up)
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

  // Cheerful energetic J-pop racing theme (D major). Verse I–V–vi–IV,
  // chorus on the "royal road" IV–V–iii–vi.
  sakura: {
    bpm: 150,
    swing: 0,
    form: 'AAAAAAAABBBBBBBB',
    padCenter: 62,
    bassLow: 36,
    chords: [
      'D', 'A/C#', 'Bm', 'G', 'D', 'A/C#', 'Bm7', ['G', 'A'],
      'Gmaj7', 'A', 'F#m7', 'Bm7', 'Gmaj7', 'A', 'Bm7', ['Em7', 'A'],
    ],
    melody: [
      'F#5 . F#5 E5 F#5 - A5 -',
      'E5 - C#5 - A4 - . A4',
      'D5 . D5 C#5 D5 - F#5 -',
      'E5 - D5 - B4 - . .',
      'F#5 . F#5 E5 F#5 - A5 -',
      'B5 - A5 - E5 - C#5 -',
      'D5 - E5 - F#5 - A5 -',
      'D5 - G5 - A5 - C#6 -',
      'B5 - - A5 - B5 D6 -',
      'C#6 - - B5 - A5 E5 -',
      'A5 - - F#5 - A5 C#6 -',
      'D6 - - C#6 - B5 - .',
      'B5 - - A5 - B5 D6 -',
      'C#6 - - B5 - C#6 E6 -',
      'D6 - - C#6 - B5 A5 -',
      'B5 - A5 G5 A5 - . .',
    ],
    lead: { wave: 'square', wave2: 'sawtooth', detune: 9, mix2: 0.55, cutoff: 3000, vibrato: 0.011, vibRate: 5.8, sustain: 0.75, release: 0.06, vel: 0.12, glide: true },
    bass: { kind: 'saw', vel: 0.44, gate: 0.8 },
    pad: { vel: 0.03, attack: 0.06, release: 0.35, cut0: 900, cut1: 2300, cutTc: 0.25, detune: 12, sustain: 1 },
    chord: { kind: 'stab', vel: 0.05, attack: 0.004, release: 0.12, cut0: 3800, cut1: 1100, cutTc: 0.06, detune: 9, sustain: 0.6, maxGate: 0.12 },
    arp: { kind: 'pluck', wave: 'sawtooth', vel: 0.045, decay: 0.07, bright: 3800, octave: 12, seq: [0, 1, 2, 3, 4, 3, 2, 1] },
    mix: { lead: { d: 0.22, r: 0.18 }, arp: { d: 0.22, r: 0.15 } },
    parts: {
      A: {
        kick: 'x.....x...x.....',
        snare: '....x.......x...',
        hat: 'x.h.x.h.x.h.x.h.',
        bass: 'R.R.R.R.R.R.R.O.',
        chord: '..x...x...x...x.',
        pad: true,
      },
      B: {
        kick: 'x...x...x...x...',
        snare: '....x.......x...',
        clap: '....x.......x...',
        hat: 'h.o.h.o.h.o.h.o.',
        bass: 'R.R.O.R.R.R.O.R.',
        arp: 'xxxxxxxxxxxxxxxx',
        pad: true,
      },
      fill: {
        kick: 'x...x...x...x.x.',
        snare: '....x...x.x.xxxx',
        hat: 'h.h.h.h.h.......',
      },
    },
    extra: { hat: 'xhhhxhhhxhhhxhhh', arp: 'xxxxxxxxxxxxxxxx' },
  },

  // Night-city eurobeat / synthwave (A minor, i–VI–III–VII), octave bass.
  neon: {
    bpm: 140,
    swing: 0,
    form: 'AAAAAAAABBBBBBBB',
    padCenter: 64,
    bassLow: 33,
    pump: 0.5,
    chords: [
      'Am', 'F', 'C', 'G', 'Am', 'Fmaj7', 'C', 'G',
      'Fmaj7', 'G', 'Em7', 'Am', 'Dm7', 'G', 'Esus4', 'E7',
    ],
    melody: [
      'E5 A5 - B5 C6 - B5 A5',
      '- - C6 - A5 - F5 -',
      'E5 G5 - A5 C6 - A5 G5',
      '- - B5 - D6 - B5 G5',
      'E5 A5 - B5 C6 - B5 A5',
      '- - C6 - D6 - E6 -',
      '- - D6 C6 - G5 E5 -',
      'D5 - G5 - B5 - D6 -',
      'C6 - - - - - A5 C6',
      'D6 - - - - - B5 D6',
      'E6 - - D6 - - B5 -',
      'C6 - - B5 - A5 - -',
      'D6 - - C6 - A5 - C6',
      'B5 - - D6 - G5 - B5',
      'B5 - - A5 - B5 - E6',
      '- - - D6 - B5 G#5 -',
    ],
    lead: { wave: 'sawtooth', wave2: 'sawtooth', detune: 14, mix2: 0.8, cutoff: 3800, q: 1.5, vibrato: 0.012, vibRate: 6, sustain: 0.8, release: 0.08, vel: 0.13, glide: true },
    bass: { kind: 'pluck', vel: 0.46, gate: 0.7 },
    pad: { vel: 0.028, attack: 0.12, release: 0.4, cut0: 1200, cut1: 3200, cutTc: 0.4, detune: 16, sustain: 1 },
    chord: { kind: 'stab', vel: 0.045, attack: 0.004, release: 0.1, cut0: 4200, cut1: 1300, cutTc: 0.05, detune: 14, sustain: 0.6, maxGate: 0.1 },
    arp: { kind: 'pluck', wave: 'square', vel: 0.04, decay: 0.065, bright: 3200, octave: 12, seq: [0, 2, 1, 3, 2, 4, 3, 5] },
    mix: { lead: { d: 0.3, r: 0.2 }, arp: { d: 0.3, r: 0.12 } },
    parts: {
      A: {
        kick: 'x...x...x...x...',
        clap: '....x.......x...',
        hat: 'h.o.h.o.h.o.h.o.',
        bass: 'R.O.R.O.R.O.R.O.',
        chord: '..x...x...x...x.',
        arp: 'xxxxxxxxxxxxxxxx',
      },
      B: {
        kick: 'x...x...x...x...',
        snare: '....x.......x...',
        clap: '....x.......x...',
        hat: 'hhohhhohhhohhhoh',
        bass: 'R.O.R.O.R.O.R.O.',
        arp: 'xxxxxxxxxxxxxxxx',
        pad: true,
      },
      fill: {
        kick: 'x...x...x...x...',
        snare: '....x...x.x.xxxx',
        clap: '....x...........',
        hat: 'h.o.h.o.........',
      },
    },
    extra: { hat: 'xhhhxhhhxhhhxhhh' },
  },

  // Tropical-house / chill summer ending (Eb major, vi–IV–I–V), off-beat mallets.
  sunset: {
    bpm: 112,
    swing: 0.1,
    form: 'AAAAAAAABBBBBBBB',
    padCenter: 63,
    bassLow: 36,
    pump: 0.35,
    hatKind: 'shaker',
    chords: [
      'Cm7', 'Abmaj7', 'Eb', 'Bb', 'Cm7', 'Abmaj7', 'Ebmaj7', 'Bb',
      'Abmaj7', 'Bb', 'Gm7', 'Cm7', 'Fm7', 'Bb', 'Ebmaj7', 'Bb7sus4',
    ],
    melody: [
      '. . Eb5 F5 G5 - - -',
      '. . Eb5 F5 G5 - C6 -',
      'Bb5 - G5 - . F5 G5 -',
      'F5 - - - D5 - - -',
      '. . Eb5 F5 G5 - - -',
      '. . Eb5 F5 G5 - Eb6 -',
      'D6 - Bb5 - . G5 Bb5 -',
      'C6 - Bb5 - F5 - . .',
      'C6 - - Bb5 - - G5 -',
      'F5 - - G5 - - Bb5 -',
      'Bb5 - - D6 - - C6 -',
      'Bb5 - - G5 - - - -',
      'C6 - - Ab5 - - Bb5 C6',
      'D6 - - C6 - - Bb5 -',
      'G5 - - Bb5 - - D6 -',
      'Eb6 - - - - - . .',
    ],
    lead: { wave: 'triangle', wave2: 'sine', ratio2: 2, mix2: 0.22, cutoff: 3200, vibrato: 0.008, vibRate: 5, attack: 0.03, sustain: 0.85, release: 0.1, breath: 0.28, vel: 0.22, glide: true },
    bass: { kind: 'sub', vel: 0.55, gate: 0.9 },
    pad: { vel: 0.022, attack: 0.3, release: 0.5, cut0: 600, cut1: 1400, cutTc: 0.4, detune: 9, sustain: 1 },
    chord: { kind: 'marimba', vel: 0.05, decay: 0.14, octave: 12 },
    arp: { kind: 'marimba', vel: 0.035, decay: 0.1, octave: 12, seq: [0, 1, 2, 3, 4, 3, 2, 1] },
    mix: { lead: { d: 0.3, r: 0.3 }, chord: { d: 0.18, r: 0.2 }, arp: { d: 0.25, r: 0.2 } },
    parts: {
      A: {
        kick: 'x...x...x...x...',
        clap: '....x.......x...',
        hat: '..x...x...x...x.',
        bass: 'R-.R..R.R-.R..O.',
        chord: '..x...x...x...x.',
        pad: true,
      },
      B: {
        kick: 'x...x...x...x...',
        clap: '....x.......x...',
        hat: '.hxh.hxh.hxh.hxh',
        bass: 'R-.R..R.R-.R..O.',
        chord: 'x..x..x...x..x..',
        pad: true,
      },
      fill: {
        kick: 'x...x...x...x...',
        clap: '....x.......x...',
        hat: '.hxh.hxh.hxh....',
        tom: '........x..x..x.',
      },
    },
    extra: { hat: 'hhxhhhxhhhxhhhxh', arp: 'x.xxx.xxx.xxx.xx' },
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
        const m = tok === '.' ? null : parseNote(tok);
        if (m !== null) {
          last = { step: Math.round(pos), len: stepLen, midi: m };
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
    if (str[s] !== 'x') continue;
    let d = 1;
    while (d < 16 && str[(s + d) % 16] !== 'x') d++;
    out[s] = d;
  }
  return out;
}

function compilePart(p) {
  const r = Object.assign({}, p);
  if (p.bass) r.bassSeq = parseBassPattern(p.bass);
  if (p.chord) r.chordGates = gatesFor(p.chord);
  return r;
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
  };
  compiledThemes.set(name, out);
  return out;
}

// Mixer channels of a theme player: g = level, d = delay send, r = reverb send, hp = high-pass
const CHANNELS = {
  kick: { g: 0.5, d: 0, r: 0 },
  snare: { g: 0.85, d: 0, r: 0.12 },
  clap: { g: 0.8, d: 0, r: 0.16 },
  hat: { g: 0.3, d: 0, r: 0.04 },
  perc: { g: 0.35, d: 0, r: 0.2 },
  bass: { g: 0.7, d: 0, r: 0 },
  pad: { g: 1, d: 0, r: 0.35, hp: 140 },
  chord: { g: 1, d: 0.08, r: 0.18, hp: 160 },
  arp: { g: 1.2, d: 0.28, r: 0.18, hp: 220 },
  lead: { g: 1.25, d: 0.24, r: 0.2 },
  lead2: { g: 1.25, d: 0.18, r: 0.2, hp: 300 },
};
const PUMPED = ['pad', 'chord', 'arp'];
const HAT_VEL = { x: 1, h: 0.55, o: 0.75 };

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
  _drum(kind, out, t, vel, freq) {
    const kit = this.mgr._kit;
    const S = this.S;
    if (kit) {
      const name = kind === 'hat' && Math.random() < 0.5 ? 'hat2' : kind;
      playBuffer(this.ctx, kit[name], out, t, vel, kind === 'tom' ? freq / TOM_BASE : 1);
      return;
    }
    if (kind === 'kick') drumKick(S, out, t, vel);
    else if (kind === 'snare') drumSnare(S, out, t, vel);
    else if (kind === 'clap') drumClap(S, out, t, vel);
    else if (kind === 'hat') drumHat(S, out, t, vel, false);
    else if (kind === 'openHat') drumHat(S, out, t, vel, true);
    else if (kind === 'shaker') drumShaker(S, out, t, vel);
    else if (kind === 'crash') drumCrash(S, out, t, vel);
    else if (kind === 'tom') drumTom(S, out, t, vel, freq);
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

  _chord(t, gate, h) {
    const c = this.def.chord;
    const out = this.ch.chord.input;
    const S = this.S;
    if (c.kind === 'ep') synthEP(S, out, t, gate * 0.95, h.chordNotes, c.vel);
    else if (c.kind === 'marimba') for (const n of h.chordNotes) synthMarimba(S, out, t, n, c.vel, c.decay);
    else synthChordSaw(S, out, t, Math.min(gate * 0.9, c.maxGate || 0.2), h.chordNotes, c.vel, c);
  }

  _arp(t, midi) {
    const a = this.def.arp;
    const out = this.ch.arp.input;
    if (a.kind === 'bell') synthBell(this.S, out, t, mtof(midi), a.vel, a.decay, a.partials || 3);
    else if (a.kind === 'marimba') synthMarimba(this.S, out, t, midi, a.vel, a.decay);
    else synthPluck(this.S, out, t, midi, a.vel, a);
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
      this._drum('kick', ch.kick.input, t, c === 'x' ? 1 : 0.6);
      if (def.pump) this._pump(t);
    }
    c = dr.snare && dr.snare[s];
    if (c === 'x' || c === 'o') this._drum('snare', ch.snare.input, t, (c === 'x' ? 1 : 0.4) * (fill ? 0.5 + (0.5 * s) / 15 : 1));
    c = dr.clap && dr.clap[s];
    if (c === 'x') this._drum('clap', ch.clap.input, t, 1);
    c = dr.hat && dr.hat[s];
    if (c && c !== '.') this._hat(c, t, 1);
    if (inten && th.extra.hat) {
      c = th.extra.hat[s];
      if (c && c !== '.') this._hat(c, t, 0.7);
    }
    c = dr.tom && dr.tom[s];
    if (c === 'x') this._drum('tom', ch.perc.input, t, 1.2, 250 - s * 8);

    // --- harmony
    const hb = th.harm[bar];
    const h = hb.length > 1 && s >= hb[1].from ? hb[1] : hb[0];

    const bs = part.bassSeq && part.bassSeq[s];
    if (bs) {
      let m = h.bass;
      if (bs.kind === 'O') m += 12;
      else if (bs.kind === '5') {
        m = h.root + 7;
        if (m - h.bass > 12) m -= 12;
      }
      synthBass(S, ch.bass.input, t, bs.len * sd * (def.bass.gate || 0.85), m, def.bass.vel, def.bass.kind);
    }

    if (part.pad && def.pad && s === h.from) {
      synthChordSaw(S, ch.pad.input, t, h.len * sd + 0.03, h.voicing, def.pad.vel, def.pad);
    }

    if (part.chord && def.chord && part.chord[s] === 'x') {
      const gate = Math.min(part.chordGates[s], h.from + h.len - s) * sd;
      this._chord(t, gate, h);
    }

    const arpPat = part.arp || (inten ? th.extra.arp : null);
    if (arpPat && def.arp && arpPat[s] === 'x') {
      const seq = def.arp.seq;
      this._arp(t, h.ext[seq[s % seq.length] % h.ext.length]);
    }

    // --- melody
    const ev = th.melody.get(step);
    if (ev) {
      const L = def.lead;
      const dur = ev.len * sd - 0.012;
      const prev = this.lastLead;
      let glide = null;
      if (L.glide && prev && prev.midi !== ev.midi && Math.abs(prev.end - t) < 0.03 && Math.abs(ev.midi - prev.midi) <= 7) {
        glide = mtof(prev.midi);
      }
      synthLead(S, ch.lead.input, t, dur, ev.midi, L.vel, L, glide);
      if (inten) synthLead(S, ch.lead2.input, t, dur, ev.midi + 12, L.vel * 0.3, L, glide ? glide * 2 : null);
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
    this.S = { ctx, noise: makeNoiseBuffer(ctx, 2) };

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
    if (!THEMES[theme]) {
      this._warnOnce('theme:' + theme, 'AudioManager: unknown music theme "' + theme + '"');
      return;
    }
    if (this._theme === theme && (this._current || !this.ctx)) return;
    this._theme = theme;
    if (!this._ready()) return; // starts on unlock()
    this._startTheme(theme, 1.0);
  }

  _startTheme(name, fade) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const hadMusic = !!this._current;
    if (this._current) this._current.fadeOut(now, fade);
    const player = new MusicPlayer(this, compileTheme(name), now + 0.06);
    player.fadeIn(now, hadMusic ? fade : Math.min(fade, 0.4));
    this._current = player;
    this._players.push(player);
    this._ensureTimer();
    this._tick();
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

  _tick() {
    const ctx = this.ctx;
    if (!ctx) return;
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
    if (this._players.length) {
      this._players = this._players.filter((p) => {
        if (p.stopTime !== Infinity && now > p.stopTime + 0.3) {
          p.dispose();
          return false;
        }
        return true;
      });
    }
    if (!this._players.length && this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // ----- one-shot sfx -----------------------------------------------------

  sfx(name, opts = {}) {
    const def = SFX[name];
    if (!def) {
      this._warnOnce('sfx:' + name, 'AudioManager: unknown sfx "' + name + '"');
      return;
    }
    if (!this._ready() || this._muted) return;
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
