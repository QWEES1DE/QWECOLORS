'use strict';
/*
 * Гамма-рампа видеокарты (SetDeviceGammaRamp) — по каждому монитору.
 * Отвечает за контраст, яркость, тени (гамму), усиление теней и цветовую температуру.
 * Работает и в полноэкранных играх; игры иногда сбрасывают рампу — её восстанавливает watchdog.
 */
const win32 = require('./win32');
const CM = require('../../shared/colormath');

class GammaController {
  constructor() {
    this.displays = [];
    this.target = null;      // Uint16Array(768) — то, что должно стоять на экране
    this.original = new Map(); // name -> исходная рампа (для восстановления)
    this.lastError = null;
  }

  refreshDisplays() {
    try {
      this.displays = win32.listDisplays();
    } catch (e) {
      this.displays = [];
      this.lastError = e.message;
    }
    if (!this.displays.length) this.displays = [{ name: null, primary: true, description: 'Основной экран' }];
    return this.displays;
  }

  _withDC(display, fn) {
    const w = win32.load();
    if (display.name) {
      const hdc = w.CreateDCW('DISPLAY', display.name, null, null);
      if (!hdc) throw new Error('CreateDC failed for ' + display.name);
      try { return fn(hdc); } finally { w.DeleteDC(hdc); }
    }
    const hdc = w.GetDC(null);
    try { return fn(hdc); } finally { w.ReleaseDC(null, hdc); }
  }

  _read(display) {
    const w = win32.load();
    return this._withDC(display, (hdc) => {
      const ramp = new Uint16Array(768);
      return w.GetDeviceGammaRamp(hdc, ramp) ? ramp : null;
    });
  }

  _write(display, ramp) {
    const w = win32.load();
    return this._withDC(display, (hdc) => !!w.SetDeviceGammaRamp(hdc, ramp));
  }

  /** Запоминает исходные рампы (один раз за сессию), чтобы корректно вернуть всё при выходе. */
  captureOriginals() {
    if (!this.displays.length) this.refreshDisplays();
    for (const d of this.displays) {
      const key = d.name || 'primary';
      if (this.original.has(key)) continue;
      try {
        const r = this._read(d);
        // Если рампа уже «испорчена» прошлым запуском — восстанавливать будем в линейную
        if (r) this.original.set(key, looksLinearish(r) ? r : CM.identityGammaRamp());
      } catch (_) { /* ignore */ }
    }
  }

  /**
   * Применяет рампу ко всем мониторам.
   * @returns {{ ok: boolean, applied: number, total: number, error?: string }}
   */
  apply(ramp) {
    this.target = ramp;
    if (!this.displays.length) this.refreshDisplays();
    let applied = 0;
    const errors = [];
    for (const d of this.displays) {
      try {
        if (this._write(d, ramp)) applied++;
        else errors.push((d.name || 'экран') + ': Windows отклонил гамма-рампу');
      } catch (e) {
        errors.push((d.name || 'экран') + ': ' + e.message);
      }
    }
    this.lastError = errors.length ? errors.join('; ') : null;
    return { ok: applied > 0 && errors.length === 0, applied, total: this.displays.length, error: this.lastError };
  }

  /** Проверяет, не сбросила ли игра/система рампу, и при необходимости восстанавливает. */
  enforce() {
    if (!this.target) return 0;
    let fixed = 0;
    for (const d of this.displays) {
      try {
        const cur = this._read(d);
        if (cur && !rampsClose(cur, this.target)) {
          if (this._write(d, this.target)) fixed++;
        }
      } catch (_) { /* монитор мог отключиться */ }
    }
    return fixed;
  }

  restore() {
    this.target = null;
    for (const d of this.displays) {
      const key = d.name || 'primary';
      const ramp = this.original.get(key) || CM.identityGammaRamp();
      try { this._write(d, ramp); } catch (_) { /* ignore */ }
    }
  }
}

function rampsClose(a, b) {
  for (let i = 0; i < 768; i += 3) {
    if (Math.abs(a[i] - b[i]) > 300) return false;
  }
  return true;
}

function looksLinearish(r) {
  for (let i = 0; i < 256; i += 8) {
    for (let c = 0; c < 3; c++) {
      if (Math.abs(r[c * 256 + i] - i * 257) > 6000) return false;
    }
  }
  return true;
}

module.exports = { GammaController };
