/*
 * Предпросмотр «ДО / ПОСЛЕ»: режимы «Сплит», «До», «После».
 * Обработка — та же цветовая математика, что и в движке (shared/colormath.js).
 */
(function () {
  'use strict';
  const CM = window.QWEColorMath;
  const MAX_W = 1120;

  class Preview {
    constructor({ compare, before, after, loading }) {
      this.compare = compare;
      this.before = before;
      this.after = after;
      this.loading = loading;
      this.source = null;
      this.settings = CM.neutralSettings();
      this.pending = false;
      this.x = 0.5;
      this.setMode('split');
      this._bindDrag();
    }

    setMode(mode) {
      this.mode = mode;
      this.compare.dataset.mode = mode;
    }

    _setX(x) {
      this.x = Math.min(1, Math.max(0, x));
      this.compare.style.setProperty('--x', (this.x * 100).toFixed(2) + '%');
    }

    _bindDrag() {
      let dragging = false;
      const fromEvent = (e) => {
        const r = this.compare.getBoundingClientRect();
        this._setX((e.clientX - r.left) / r.width);
      };
      this.compare.addEventListener('pointerdown', (e) => {
        if (this.mode !== 'split') return;
        dragging = true;
        this.compare.setPointerCapture(e.pointerId);
        fromEvent(e);
      });
      this.compare.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
      const stop = () => { dragging = false; };
      this.compare.addEventListener('pointerup', stop);
      this.compare.addEventListener('pointercancel', stop);
      this.compare.tabIndex = 0;
      this.compare.addEventListener('keydown', (e) => {
        if (this.mode !== 'split') return;
        if (e.key === 'ArrowLeft') this._setX(this.x - 0.05);
        if (e.key === 'ArrowRight') this._setX(this.x + 0.05);
      });
      this._setX(0.5);
    }

    /** Загружает картинку (URL / dataURL), кадрирует в 16:9. */
    load(src) {
      this.loading.hidden = false;
      this.loading.textContent = 'Загрузка…';
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const ratio = 16 / 9;
          let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
          if (sw / sh > ratio) { const nw = sh * ratio; sx = (sw - nw) / 2; sw = nw; }
          else { const nh = sw / ratio; sy = (sh - nh) / 2; sh = nh; }
          const w = Math.min(MAX_W, Math.round(sw));
          const h = Math.round(w / ratio);
          for (const c of [this.before, this.after]) { c.width = w; c.height = h; }
          const ctx = this.before.getContext('2d', { willReadFrequently: true });
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
          this.source = ctx.getImageData(0, 0, w, h);
          this.loading.hidden = true;
          this.render(this.settings, true);
          resolve();
        };
        img.onerror = () => {
          this.loading.textContent = 'Не удалось загрузить картинку';
          reject(new Error('image load failed'));
        };
        img.src = src;
      });
    }

    render(settings, immediate) {
      this.settings = settings;
      if (!this.source) return;
      if (immediate) { this._draw(); return; }
      if (this.pending) return;
      this.pending = true;
      requestAnimationFrame(() => { this.pending = false; this._draw(); });
    }

    _draw() {
      const src = this.source;
      const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
      CM.processPixels(out.data, this.settings);
      this.after.getContext('2d').putImageData(out, 0, 0);
    }
  }

  window.QWEPreview = Preview;
})();
