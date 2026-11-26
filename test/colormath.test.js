'use strict';
const test = require('node:test');
const assert = require('node:assert');
const CM = require('../src/shared/colormath');
const PR = require('../src/shared/presets');

test('нейтральные настройки дают тождественные рампу и матрицу', () => {
  const s = CM.neutralSettings();
  const ramp = CM.curvesToGammaRamp(CM.buildCurves(s));
  const id = CM.identityGammaRamp();
  for (let i = 0; i < 768; i++) assert.ok(Math.abs(ramp[i] - id[i]) <= 1, `ramp[${i}]`);
  assert.ok(CM.isIdentity5(CM.buildColorMatrix(s)));
  assert.ok(CM.isIdentity5(CM.buildColorMatrix(s, { includeLinear: true })));
});

test('матрица насыщенности сохраняет серый и усиливает цвет', () => {
  const m = CM.saturationMatrix(300);
  const apply = (rgb) => [0, 1, 2].map((j) => rgb[0] * m[j] + rgb[1] * m[5 + j] + rgb[2] * m[10 + j] + m[20 + j]);
  const g = apply([0.5, 0.5, 0.5]);
  g.forEach((v) => assert.ok(Math.abs(v - 0.5) < 1e-6));
  const c = apply([0.6, 0.4, 0.4]);
  assert.ok(c[0] > 0.6 && c[1] < 0.4);
});

test('температура 6500K нейтральна, тёплая уменьшает синий', () => {
  assert.deepStrictEqual(CM.temperatureGains(6500), [1, 1, 1]);
  const warm = CM.temperatureGains(4000);
  assert.strictEqual(warm[0], 1);
  assert.ok(warm[2] < 0.8);
  const cold = CM.temperatureGains(9000);
  assert.ok(cold[0] < 1 && Math.abs(cold[2] - 1) < 1e-9);
});

test('рампа монотонна для всех пресетов', () => {
  for (const p of PR.PRESETS) {
    const c = CM.buildCurves(p.settings);
    for (const ch of ['r', 'g', 'b']) {
      for (let i = 1; i < 256; i++) assert.ok(c[ch][i] >= c[ch][i - 1] - 1e-6, `${p.id}/${ch}/${i}`);
    }
  }
});

test('вибрация NVIDIA: 50% = сток, 100% = максимум', () => {
  const info = { minLevel: 0, maxLevel: 63, defaultLevel: 0 };
  assert.strictEqual(CM.vibranceToNvLevel(50, info), 0);
  assert.strictEqual(CM.vibranceToNvLevel(100, info), 63);
  assert.strictEqual(CM.vibranceToNvLevel(20, info), 0);
  const ex = { minLevel: -50, maxLevel: 50, defaultLevel: 0 };
  assert.strictEqual(CM.vibranceToNvLevel(0, ex), -50);
  assert.strictEqual(CM.nvLevelToVibrance(63, info), 100);
  assert.strictEqual(CM.vibranceToAmd(50), 100);
  assert.strictEqual(CM.vibranceToAmd(100), 200);
});

test('код настроек: туда и обратно', () => {
  for (const p of PR.PRESETS) {
    const code = PR.encodeShareCode(p.settings);
    assert.match(code, /^QWE1-[A-Z2-9]+$/);
    assert.deepStrictEqual(PR.decodeShareCode(code), CM.sanitize(p.settings));
    assert.deepStrictEqual(PR.decodeShareCode(' ' + code.toLowerCase() + ' '), CM.sanitize(p.settings));
  }
  const code = PR.encodeShareCode(PR.PRESETS[0].settings);
  const broken = code.slice(0, -2) + (code.slice(-2) === 'AA' ? 'BB' : 'AA');
  assert.throws(() => PR.decodeShareCode(broken));
  assert.throws(() => PR.decodeShareCode('hello'));
});

test('processPixels: нейтральные настройки не меняют картинку', () => {
  const data = new Uint8ClampedArray([10, 20, 30, 255, 200, 100, 50, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  const copy = new Uint8ClampedArray(data);
  CM.processPixels(data, CM.neutralSettings());
  assert.deepStrictEqual(Array.from(data), Array.from(copy));
});

test('sanitize ограничивает диапазоны', () => {
  const s = CM.sanitize({ saturation: 999, gamma: 0.1, temperature: 123456, contrast: 'abc' });
  assert.strictEqual(s.saturation, 300);
  assert.strictEqual(s.gamma, 0.5);
  assert.strictEqual(s.temperature, 10000);
  assert.strictEqual(s.contrast, 0);
});
