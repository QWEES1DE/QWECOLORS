/*
 * Веб-демо: если интерфейс открыт в обычном браузере (без Electron),
 * подставляем «бэкенд» на localStorage — можно покрутить ползунки и получить код,
 * который потом вставляется в настольный QWECOLORS.
 */
(function () {
  'use strict';
  if (window.qwe) return;
  document.documentElement.classList.add('web');
  document.addEventListener('DOMContentLoaded', () => document.body.classList.add('web'));

  const CM = window.QWEColorMath;
  const PR = window.QWEPresets;
  const KEY = 'qwecolors-demo-state';
  const listeners = new Set();

  const defaults = {
    enabled: true, presetId: 'robrun', settings: { ...PR.PRESETS[0].settings }, userPresets: [],
    scope: 'everywhere', apps: ['RobloxPlayerBeta.exe'], autostart: false, startMinimized: false,
    closeToTray: true, hotkeys: true,
  };
  let data;
  try { data = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) { data = { ...defaults }; }
  data.settings = CM.sanitize(data.settings);

  const engineStatus = {
    platform: 'web', simulated: true,
    gamma: { ok: false, monitors: 0, error: 'Веб-демо: на экран применяется только в приложении для Windows' },
    matrix: { ok: false, error: 'Веб-демо' },
    vibrance: { vendor: null, ok: false, error: 'Веб-демо' },
  };

  function state() {
    return { ...data, active: data.enabled, foreground: { exe: null, inScope: true }, engine: engineStatus, version: 'web', hotkeyToggle: 'Ctrl+Alt+Q' };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) { /* ignore */ }
    const s = state();
    listeners.forEach((cb) => cb(s));
    return s;
  }
  function update(patch) {
    const next = { ...patch };
    if (next.settings) {
      next.settings = CM.sanitize({ ...data.settings, ...next.settings });
      if (!('presetId' in next)) {
        const p = PR.matchPreset(next.settings, data.userPresets);
        next.presetId = p ? p.id : null;
      }
    }
    if (patch.presetId && !patch.settings) {
      const p = PR.findPreset(patch.presetId, data.userPresets);
      if (p) next.settings = CM.sanitize(p.settings);
    }
    data = { ...data, ...next };
    return save();
  }

  async function captureScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return null;
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    try {
      const video = document.createElement('video');
      video.srcObject = stream; video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 250));
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      return c.toDataURL('image/jpeg', 0.92);
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  window.qwe = {
    isDesktop: false,
    getState: async () => state(),
    update: async (patch) => update(patch || {}),
    savePreset: async (name) => {
      const id = 'user-' + Date.now().toString(36);
      data.userPresets = data.userPresets.concat([{ id, name: String(name || 'Мой пресет').slice(0, 32), hint: 'Свой пресет', settings: data.settings }]);
      return update({ presetId: id, settings: data.settings });
    },
    deletePreset: async (id) => {
      data.userPresets = data.userPresets.filter((p) => p.id !== id);
      return update({ presetId: data.presetId === id ? null : data.presetId });
    },
    captureScreen,
    pickForeground: async () => null,
    unlockGamma: async () => ({ ok: false, error: 'Доступно только в приложении для Windows' }),
    resetAll: async () => update({ presetId: 'natural' }),
    peek: async () => true,
    copy: async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch (_) { return false; } },
    paste: async () => { try { return await navigator.clipboard.readText(); } catch (_) { return ''; } },
    minimize() {}, toggleMaximize() {}, close() {}, quit() {},
    onState: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
})();
