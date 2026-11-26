/*
 * Предпросмотр «СТОК | QWECOLORS» с перетаскиваемым разделителем.
 * Обработка — та же цветовая математика, что и в движке (shared/colormath.js).
 */
(function () {
  'use strict';
  const CM = window.QWEColorMath;
  const MAX_W = 1120;

  class Preview {
    constructor({ compare, before, after, line, loading }) {
      this.compare = compare;
      this.before = before;
      this.after = after;
      this.loading = loading;
      this.source = null;     // ImageData исходника
      this.settings = CM.neutralSettings();
      this.pending = false;
      this.x = 0.5;
      this._bindDrag();
    }

    _bindDrag() {
      let dragging = false;
      const setX = (clientX) => {
        const r = this.compare.getBoundingClientRect();
        this.x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        this.compare.style.setProperty('--x', (this.x * 100).toFixed(2) + '%');
      };
      this.compare.addEventListener('pointerdown', (e) => {
        dragging = true;
        this.compare.setPointerCapture(e.pointerId);
        setX(e.clientX);
      });
      this.compare.addEventListener('pointermove', (e) => { if (dragging) setX(e.clientX); });
      const stop = () => { dragging = false; };
      this.compare.addEventListener('pointerup', stop);
      this.compare.addEventListener('pointercancel', stop);
      this.compare.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          this.x = Math.min(1, Math.max(0, this.x + (e.key === 'ArrowLeft' ? -0.05 : 0.05)));
          this.compare.style.setProperty('--x', (this.x * 100).toFixed(2) + '%');
        }
      });
      this.compare.tabIndex = 0;
    }

    /** Загружает картинку (URL / dataURL), кадрирует в 16:9. */
    load(src) {
      this.loading.hidden = false;
      this.loading.textContent = 'Загрузка…';
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const targetRatio = 16 / 9;
          let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
          if (sw / sh > targetRatio) { const nw = sh * targetRatio; sx = (sw - nw) / 2; sw = nw; }
          else { const nh = sw / targetRatio; sy = (sh - nh) / 2; sh = nh; }
          const w = Math.min(MAX_W, Math.round(sw));
          const h = Math.round(w / targetRatio);
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

    /** Перерисовать обработанную половину (с объединением частых вызовов в один кадр). */
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
