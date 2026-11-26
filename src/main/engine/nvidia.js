'use strict';
/*
 * Цифровая вибрация NVIDIA (Digital Vibrance Control) через nvapi64.dll.
 * Это то же самое, что ползунок «Цифровая вибрация» в Панели управления NVIDIA:
 * работает на уровне драйвера, в том числе в полноэкранных играх.
 */
const CM = require('../../shared/colormath');

const IDS = {
  Initialize: 0x0150E828,
  EnumNvidiaDisplayHandle: 0x9ABDD40D,
  GetDVCInfo: 0x4085DE45,
  SetDVCLevel: 0x172409B4,
  GetDVCInfoEx: 0x0E45002D,
  SetDVCLevelEx: 0x4A82C2B1,
};

const NVAPI_OK = 0;

class NvidiaVibrance {
  constructor() {
    this.available = false;
    this.displays = []; // [{ handle: BigInt, info, original }]
    this.lastError = null;
    this.target = null;
  }

  init() {
    if (process.platform !== 'win32') { this.lastError = 'не Windows'; return false; }
    try {
      const koffi = require('koffi');
      let lib;
      try { lib = koffi.load(process.arch === 'ia32' ? 'nvapi.dll' : 'nvapi64.dll'); }
      catch (_) { this.lastError = 'драйвер NVIDIA не найден'; return false; }

      const qi = lib.func('void * __cdecl nvapi_QueryInterface(uint32_t id)');
      const get = (id, proto) => {
        const p = qi(id >>> 0);
        return p ? koffi.decode(p, koffi.proto(proto)) : null;
      };
      const uid = () => 'nv_' + Math.random().toString(36).slice(2);

      this.fn = {
        Initialize: get(IDS.Initialize, `int ${uid()}()`),
        EnumDisplay: get(IDS.EnumNvidiaDisplayHandle, `int ${uid()}(int index, void *handle)`),
        GetDVCInfo: get(IDS.GetDVCInfo, `int ${uid()}(uint64_t handle, uint32_t outputId, void *info)`),
        SetDVCLevel: get(IDS.SetDVCLevel, `int ${uid()}(uint64_t handle, uint32_t outputId, int level)`),
        GetDVCInfoEx: get(IDS.GetDVCInfoEx, `int ${uid()}(uint64_t handle, uint32_t outputId, void *info)`),
        SetDVCLevelEx: get(IDS.SetDVCLevelEx, `int ${uid()}(uint64_t handle, uint32_t outputId, void *info)`),
      };
      if (!this.fn.Initialize || !this.fn.EnumDisplay || !this.fn.GetDVCInfo || !this.fn.SetDVCLevel) {
        this.lastError = 'NVAPI не поддерживает DVC';
        return false;
      }
      const st = this.fn.Initialize();
      if (st !== NVAPI_OK) { this.lastError = 'NvAPI_Initialize: ' + st; return false; }

      this.displays = [];
      for (let i = 0; i < 16; i++) {
        const hb = Buffer.alloc(8);
        if (this.fn.EnumDisplay(i, hb) !== NVAPI_OK) break;
        const handle = hb.readBigUInt64LE(0);
        const info = this._getInfo(handle);
        if (info) this.displays.push({ handle, info, original: info.currentLevel });
      }
      this.available = this.displays.length > 0;
      if (!this.available) this.lastError = 'мониторы NVIDIA не найдены';
      return this.available;
    } catch (e) {
      this.lastError = e.message;
      this.available = false;
      return false;
    }
  }

  _getInfo(handle) {
    if (this.fn.GetDVCInfoEx) {
      const b = Buffer.alloc(20);
      b.writeUInt32LE(20 | (1 << 16), 0);
      if (this.fn.GetDVCInfoEx(handle, 0, b) === NVAPI_OK) {
        const info = { ex: true, currentLevel: b.readInt32LE(4), minLevel: b.readInt32LE(8), maxLevel: b.readInt32LE(12), defaultLevel: b.readInt32LE(16) };
        if (info.maxLevel > info.minLevel) return info;
      }
    }
    const b = Buffer.alloc(16);
    b.writeUInt32LE(16 | (1 << 16), 0);
    if (this.fn.GetDVCInfo(handle, 0, b) !== NVAPI_OK) return null;
    return { ex: false, currentLevel: b.readInt32LE(4), minLevel: b.readInt32LE(8), maxLevel: b.readInt32LE(12), defaultLevel: b.readInt32LE(8) };
  }

  _setLevel(d, level) {
    if (d.info.ex && this.fn.SetDVCLevelEx) {
      const b = Buffer.alloc(20);
      b.writeUInt32LE(20 | (1 << 16), 0);
      b.writeInt32LE(level, 4);
      b.writeInt32LE(d.info.minLevel, 8);
      b.writeInt32LE(d.info.maxLevel, 12);
      b.writeInt32LE(d.info.defaultLevel, 16);
      if (this.fn.SetDVCLevelEx(d.handle, 0, b) === NVAPI_OK) return true;
    }
    return this.fn.SetDVCLevel(d.handle, 0, level) === NVAPI_OK;
  }

  /** @param {number} percent 0..100 (50 = сток) */
  apply(percent) {
    if (!this.available) return { ok: false, error: this.lastError };
    this.target = percent;
    let ok = 0;
    for (const d of this.displays) {
      const level = CM.vibranceToNvLevel(percent, d.info);
      try { if (this._setLevel(d, level)) ok++; } catch (_) { /* ignore */ }
    }
    return { ok: ok === this.displays.length, applied: ok, total: this.displays.length };
  }

  /** Возвращает вибрацию, если её сбросил драйвер/игра. */
  enforce() {
    if (!this.available || this.target == null) return 0;
    let fixed = 0;
    for (const d of this.displays) {
      try {
        const info = this._getInfo(d.handle);
        const want = CM.vibranceToNvLevel(this.target, d.info);
        if (info && info.currentLevel !== want && this._setLevel(d, want)) fixed++;
      } catch (_) { /* ignore */ }
    }
    return fixed;
  }

  restore() {
    this.target = null;
    if (!this.available) return;
    for (const d of this.displays) {
      try { this._setLevel(d, d.original); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = { NvidiaVibrance };
