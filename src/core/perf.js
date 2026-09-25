// Автонастройка качества: стартовая ступень по видеокарте + губернатор FPS с гистерезисом.
// Все ступени применяются на лету, без перекомпиляции шейдеров (см. Renderer.applyLevel).

/** Лестница качества: 0 — лучшее; каждая следующая ступень заметно дешевле для GPU. */
export const PERF_LEVELS = [
  { name: 'Ультра', scale: 1, msaa: 4, bloomScale: 1, shadows: true, shadowSize: 2048, shadowEvery: 1, particles: 1 },
  { name: 'Высокое', scale: 1, msaa: 2, bloomScale: 1, shadows: true, shadowSize: 2048, shadowEvery: 1, particles: 1 },
  { name: 'Высокое−', scale: 1, msaa: 2, bloomScale: 0.5, shadows: true, shadowSize: 2048, shadowEvery: 1, particles: 1 },
  // тени раз в 2 кадра — у машинок круглые тени (иначе их тень дёргалась бы на скорости)
  { name: 'Среднее', scale: 0.85, msaa: 2, bloomScale: 0.5, shadows: true, shadowSize: 1024, shadowEvery: 2, particles: 0.75 },
  { name: 'Среднее−', scale: 0.75, msaa: 0, bloomScale: 0.5, shadows: true, shadowSize: 1024, shadowEvery: 2, particles: 0.75 },
  // на неоне свечение и есть картинка — оставляем дешёвый bloom в четверть разрешения
  { name: 'Низкое', scale: 0.7, msaa: 0, bloomScale: 0, glowBloom: 0.5, shadows: false, shadowSize: 1024, shadowEvery: 1, particles: 0.5 },
  { name: 'Низкое−', scale: 0.55, msaa: 0, bloomScale: 0, shadows: false, shadowSize: 1024, shadowEvery: 1, particles: 0.35 },
];

/** Грубый класс GPU до первого кадра: 0 — программный рендер, 1 — слабая встройка/телефон, 2 — средняя, 3 — дискретная. */
export function detectGpuTier(gl) {
  let gpu = '';
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
  } catch {
    /* браузер скрывает имя — останется '' */
  }
  const s = gpu.toLowerCase();
  const ua = navigator.userAgent;
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  let tier;
  if (/swiftshader|llvmpipe|softpipe|basic render|software/.test(s)) tier = 0;
  else if (/nvidia|geforce|quadro|rtx|gtx|radeon rx|radeon pro|\brx \d{3,4}|arc\(tm\) a|\barc a\d/.test(s)) tier = 3;
  else if (/apple m\d (pro|max|ultra)/.test(s)) tier = 3;
  else if (/apple m\d|iris\(r\) xe|iris xe|radeon\(tm\) [67][68]0m|radeon [67][68]0m|adreno \(tm\) [78]\d\d/.test(s)) tier = 2;
  else if (/intel|uhd|hd graphics|iris|radeon|vega|mali|adreno|powervr|apple/.test(s)) tier = 1;
  else tier = mobile ? 1 : 2; // имя скрыто (Firefox/Safari) — середина, губернатор поправит
  if (mobile) tier = Math.min(tier, 1);
  if ((navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4) tier = Math.min(tier, 2);
  if (window.screen.width * window.screen.height * (window.devicePixelRatio || 1) ** 2 > 7e6) tier = Math.max(0, tier - 1);
  return { tier, gpu };
}

export function startLevelForTier(tier) {
  return [6, 4, 2, 0][tier] ?? 2;
}

const WINDOW = 1.5; // с — окно усреднения
const LONG = 1 / 40; // "длинный" кадр

/**
 * Губернатор FPS: кормится "сырым" dt кадра. Вниз — быстро (два плохих окна подряд или одно очень плохое),
 * вверх — медленно (20 с стабильно хороших кадров), а если подъём не удался — ждём вдвое дольше.
 */
export class PerfGovernor {
  constructor({ level = 2, onChange = () => {} } = {}) {
    this.level = level;
    this.maxLevel = PERF_LEVELS.length - 1;
    this.onChange = onChange;
    this.enabled = true;
    this.target = 1 / 60;
    this.buf = [];
    this.acc = 0;
    this.badRun = 0;
    this.goodTime = 0;
    this.settleUntil = 0;
    this.lastUpAt = -1e9;
    this.upDelay = {}; // ступень → сколько секунд "хорошо" нужно, чтобы на неё подняться
  }

  now() {
    return performance.now() / 1000;
  }

  /** Не судить ближайшее время (загрузка трассы, ресайз, смена ступени). */
  settle(sec = 1.5) {
    this.settleUntil = Math.max(this.settleUntil, this.now() + sec);
    this.buf.length = 0;
    this.acc = 0;
  }

  sample(dt) {
    if (!this.enabled || !(dt > 0)) return;
    if (dt > 0.25) return this.settle(0.5); // фоновая вкладка, сборка мусора, alert — не про видеокарту
    const t = this.now();
    if (t < this.settleUntil) return;
    this.buf.push(dt);
    this.acc += dt;
    if (this.acc < WINDOW) return;

    const n = this.buf.length;
    const mean = this.acc / n;
    let long = 0;
    let dev = 0;
    let worst = 0;
    for (const d of this.buf) {
      if (d > LONG) long++;
      dev += (d - mean) ** 2;
      if (d > worst) worst = d;
    }
    this.buf.length = 0;
    this.acc = 0;
    // идеально ровные кадры реже 60 Гц (экран 48/50 Гц) — это частота экрана, а не нехватка GPU
    // (не быстрее 60 Гц: на мониторах 120/144 Гц "не дотянули до частоты экрана" — это не повод снижать качество)
    if (Math.sqrt(dev / n) / mean < 0.03 && worst < 1.5 / 60 && mean <= 1 / 48) this.target = Math.max(1 / 60, mean);
    const T = this.target;
    const bad = mean > T * 1.1 || long / n > 0.08;
    const good = mean < T * 1.026 && long / n < 0.02;
    this.badRun = bad ? this.badRun + 1 : 0;
    this.goodTime = good ? this.goodTime + WINDOW : 0;

    const drop = mean > 1 / 28 ? 2 : mean > 1 / 38 || this.badRun >= 2 ? 1 : 0;
    if (drop && this.level < this.maxLevel) {
      // упали сразу после подъёма — подъём был ошибкой: в следующий раз ждать вдвое дольше
      if (t - this.lastUpAt < 8) this.upDelay[this.level] = Math.min(300, (this.upDelay[this.level] ?? 20) * 2);
      this.setLevel(this.level + drop);
    } else if (this.level > 0 && this.goodTime >= (this.upDelay[this.level - 1] ?? 20)) {
      this.lastUpAt = t;
      this.setLevel(this.level - 1);
    }
  }

  setLevel(l) {
    l = Math.max(0, Math.min(this.maxLevel, l));
    if (l === this.level) return;
    this.level = l;
    this.badRun = 0;
    this.goodTime = 0;
    this.settle(1); // пересоздание буферов даёт один длинный кадр — его не считаем
    this.onChange(l);
  }
}
