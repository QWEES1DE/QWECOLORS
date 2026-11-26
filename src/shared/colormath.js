/*
 * QWECOLORS — общая цветовая математика.
 * Один и тот же код используется:
 *   • в главном процессе (гамма-рампа видеокарты + цветовая матрица Windows Magnification API);
 *   • в окне предпросмотра (попиксельная обработка картинки).
 * Поэтому предпросмотр показывает ровно то, что потом будет на экране
 * (кроме цифровой вибрации — её делает драйвер GPU, в предпросмотре она аппроксимирована).
 *
 * Порядок обработки повторяет реальный конвейер Windows:
 *   1) цветовая матрица DWM (насыщенность)           — Magnification API
 *   2) цифровая вибрация                             — драйвер NVIDIA / AMD
 *   3) гамма-рампа (контраст, яркость, тени, температура) — LUT видеокарты на выходе
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QWEColorMath = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Диапазоны и значения «как в стоке» */
  const LIMITS = {
    vibrance:    { min: 0,    max: 100,   step: 1,    neutral: 50 },
    saturation:  { min: 0,    max: 300,   step: 1,    neutral: 100 },
    gamma:       { min: 0.5,  max: 2.5,   step: 0.01, neutral: 1.0 },
    shadowBoost: { min: 0,    max: 100,   step: 1,    neutral: 0 },
    contrast:    { min: -50,  max: 50,    step: 1,    neutral: 0 },
    brightness:  { min: -50,  max: 50,    step: 1,    neutral: 0 },
    temperature: { min: 3000, max: 10000, step: 100,  neutral: 6500 },
  };

  const KEYS = Object.keys(LIMITS);

  // Rec.709 / sRGB коэффициенты яркости
  const LR = 0.2126, LG = 0.7152, LB = 0.0722;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function neutralSettings() {
    const s = {};
    for (const k of KEYS) s[k] = LIMITS[k].neutral;
    return s;
  }

  /** Приводит произвольный объект к корректным настройкам (с ограничением диапазонов). */
  function sanitize(input) {
    const out = neutralSettings();
    if (!input || typeof input !== 'object') return out;
    for (const k of KEYS) {
      const v = Number(input[k]);
      if (Number.isFinite(v)) {
        const L = LIMITS[k];
        const stepped = Math.round(v / L.step) * L.step;
        out[k] = +clamp(stepped, L.min, L.max).toFixed(2);
      }
    }
    return out;
  }

  function isNeutral(s) {
    return KEYS.every((k) => Math.abs(s[k] - LIMITS[k].neutral) < 1e-6);
  }

  /* ---------------- Цветовая температура ---------------- */

  // Алгоритм Таннера Хелланда (аппроксимация планковского излучателя), 0..255
  function kelvinToRgbRaw(kelvin) {
    const t = clamp(kelvin, 1000, 40000) / 100;
    let r, g, b;
    if (t <= 66) {
      r = 255;
      g = 99.4708025861 * Math.log(t) - 161.1195681661;
      b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    } else {
      r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
      g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
      b = 255;
    }
    return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
  }

  const REF_6500 = kelvinToRgbRaw(6500);

  /** Множители каналов относительно 6500K; максимальный канал всегда = 1 (без пересвета). */
  function temperatureGains(kelvin) {
    if (Math.abs(kelvin - 6500) < 1) return [1, 1, 1];
    const raw = kelvinToRgbRaw(kelvin);
    const g = [raw[0] / REF_6500[0], raw[1] / REF_6500[1], raw[2] / REF_6500[2]];
    const m = Math.max(g[0], g[1], g[2]);
    return [g[0] / m, g[1] / m, g[2] / m];
  }

  /* ---------------- Тональная кривая (гамма-рампа) ---------------- */

  /**
   * Тональная функция для одного значения x ∈ [0..1] без температуры.
   * opts.skipLinear = true — пропустить контраст/яркость (если они ушли в матрицу).
   */
  function toneCurve(x, s, opts) {
    const skipLinear = opts && opts.skipLinear;
    if (!skipLinear) {
      // Контраст вокруг середины: ±50 → ×2 / ×0.5
      const k = Math.pow(2, s.contrast / 50);
      x = (x - 0.5) * k + 0.5;
      // Яркость: аддитивный сдвиг, ±50 → ±0.5
      x = x + s.brightness / 100;
      x = clamp(x, 0, 1);
    }
    // Тени (гамма): >1 высветляет тени, <1 затемняет
    if (s.gamma !== 1) x = Math.pow(x, 1 / s.gamma);
    // Усиление теней: подъём тёмных участков без пересвета светлых
    if (s.shadowBoost > 0) {
      const b = s.shadowBoost / 100;
      x = x + b * 1.5 * x * (1 - x) * (1 - x);
    }
    return clamp(x, 0, 1);
  }

  /**
   * Три LUT по 256 значений (0..1) — по одной на канал R, G, B.
   * opts.skipLinear — контраст/яркость/температура вынесены в матрицу (резервный режим).
   */
  function buildCurves(settings, opts) {
    const s = sanitize(settings);
    const skipLinear = !!(opts && opts.skipLinear);
    const gains = skipLinear ? [1, 1, 1] : temperatureGains(s.temperature);
    const r = new Float32Array(256), g = new Float32Array(256), b = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const v = toneCurve(i / 255, s, { skipLinear });
      r[i] = clamp(v * gains[0], 0, 1);
      g[i] = clamp(v * gains[1], 0, 1);
      b[i] = clamp(v * gains[2], 0, 1);
    }
    return { r, g, b };
  }

  /** LUT → массив WORD[3][256] для SetDeviceGammaRamp. */
  function curvesToGammaRamp(curves) {
    const ramp = new Uint16Array(768);
    for (let i = 0; i < 256; i++) {
      ramp[i] = Math.round(curves.r[i] * 65535);
      ramp[256 + i] = Math.round(curves.g[i] * 65535);
      ramp[512 + i] = Math.round(curves.b[i] * 65535);
    }
    return ramp;
  }

  function identityGammaRamp() {
    const ramp = new Uint16Array(768);
    for (let i = 0; i < 256; i++) {
      const v = i * 257;
      ramp[i] = v; ramp[256 + i] = v; ramp[512 + i] = v;
    }
    return ramp;
  }

  /* ---------------- Цветовые матрицы 5×5 (MAGCOLOREFFECT) ----------------
   * Windows применяет матрицу к вектору-строке [r g b a 1] × M,
   * т.е. M[строка = входной канал][столбец = выходной канал], сдвиг — в 5-й строке.
   */

  function identity5() {
    const m = new Float32Array(25);
    for (let i = 0; i < 5; i++) m[i * 5 + i] = 1;
    return m;
  }

  function multiply5(a, b) {
    // результат = a × b (сначала a, потом b — для векторов-строк)
    const out = new Float32Array(25);
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        let sum = 0;
        for (let k = 0; k < 5; k++) sum += a[i * 5 + k] * b[k * 5 + j];
        out[i * 5 + j] = sum;
      }
    }
    return out;
  }

  /** Матрица насыщенности: 100 → тождественная, 300 → ×3, 0 → ч/б. */
  function saturationMatrix(saturationPercent) {
    const s = saturationPercent / 100;
    const lum = [LR, LG, LB];
    const m = identity5();
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        m[i * 5 + j] = (1 - s) * lum[i] + (i === j ? s : 0);
      }
    }
    return m;
  }

  /** Аффинная матрица: контраст + яркость + температура (резервный режим, если гамма-рампа недоступна). */
  function linearMatrix(settings) {
    const s = sanitize(settings);
    const k = Math.pow(2, s.contrast / 50);
    const offset = 0.5 - 0.5 * k + s.brightness / 100;
    const gains = temperatureGains(s.temperature);
    const m = identity5();
    for (let c = 0; c < 3; c++) {
      m[c * 5 + c] = k * gains[c];
      m[4 * 5 + c] = offset * gains[c];
    }
    return m;
  }

  /** Итоговая матрица для Magnification API. */
  function buildColorMatrix(settings, opts) {
    const s = sanitize(settings);
    let m = saturationMatrix(s.saturation);
    if (opts && opts.includeLinear) m = multiply5(m, linearMatrix(s));
    return m;
  }

  function isIdentity5(m) {
    const id = identity5();
    for (let i = 0; i < 25; i++) if (Math.abs(m[i] - id[i]) > 1e-6) return false;
    return true;
  }

  /* ---------------- Цифровая вибрация (драйвер) ---------------- */

  /**
   * Перевод процента (как в панели NVIDIA: 50% = сток, 100% = максимум) в уровень DVC.
   * Если драйвер поддерживает расширенный диапазон (min < 0) — ниже 50% тоже работает.
   */
  function vibranceToNvLevel(percent, info) {
    const min = info ? info.minLevel : 0;
    const max = info ? info.maxLevel : 63;
    const def = info && Number.isFinite(info.defaultLevel) ? info.defaultLevel : 0;
    const p = clamp(percent, 0, 100);
    if (p >= 50) return Math.round(def + (max - def) * ((p - 50) / 50));
    if (min < def) return Math.round(def - (def - min) * ((50 - p) / 50));
    return def;
  }

  function nvLevelToVibrance(level, info) {
    const min = info ? info.minLevel : 0;
    const max = info ? info.maxLevel : 63;
    const def = info && Number.isFinite(info.defaultLevel) ? info.defaultLevel : 0;
    if (level >= def) return max === def ? 50 : Math.round(50 + 50 * (level - def) / (max - def));
    return min === def ? 50 : Math.round(50 - 50 * (def - level) / (def - min));
  }

  /** AMD ADL: насыщенность дисплея 0..200 (100 = сток). */
  function vibranceToAmd(percent, range) {
    const min = range ? range.min : 0;
    const max = range ? range.max : 200;
    const def = range ? range.def : 100;
    const p = clamp(percent, 0, 100);
    if (p >= 50) return Math.round(def + (max - def) * ((p - 50) / 50));
    return Math.round(def - (def - min) * ((50 - p) / 50));
  }

  /* ---------------- Обработка картинки (предпросмотр) ---------------- */

  /**
   * Применяет весь конвейер к RGBA-буферу (ImageData.data) на месте.
   * opts.vibranceApprox (по умолчанию true) — имитировать цифровую вибрацию драйвера.
   */
  function processPixels(data, settings, opts) {
    const s = sanitize(settings);
    const curves = buildCurves(s);
    const lutR = new Uint8ClampedArray(256), lutG = new Uint8ClampedArray(256), lutB = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      lutR[i] = Math.round(curves.r[i] * 255);
      lutG[i] = Math.round(curves.g[i] * 255);
      lutB[i] = Math.round(curves.b[i] * 255);
    }
    const sat = s.saturation / 100;
    const doSat = Math.abs(sat - 1) > 1e-4;
    const vib = (opts && opts.vibranceApprox === false) ? 0 : (s.vibrance - 50) / 50; // -1..1
    const doVib = Math.abs(vib) > 1e-4;

    for (let p = 0; p < data.length; p += 4) {
      let r = data[p] / 255, g = data[p + 1] / 255, b = data[p + 2] / 255;

      if (doSat) {
        const y = LR * r + LG * g + LB * b;
        r = y + (r - y) * sat; g = y + (g - y) * sat; b = y + (b - y) * sat;
        r = r < 0 ? 0 : r > 1 ? 1 : r;
        g = g < 0 ? 0 : g > 1 ? 1 : g;
        b = b < 0 ? 0 : b > 1 ? 1 : b;
      }

      if (doVib) {
        // Вибрация сильнее усиливает слабонасыщенные цвета и почти не трогает уже яркие
        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        const chroma = mx - mn;
        const k = vib > 0 ? 1 + vib * 1.6 * (1 - chroma) : 1 + vib;
        const y = LR * r + LG * g + LB * b;
        r = y + (r - y) * k; g = y + (g - y) * k; b = y + (b - y) * k;
        r = r < 0 ? 0 : r > 1 ? 1 : r;
        g = g < 0 ? 0 : g > 1 ? 1 : g;
        b = b < 0 ? 0 : b > 1 ? 1 : b;
      }

      data[p] = lutR[(r * 255 + 0.5) | 0];
      data[p + 1] = lutG[(g * 255 + 0.5) | 0];
      data[p + 2] = lutB[(b * 255 + 0.5) | 0];
    }
    return data;
  }

  return {
    LIMITS, KEYS, clamp, neutralSettings, sanitize, isNeutral,
    kelvinToRgbRaw, temperatureGains, toneCurve, buildCurves,
    curvesToGammaRamp, identityGammaRamp,
    identity5, multiply5, saturationMatrix, linearMatrix, buildColorMatrix, isIdentity5,
    vibranceToNvLevel, nvLevelToVibrance, vibranceToAmd,
    processPixels,
  };
});
