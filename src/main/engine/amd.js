'use strict';
/*
 * Насыщенность дисплея AMD (аналог цифровой вибрации) через AMD Display Library (atiadlxx.dll).
 */
const CM = require('../../shared/colormath');

const ADL_OK = 0;
const ADL_DISPLAY_COLOR_SATURATION = 1 << 2;

class AmdVibrance {
  constructor() {
    this.available = false;
    this.displays = []; // [{ adapter, display, range: {min,max,def}, original }]
    this.lastError = null;
    this.target = null;
  }

  init() {
    if (process.platform !== 'win32') { this.lastError = 'не Windows'; return false; }
    try {
      const koffi = require('koffi');
      let lib;
      try { lib = koffi.load(process.arch === 'ia32' ? 'atiadlxy.dll' : 'atiadlxx.dll'); }
      catch (_) { this.lastError = 'драйвер AMD не найден'; return false; }

      this.fn = {
        Create: lib.func('int ADL_Main_Control_Create(void *mallocCallback, int enumConnected)'),
        Destroy: lib.func('int ADL_Main_Control_Destroy()'),
        NumAdapters: lib.func('int ADL_Adapter_NumberOfAdapters_Get(_Out_ int *count)'),
        ColorGet: lib.func('int ADL_Display_Color_Get(int adapter, int display, int type, _Out_ int *cur, _Out_ int *def, _Out_ int *min, _Out_ int *max, _Out_ int *step)'),
        ColorSet: lib.func('int ADL_Display_Color_Set(int adapter, int display, int type, int value)'),
      };

      // ADL просит функцию выделения памяти — отдаём ей malloc из msvcrt
      const w = require('./win32').load();
      let crt = w.GetModuleHandleW('msvcrt.dll');
      if (!crt) crt = w.LoadLibraryW('msvcrt.dll');
      const mallocPtr = crt ? w.GetProcAddress(crt, 'malloc') : null;
      if (!mallocPtr) { this.lastError = 'malloc не найден'; return false; }

      if (this.fn.Create(mallocPtr, 1) !== ADL_OK) { this.lastError = 'ADL_Main_Control_Create: ошибка'; return false; }

      const count = [0];
      this.fn.NumAdapters(count);
      this.displays = [];
      for (let a = 0; a < Math.min(count[0], 64); a++) {
        for (let d = 0; d < 8; d++) {
          const cur = [0], def = [0], min = [0], max = [0], step = [0];
          if (this.fn.ColorGet(a, d, ADL_DISPLAY_COLOR_SATURATION, cur, def, min, max, step) === ADL_OK && max[0] > min[0]) {
            this.displays.push({ adapter: a, display: d, range: { min: min[0], max: max[0], def: def[0] }, original: cur[0] });
          }
        }
      }
      this.available = this.displays.length > 0;
      if (!this.available) this.lastError = 'мониторы AMD не найдены';
      return this.available;
    } catch (e) {
      this.lastError = e.message;
      this.available = false;
      return false;
    }
  }

  apply(percent) {
    if (!this.available) return { ok: false, error: this.lastError };
    this.target = percent;
    let ok = 0;
    for (const d of this.displays) {
      const v = CM.vibranceToAmd(percent, d.range);
      try { if (this.fn.ColorSet(d.adapter, d.display, ADL_DISPLAY_COLOR_SATURATION, v) === ADL_OK) ok++; } catch (_) { /* ignore */ }
    }
    return { ok: ok === this.displays.length, applied: ok, total: this.displays.length };
  }

  enforce() {
    if (!this.available || this.target == null) return 0;
    let fixed = 0;
    for (const d of this.displays) {
      const want = CM.vibranceToAmd(this.target, d.range);
      const cur = [0], def = [0], min = [0], max = [0], step = [0];
      try {
        if (this.fn.ColorGet(d.adapter, d.display, ADL_DISPLAY_COLOR_SATURATION, cur, def, min, max, step) === ADL_OK && cur[0] !== want) {
          if (this.fn.ColorSet(d.adapter, d.display, ADL_DISPLAY_COLOR_SATURATION, want) === ADL_OK) fixed++;
        }
      } catch (_) { /* ignore */ }
    }
    return fixed;
  }

  restore() {
    this.target = null;
    if (!this.available) return;
    for (const d of this.displays) {
      try { this.fn.ColorSet(d.adapter, d.display, ADL_DISPLAY_COLOR_SATURATION, d.original); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = { AmdVibrance };
