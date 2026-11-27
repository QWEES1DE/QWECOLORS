/*
 * Вертикальный фейдер для микшера QWECOLORS.
 * Мышь/тач — перетаскивание, колесо — шаг, клавиши ↑↓ PgUp PgDn Home End, двойной клик — нейтраль.
 * Заливка идёт от нейтрального значения к текущему (двухсторонняя для контраста, яркости и т.п.).
 */
(function () {
  'use strict';

  class Fader {
    constructor({ min, max, step, neutral, value, className, label, onInput }) {
      Object.assign(this, { min, max, step, neutral });
      this.onInput = onInput || (() => {});
      this.value = value != null ? value : neutral;

      const el = document.createElement('div');
      el.className = 'fader' + (className ? ' ' + className : '');
      el.tabIndex = 0;
      el.setAttribute('role', 'slider');
      el.setAttribute('aria-orientation', 'vertical');
      el.setAttribute('aria-label', label || '');
      el.setAttribute('aria-valuemin', min);
      el.setAttribute('aria-valuemax', max);
      el.innerHTML =
        '<div class="fader-ticks"></div>' +
        '<div class="fader-area">' +
          '<div class="fader-track"><div class="fader-fill"></div></div>' +
          '<div class="fader-zero"></div>' +
          '<div class="fader-cap"></div>' +
        '</div>';
      this.el = el;
      this.area = el.querySelector('.fader-area');
      this.fill = el.querySelector('.fader-fill');
      this.zero = el.querySelector('.fader-zero');
      this.cap = el.querySelector('.fader-cap');
      this.dragging = false;

      this._bind();
      this.set(this.value);
    }

    _t(v) { return (v - this.min) / (this.max - this.min); }

    _snap(v) {
      const s = Math.round((v - this.min) / this.step) * this.step + this.min;
      const c = Math.min(this.max, Math.max(this.min, s));
      return +c.toFixed(4);
    }

    /** Установить значение без вызова onInput */
    set(v) {
      this.value = this._snap(v);
      const t = this._t(this.value);
      const t0 = this._t(this.neutral);
      this.cap.style.bottom = (t * 100) + '%';
      this.zero.style.bottom = (t0 * 100) + '%';
      this.fill.style.bottom = (Math.min(t, t0) * 100) + '%';
      this.fill.style.height = (Math.abs(t - t0) * 100) + '%';
      this.el.setAttribute('aria-valuenow', this.value);
    }

    _emit(v) {
      const prev = this.value;
      this.set(v);
      if (this.value !== prev) this.onInput(this.value);
    }

    _fromPointer(clientY) {
      const r = this.area.getBoundingClientRect();
      const t = 1 - (clientY - r.top) / r.height;
      return this.min + Math.min(1, Math.max(0, t)) * (this.max - this.min);
    }

    _bind() {
      const el = this.el;
      let grabOffset = 0;
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        el.focus();
        this.dragging = true;
        el.classList.add('drag');
        el.setPointerCapture(e.pointerId);
        // Если схватили за колпачок — не прыгаем, а двигаем относительно точки захвата
        const capRect = this.cap.getBoundingClientRect();
        const onCap = e.clientY >= capRect.top - 2 && e.clientY <= capRect.bottom + 2;
        grabOffset = onCap ? e.clientY - (capRect.top + capRect.height / 2) : 0;
        this._emit(this._fromPointer(e.clientY - grabOffset));
      });
      el.addEventListener('pointermove', (e) => {
        if (!this.dragging) return;
        this._emit(this._fromPointer(e.clientY - grabOffset));
      });
      const end = () => { this.dragging = false; el.classList.remove('drag'); };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', end);

      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        this._emit(this.value + dir * this.step * (e.shiftKey ? 10 : 1));
      }, { passive: false });

      el.addEventListener('keydown', (e) => {
        const big = (this.max - this.min) / 10;
        const map = {
          ArrowUp: this.value + this.step, ArrowRight: this.value + this.step,
          ArrowDown: this.value - this.step, ArrowLeft: this.value - this.step,
          PageUp: this.value + big, PageDown: this.value - big,
          Home: this.min, End: this.max,
        };
        if (e.key in map) { e.preventDefault(); this._emit(map[e.key]); }
      });

      el.addEventListener('dblclick', () => this._emit(this.neutral));
    }
  }

  window.QWEFader = Fader;
})();
