/*
 * QWECOLORS — пользовательские пресеты.
 * Встроенных пресетов нет: каждый настраивает и сохраняет свои.
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./colormath') : root.QWEColorMath);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QWEPresets = api;
})(typeof self !== 'undefined' ? self : this, function (CM) {
  'use strict';

  function findPreset(id, userPresets) {
    if (!id) return null;
    return (userPresets || []).find((p) => p.id === id) || null;
  }

  /** Какой из сохранённых пресетов совпадает с настройками (или null). */
  function matchPreset(settings, userPresets) {
    const s = CM.sanitize(settings);
    for (const p of userPresets || []) {
      const ps = CM.sanitize(p.settings);
      if (CM.KEYS.every((k) => Math.abs(ps[k] - s[k]) < 1e-6)) return p;
    }
    return null;
  }

  return { findPreset, matchPreset };
});
