'use strict';
/*
 * ColorEngine — собирает все механизмы вместе:
 *   • MagnifierController — цветовая матрица (насыщенность до 300%)
 *   • GammaController     — гамма-рампа (контраст, яркость, тени, температура)
 *   • NvidiaVibrance / AmdVibrance — цифровая вибрация драйвера
 * и следит, чтобы картинка не слетала после Alt+Tab, смены режима игры и т.п.
 */
const CM = require('../../shared/colormath');

const IS_WIN = process.platform === 'win32';

class ColorEngine {
  constructor({ log } = {}) {
    this.log = log || (() => {});
    this.settings = CM.neutralSettings();
    this.active = false;
    this.mode = 'normal'; // normal | fallback (контраст/яркость через матрицу)
    this.status = {
      platform: process.platform,
      simulated: !IS_WIN,
      gamma: { ok: false, monitors: 0, error: null, mode: 'ramp' },
      matrix: { ok: false, error: null },
      vibrance: { vendor: null, ok: false, error: null, displays: 0 },
    };
    this.watchdog = null;
  }

  init() {
    if (!IS_WIN) {
      this.status.gamma.error = 'Движок работает только в Windows — сейчас режим предпросмотра';
      this.status.matrix.error = this.status.gamma.error;
      this.status.vibrance.error = this.status.gamma.error;
      return this.status;
    }
    const { GammaController } = require('./gamma');
    const { MagnifierController } = require('./magnifier');
    const { NvidiaVibrance } = require('./nvidia');
    const { AmdVibrance } = require('./amd');

    this.gamma = new GammaController();
    this.magnifier = new MagnifierController();
    try {
      this.gamma.refreshDisplays();
      this.gamma.captureOriginals();
    } catch (e) {
      this.log('gamma init error', e);
    }
    this.status.gamma.monitors = this.gamma.displays.length;

    const nv = new NvidiaVibrance();
    if (nv.init()) {
      this.vibrance = nv;
      this.status.vibrance = { vendor: 'NVIDIA', ok: true, error: null, displays: nv.displays.length };
    } else {
      const amd = new AmdVibrance();
      if (amd.init()) {
        this.vibrance = amd;
        this.status.vibrance = { vendor: 'AMD', ok: true, error: null, displays: amd.displays.length };
      } else {
        this.vibrance = null;
        this.status.vibrance = {
          vendor: null, ok: false, displays: 0,
          error: 'Вибрация драйвера недоступна (нужна видеокарта NVIDIA или AMD). NVIDIA: ' + nv.lastError + '; AMD: ' + amd.lastError,
        };
      }
    }
    this.log('engine init', JSON.stringify(this.status));
    return this.status;
  }

  /** Применить настройки. active=false — вернуть экран в сток (но запомнить настройки). */
  apply(settings, active) {
    this.settings = CM.sanitize(settings);
    this.active = !!active;
    if (!IS_WIN) return this.status;

    const s = this.active ? this.settings : CM.neutralSettings();

    // 1) гамма-рампа
    let includeLinear = false;
    if (this.active) {
      const ramp = CM.curvesToGammaRamp(CM.buildCurves(s));
      let r = this.gamma.apply(ramp);
      if (!r.ok) {
        // Windows ограничивает «крутые» рампы. Переносим контраст/яркость/температуру в матрицу.
        includeLinear = true;
        const ramp2 = CM.curvesToGammaRamp(CM.buildCurves(s, { skipLinear: true }));
        const r2 = this.gamma.apply(ramp2);
        if (!r2.ok) this.gamma.apply(CM.identityGammaRamp());
        this.status.gamma = {
          ok: r2.ok, monitors: this.gamma.displays.length, mode: 'fallback',
          error: r2.ok
            ? 'Контраст/яркость/температура переведены в цветовую матрицу (Windows ограничил гамма-рампу)'
            : 'Windows отклонил гамма-рампу: тени не применяются. Снимите ограничение в настройках.',
        };
      } else {
        this.status.gamma = { ok: true, monitors: this.gamma.displays.length, mode: 'ramp', error: null };
      }
    } else {
      this.gamma.restore();
      this.status.gamma = { ok: true, monitors: this.gamma.displays.length, mode: 'off', error: null };
    }
    this.mode = includeLinear ? 'fallback' : 'normal';

    // 2) цветовая матрица
    const matrix = CM.buildColorMatrix(s, { includeLinear });
    const m = this.magnifier.apply(matrix);
    this.status.matrix = { ok: m.ok, error: m.ok ? null : m.error };

    // 3) вибрация
    if (this.vibrance) {
      if (this.active) {
        const v = this.vibrance.apply(s.vibrance);
        this.status.vibrance.ok = v.ok;
        this.status.vibrance.error = v.ok ? null : 'Драйвер не принял значение вибрации';
      } else {
        this.vibrance.restore();
        this.status.vibrance.ok = true;
        this.status.vibrance.error = null;
      }
    }
    return this.status;
  }

  /** Периодическая проверка: игры и Alt+Tab любят сбрасывать гамму и вибрацию. */
  startWatchdog(intervalMs = 2000) {
    this.stopWatchdog();
    if (!IS_WIN) return;
    this.watchdog = setInterval(() => {
      if (!this.active) return;
      try {
        const g = this.gamma.enforce();
        const v = this.vibrance ? this.vibrance.enforce() : 0;
        if (g || v) this.log(`watchdog: восстановлено гамма=${g} вибрация=${v}`);
      } catch (e) {
        this.log('watchdog error', e);
      }
    }, intervalMs);
  }

  stopWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  /** Подключили/отключили монитор. */
  onDisplaysChanged() {
    if (!IS_WIN || !this.gamma) return;
    this.gamma.refreshDisplays();
    this.gamma.captureOriginals();
    this.apply(this.settings, this.active);
  }

  /** Полностью вернуть экран в исходное состояние. */
  shutdown() {
    this.stopWatchdog();
    if (!IS_WIN) return;
    try { this.gamma && this.gamma.restore(); } catch (_) { /* ignore */ }
    try { this.magnifier && this.magnifier.restore(); } catch (_) { /* ignore */ }
    try { this.vibrance && this.vibrance.restore(); } catch (_) { /* ignore */ }
  }
}

module.exports = { ColorEngine };
