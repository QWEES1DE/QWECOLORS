'use strict';
/* Хранение настроек в %APPDATA%/QWECOLORS/settings.json */
const fs = require('fs');
const path = require('path');
const CM = require('../shared/colormath');

const DEFAULTS = {
  enabled: true,
  presetId: null,
  settings: CM.neutralSettings(),
  userPresets: [],
  scope: 'everywhere',          // everywhere | apps
  apps: [],
  autostart: false,
  startMinimized: false,
  closeToTray: true,
  hotkeys: true,
  window: { width: 1180, height: 790 },
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = this._load();
    this._timer = null;
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return normalize({ ...DEFAULTS, ...raw });
    } catch (_) {
      return normalize({ ...DEFAULTS });
    }
  }

  get() { return this.data; }

  update(patch) {
    this.data = normalize({ ...this.data, ...patch });
    this._scheduleSave();
    return this.data;
  }

  _scheduleSave() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('settings save failed', e);
    }
  }
}

function normalize(d) {
  const out = { ...d };
  out.settings = CM.sanitize(d.settings);
  out.enabled = !!d.enabled;
  out.scope = d.scope === 'apps' ? 'apps' : 'everywhere';
  out.apps = Array.isArray(d.apps)
    ? [...new Set(d.apps.map((a) => String(a).trim()).filter((a) => /^[^\\/:*?"<>|]+\.exe$/i.test(a)))].slice(0, 50)
    : [];
  out.userPresets = Array.isArray(d.userPresets)
    ? d.userPresets.filter((p) => p && p.id && p.name).slice(0, 30).map((p) => ({
        id: String(p.id), name: String(p.name).slice(0, 32), hint: 'Свой пресет', settings: CM.sanitize(p.settings),
      }))
    : [];
  out.presetId = d.presetId && out.userPresets.some((p) => p.id === String(d.presetId)) ? String(d.presetId) : null;
  out.autostart = !!d.autostart;
  out.startMinimized = !!d.startMinimized;
  out.closeToTray = d.closeToTray !== false;
  out.hotkeys = d.hotkeys !== false;
  out.window = d.window && typeof d.window === 'object' ? d.window : { ...DEFAULTS.window };
  return out;
}

module.exports = { Store, DEFAULTS };
