/*
 * QWECOLORS — пресеты и коды для обмена настройками.
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./colormath') : root.QWEColorMath);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QWEPresets = api;
})(typeof self !== 'undefined' ? self : this, function (CM) {
  'use strict';

  // vibrance, saturation, gamma, shadowBoost, contrast, brightness, temperature
  const P = (id, name, hint, v, s, g, sb, c, b, t) => ({
    id, name, hint,
    settings: { vibrance: v, saturation: s, gamma: g, shadowBoost: sb, contrast: c, brightness: b, temperature: t },
  });

  const PRESETS = [
    P('robrun',      'Rob Run',          'Флагман: копы и машины выпрыгивают с экрана', 85, 140, 1.10,  0,  8,  3, 6700),
    P('cop',         'Коп-радар',        'Синие и красные мигалки видно издалека',       90, 170, 1.20, 25, 12,  2, 7200),
    P('heist',       'Ночное ограбление','Вытягивает тёмные переулки и тени',            75, 125, 1.45, 60,  4,  8, 6900),
    P('miami',       'Закат Майами',     'Тёплый неон и сочный закат',                  80, 150, 1.05, 10, 10,  2, 5600),
    P('blood',       'QWE Blood',        'Фирменный: глубокий красный и плотный контраст', 85, 160, 1.05, 0, 14, 0, 5400),
    P('overdrive',   'Овердрайв 300%',   'Максимальная насыщенность — на грани',        100, 300, 1.10, 10, 15,  0, 6500),
    P('competitive', 'Соревновательный', 'Светлые тени, читаемые силуэты',               80, 130, 1.30, 40,  6,  4, 6600),
    P('vivid',       'Сочный',           'Яркие цвета без потери деталей',               95, 180, 1.00,  0, 12,  0, 6500),
    P('cinematic',   'Кино',             'Мягкие цвета и тёплый тон',                   60,  90, 0.95,  0, 14, -3, 5800),
    P('natural',     'Натуральный',      'Как в стоке — всё выключено',                  50, 100, 1.00,  0,  0,  0, 6500),
  ];

  function findPreset(id, userPresets) {
    return PRESETS.find((p) => p.id === id) || (userPresets || []).find((p) => p.id === id) || null;
  }

  /** Какой пресет совпадает с настройками (или null). */
  function matchPreset(settings, userPresets) {
    const s = CM.sanitize(settings);
    const all = PRESETS.concat(userPresets || []);
    for (const p of all) {
      const ps = CM.sanitize(p.settings);
      if (CM.KEYS.every((k) => Math.abs(ps[k] - s[k]) < 1e-6)) return p;
    }
    return null;
  }

  /* ---------------- Коды для обмена ----------------
   * Формат: QWE1-XXXXXXXXXXXXXX
   * 7 значений упакованы в байты + 1 байт контрольной суммы, затем base32 (без путаницы 0/O, 1/I).
   */
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function pack(s) {
    s = CM.sanitize(s);
    return [
      Math.round(s.vibrance),                 // 0..100
      Math.round(s.saturation) >> 8, Math.round(s.saturation) & 0xff, // 0..300 (2 байта)
      Math.round(s.gamma * 100) - 50,          // 0.50..2.50 → 0..200
      Math.round(s.shadowBoost),              // 0..100
      Math.round(s.contrast) + 50,            // -50..50 → 0..100
      Math.round(s.brightness) + 50,          // -50..50 → 0..100
      Math.round(s.temperature / 100) - 30,   // 3000..10000 → 0..70
    ];
  }

  function checksum(bytes) {
    let c = 0x5a;
    for (let i = 0; i < bytes.length; i++) c = ((c * 31) ^ (bytes[i] + i * 7)) & 0xff;
    return c;
  }

  function base32(bytes) {
    let bits = 0, value = 0, out = '';
    for (const byte of bytes) {
      value = (value << 8) | byte; bits += 8;
      while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
  }

  function unbase32(str) {
    let bits = 0, value = 0;
    const out = [];
    for (const ch of str) {
      const idx = ALPHABET.indexOf(ch);
      if (idx < 0) throw new Error('Недопустимый символ в коде: ' + ch);
      value = (value << 5) | idx; bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return out;
  }

  function encodeShareCode(settings) {
    const bytes = pack(settings);
    bytes.push(checksum(bytes));
    return 'QWE1-' + base32(bytes);
  }

  function decodeShareCode(code) {
    const clean = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = /^QWE1-?([A-Z2-9]+)$/.exec(clean);
    if (!m) throw new Error('Это не код QWECOLORS (должен начинаться с QWE1-)');
    const bytes = unbase32(m[1]);
    if (bytes.length < 9) throw new Error('Код слишком короткий');
    const data = bytes.slice(0, 8);
    if (checksum(data) !== bytes[8]) throw new Error('Код повреждён (не сходится контрольная сумма)');
    return CM.sanitize({
      vibrance: data[0],
      saturation: (data[1] << 8) | data[2],
      gamma: (data[3] + 50) / 100,
      shadowBoost: data[4],
      contrast: data[5] - 50,
      brightness: data[6] - 50,
      temperature: (data[7] + 30) * 100,
    });
  }

  return { PRESETS, findPreset, matchPreset, encodeShareCode, decodeShareCode };
});
