'use strict';
/*
 * Полноэкранная цветовая матрица Windows (Magnification API, Windows 8+).
 * Даёт насыщенность до 300% для всего рабочего стола, окон и игр в оконном/безрамочном режиме.
 * Матрица живёт, пока жив процесс: при выходе — MagUninitialize, и экран возвращается в норму.
 */
const CM = require('../../shared/colormath');

class MagnifierController {
  constructor() {
    this.lib = null;
    this.initialized = false;
    this.current = null;
    this.lastError = null;
  }

  _load() {
    if (this.lib) return this.lib;
    if (process.platform !== 'win32') throw new Error('Magnification API доступен только в Windows');
    if (process.arch === 'ia32' && process.env.PROCESSOR_ARCHITEW6432) {
      throw new Error('Magnification API не работает в 32-битном процессе на 64-битной Windows');
    }
    const koffi = require('koffi');
    const mag = koffi.load('Magnification.dll');
    this.lib = {
      MagInitialize: mag.func('int __stdcall MagInitialize()'),
      MagUninitialize: mag.func('int __stdcall MagUninitialize()'),
      MagSetFullscreenColorEffect: mag.func('int __stdcall MagSetFullscreenColorEffect(void *effect)'),
    };
    return this.lib;
  }

  _ensureInit() {
    const lib = this._load();
    if (!this.initialized) {
      if (!lib.MagInitialize()) throw new Error('MagInitialize вернул ошибку (возможно, запущена Экранная лупа)');
      this.initialized = true;
    }
    return lib;
  }

  /** @param {Float32Array} matrix 5×5 */
  apply(matrix) {
    try {
      if (CM.isIdentity5(matrix) && !this.initialized) {
        this.current = matrix;
        this.lastError = null;
        return { ok: true };
      }
      const lib = this._ensureInit();
      const buf = new Float32Array(matrix); // копия, порядок — строки
      if (!lib.MagSetFullscreenColorEffect(buf)) throw new Error('MagSetFullscreenColorEffect вернул ошибку');
      this.current = matrix;
      this.lastError = null;
      return { ok: true };
    } catch (e) {
      this.lastError = e.message;
      return { ok: false, error: e.message };
    }
  }

  restore() {
    if (!this.lib || !this.initialized) return;
    try {
      this.lib.MagSetFullscreenColorEffect(CM.identity5());
      this.lib.MagUninitialize();
    } catch (_) { /* ignore */ }
    this.initialized = false;
    this.current = null;
  }
}

module.exports = { MagnifierController };
