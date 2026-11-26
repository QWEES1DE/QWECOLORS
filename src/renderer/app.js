/* QWECOLORS — логика интерфейса */
(function () {
  'use strict';
  const CM = window.QWEColorMath;
  const PR = window.QWEPresets;
  const api = window.qwe;
  const $ = (id) => document.getElementById(id);

  const SLIDERS = [
    { key: 'vibrance', name: 'Вибрация', tag: ['driver', 'драйвер'],
      sub: 'Цифровая вибрация видеокарты · работает и в полноэкранном режиме',
      fmt: (v) => `${Math.round(v)}%` },
    { key: 'saturation', name: 'Насыщенность', tag: ['beyond', 'за пределами'],
      sub: 'Выходит за пределы драйвера — до 300%',
      fmt: (v) => `${Math.round(v)}%` },
    { key: 'gamma', name: 'Тени (гамма)', sub: 'Больше 1 — светлее тёмные участки',
      fmt: (v) => v.toFixed(2) },
    { key: 'shadowBoost', name: 'Усиление теней', tag: ['new', 'new'],
      sub: 'Вытягивает тёмные углы, не трогая светлые',
      fmt: (v) => (v === 0 ? 'Выкл' : `${Math.round(v)}%`) },
    { key: 'contrast', name: 'Контраст', fmt: (v) => (v > 0 ? `+${v}` : `${v}`) },
    { key: 'brightness', name: 'Яркость', fmt: (v) => (v > 0 ? `+${v}` : `${v}`) },
    { key: 'temperature', name: 'Температура', sub: 'Меньше — теплее, больше — холоднее', cls: 'temp',
      fmt: (v) => `${Math.round(v)}K` },
  ];

  let state = null;
  let local = CM.neutralSettings();
  const inputs = {};
  let preview;

  /* ---------------- Утилиты ---------------- */

  let toastTimer;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function msg(el, text, ok) {
    el.textContent = text || '';
    el.className = 'form-msg' + (text ? (ok ? ' ok' : ' err') : '');
  }

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) e.setAttribute(k, v);
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }

  // Отправка в главный процесс не чаще ~40 раз/с, последнее значение — всегда
  let sendTimer = null, sendPatch = {};
  function sendSettings(patch) {
    Object.assign(sendPatch, patch);
    if (sendTimer) return;
    sendTimer = setTimeout(async () => {
      const p = sendPatch; sendPatch = {}; sendTimer = null;
      await api.update({ settings: p });
    }, 25);
  }

  /* ---------------- Ползунки ---------------- */

  function buildSliders() {
    const root = $('sliders');
    for (const def of SLIDERS) {
      const L = CM.LIMITS[def.key];
      const input = el('input', {
        type: 'range', min: L.min, max: L.max, step: L.step, value: L.neutral,
        class: def.cls || '', 'aria-label': def.name,
      });
      const value = el('div', { class: 'slider-value' });
      const tag = def.tag ? el('span', { class: 'tag ' + def.tag[0] }, def.tag[1]) : null;
      const row = el('div', { class: 'slider' },
        el('div', { class: 'slider-top' },
          el('div', {},
            el('div', { class: 'slider-name' }, def.name, tag),
            def.sub ? el('div', { class: 'slider-sub' }, def.sub) : null),
          value),
        input);
      root.append(row);

      input.addEventListener('input', () => {
        const v = Number(input.value);
        local[def.key] = v;
        paintSlider(def, v);
        preview.render(local);
        updateShareCode();
        sendSettings({ [def.key]: v });
      });
      input.addEventListener('dblclick', () => {
        input.value = L.neutral;
        input.dispatchEvent(new Event('input'));
      });
      inputs[def.key] = { input, value, def };
    }
  }

  function paintSlider(def, v) {
    const { input, value } = inputs[def.key];
    const L = CM.LIMITS[def.key];
    const p = ((v - L.min) / (L.max - L.min)) * 100;
    input.style.setProperty('--p', p + '%');
    value.textContent = def.fmt(v);
    value.classList.toggle('dim', Math.abs(v - L.neutral) < 1e-6);
  }

  function syncSliders() {
    for (const def of SLIDERS) {
      const { input } = inputs[def.key];
      const v = local[def.key];
      if (document.activeElement !== input || !input.matches(':active')) input.value = v;
      paintSlider(def, v);
    }
  }

  /* ---------------- Пресеты ---------------- */

  function renderPresets() {
    const root = $('presetChips');
    root.textContent = '';
    const all = PR.PRESETS.concat(state.userPresets || []);
    for (const p of all) {
      const isUser = p.id.startsWith('user-');
      const chip = el('button', { class: 'chip' + (state.presetId === p.id ? ' on' : '') + (isUser ? ' user' : ''), title: p.hint || '' }, p.name);
      chip.addEventListener('click', () => api.update({ presetId: p.id }).then(onState));
      if (isUser) {
        const x = el('span', { class: 'x', title: 'Удалить пресет' }, '×');
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          api.deletePreset(p.id).then(onState);
        });
        chip.append(x);
      }
      root.append(chip);
    }
    const cur = PR.findPreset(state.presetId, state.userPresets);
    $('presetHint').textContent = cur ? (cur.hint || '') : 'Свои настройки — сохраните их как пресет, чтобы не потерять.';
  }

  /* ---------------- Код ---------------- */

  function updateShareCode() {
    $('shareCode').textContent = PR.encodeShareCode(local);
  }

  /* ---------------- Статус ---------------- */

  function renderStatus() {
    const card = $('statusCard');
    const preset = PR.findPreset(state.presetId, state.userPresets);
    const waiting = state.enabled && !state.active && !state.peek;
    card.classList.toggle('off', !state.enabled);
    card.classList.toggle('waiting', waiting);
    $('btnPower').setAttribute('aria-pressed', String(state.enabled));
    $('powerText').textContent = state.enabled ? 'ВКЛ' : 'ВЫКЛ';
    $('statusLabel').textContent = !state.enabled ? 'ВЫКЛЮЧЕНО'
      : state.peek ? 'СТОК — ПРОСМОТР'
      : waiting ? 'ОЖИДАНИЕ ИГРЫ' : 'АКТИВНО';
    $('statusTitle').textContent = preset ? preset.name : 'Свои настройки';
    const where = state.scope === 'everywhere'
      ? 'Везде'
      : (state.apps.length ? 'В играх: ' + state.apps.slice(0, 2).join(', ') + (state.apps.length > 2 ? ` +${state.apps.length - 2}` : '') : 'Список игр пуст');
    $('statusSub').textContent = where + (preset ? ' · Пресет ' + preset.name : ' · Свои настройки');
  }

  function renderEngine() {
    const e = state.engine;
    const pill = $('enginePill');
    const list = $('engineList');
    list.textContent = '';
    pill.classList.remove('ok', 'warn', 'off');

    if (e.simulated) {
      pill.classList.add('warn');
      $('enginePillText').textContent = api.isDesktop ? 'режим предпросмотра' : 'веб-демо';
      list.append(el('li', { class: 'warn' }, el('span', { class: 'dot' }),
        el('div', {}, el('b', {}, api.isDesktop ? 'Движок доступен только в Windows' : 'Это веб-демо'),
          el('div', { class: 'desc' }, 'Ползунки и код работают. Чтобы цвета менялись на всём экране, запустите QWECOLORS для Windows и вставьте туда код.'))));
      return;
    }

    const items = [
      { ok: e.matrix.ok, title: 'Цветовая матрица Windows', desc: e.matrix.error || 'Насыщенность до 300% для всего рабочего стола и игр в оконном/безрамочном режиме' },
      {
        ok: e.gamma.ok, warn: e.gamma.mode === 'fallback' && e.gamma.ok,
        title: `Гамма-рампа видеокарты · ${e.gamma.monitors} монитор(ов)`,
        desc: e.gamma.error || 'Тени, контраст, яркость и температура — работает и в полноэкранных играх',
      },
      {
        ok: e.vibrance.ok, warn: !e.vibrance.vendor,
        title: e.vibrance.vendor ? `Вибрация драйвера · ${e.vibrance.vendor}` : 'Вибрация драйвера',
        desc: e.vibrance.error || 'Цифровая вибрация через драйвер — как в панели управления видеокартой',
      },
    ];
    let worst = 'ok';
    for (const it of items) {
      const cls = it.warn ? 'warn' : it.ok ? 'ok' : 'err';
      if (cls === 'err') worst = 'off'; else if (cls === 'warn' && worst === 'ok') worst = 'warn';
      list.append(el('li', { class: cls }, el('span', { class: 'dot' }), el('div', {}, el('b', {}, it.title), el('div', { class: 'desc' }, it.desc))));
    }
    pill.classList.add(worst);
    $('enginePillText').textContent = worst === 'ok' ? 'движок готов' : worst === 'warn' ? 'частично' : 'ошибка движка';
  }

  function renderSettings() {
    for (const b of $('scopeSeg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.scope === state.scope);
    $('appsBox').hidden = state.scope !== 'apps';
    const chips = $('appChips');
    chips.textContent = '';
    const fgExe = state.foreground && state.foreground.exe ? state.foreground.exe.toLowerCase() : null;
    for (const a of state.apps) {
      const rm = el('button', { title: 'Убрать' }, '×');
      rm.addEventListener('click', () => api.update({ apps: state.apps.filter((x) => x !== a) }).then(onState));
      chips.append(el('span', { class: 'app-chip' + (fgExe === a.toLowerCase() ? ' live' : '') }, a, rm));
    }
    if (!state.apps.length) chips.append(el('span', { class: 'muted small' }, 'Добавьте exe игры — эффект будет включаться только в ней.'));
    $('fgInfo').textContent = state.scope === 'apps' && state.foreground && state.foreground.exe
      ? `Сейчас активно: ${state.foreground.exe} — ${state.foreground.inScope ? 'эффект включён' : 'эффект на паузе'}`
      : '';

    $('optAutostart').checked = state.autostart;
    $('optStartMin').checked = state.startMinimized;
    $('optTray').checked = state.closeToTray;
    $('optHotkeys').checked = state.hotkeys;
    $('btnUnlockGamma').hidden = !(api.isDesktop && state.engine.platform === 'win32');
  }

  function renderPreviewNote() {
    const base = 'Тяните картинку, чтобы сравнить. Вибрация здесь аппроксимирована — в приложении её делает драйвер видеокарты.';
    const extra = api.isDesktop && !state.engine.simulated && state.active
      ? ' Сейчас эффект уже наложен на весь экран, включая это окно, — зажмите «Удерживайте — сток», чтобы увидеть разницу вживую.'
      : '';
    $('previewNote').textContent = base + extra;
  }

  function onState(s) {
    if (!s) return;
    state = s;
    // Не перебиваем значения, пока пользователь тянет ползунок
    const dragging = SLIDERS.some((d) => inputs[d.key].input.matches(':active'));
    if (!dragging && !sendTimer) {
      local = CM.sanitize(s.settings);
      syncSliders();
      preview.render(local);
      updateShareCode();
    }
    renderStatus();
    renderPresets();
    renderEngine();
    renderSettings();
    renderPreviewNote();
  }

  /* ---------------- События ---------------- */

  function bind() {
    $('btnMin').addEventListener('click', () => api.minimize());
    $('btnMax').addEventListener('click', () => api.toggleMaximize());
    $('btnClose').addEventListener('click', () => api.close());
    document.querySelector('.titlebar').addEventListener('dblclick', (e) => {
      if (!e.target.closest('button, .engine-pill')) api.toggleMaximize();
    });

    $('btnPower').addEventListener('click', () => api.update({ enabled: !state.enabled }).then(onState));

    // «Удерживайте — сток»
    const peekBtn = $('btnPeek');
    let peeking = false;
    const peek = (on) => {
      if (peeking === on) return;
      peeking = on;
      peekBtn.classList.toggle('held', on);
      api.peek(on);
    };
    peekBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); peek(true); });
    window.addEventListener('pointerup', () => peek(false));
    window.addEventListener('blur', () => peek(false));
    peekBtn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') peek(true); });
    peekBtn.addEventListener('keyup', () => peek(false));

    // Источник предпросмотра
    const seg = $('previewSource');
    const setSeg = (src) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.src === src));
    seg.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const src = b.dataset.src;
      if (src === 'sample') { setSeg('sample'); preview.load('assets/sample.jpg'); }
      if (src === 'file') $('fileInput').click();
      if (src === 'screen') {
        try {
          const url = await api.captureScreen();
          if (url) { setSeg('screen'); await preview.load(url); toast('Снимок экрана загружен'); }
          else toast('Не удалось сделать снимок экрана');
        } catch (_) { toast('Снимок экрана отменён'); }
      }
    });
    $('fileInput').addEventListener('change', () => {
      const f = $('fileInput').files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      preview.load(url).then(() => { setSeg('file'); URL.revokeObjectURL(url); }).catch(() => toast('Не удалось открыть картинку'));
      $('fileInput').value = '';
    });

    // Код
    $('btnCopyCode').addEventListener('click', async () => {
      await api.copy($('shareCode').textContent);
      toast('Код скопирован');
    });
    const applyCode = async () => {
      let text = $('shareInput').value.trim();
      if (!text) { text = (await api.paste() || '').trim(); $('shareInput').value = text; }
      try {
        const s = PR.decodeShareCode(text);
        onState(await api.update({ settings: s }));
        msg($('shareMsg'), 'Код применён ✓', true);
        $('shareInput').value = '';
      } catch (e) {
        msg($('shareMsg'), e.message, false);
      }
    };
    $('btnApplyCode').addEventListener('click', applyCode);
    $('shareInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCode(); });
    $('shareInput').addEventListener('input', () => msg($('shareMsg'), ''));

    // Сохранение пресета
    const row = $('savePresetRow');
    $('btnSavePreset').addEventListener('click', () => { row.hidden = false; $('presetName').focus(); });
    $('btnSavePresetCancel').addEventListener('click', () => { row.hidden = true; });
    const savePreset = async () => {
      const name = $('presetName').value.trim();
      if (!name) { $('presetName').focus(); return; }
      onState(await api.savePreset(name));
      $('presetName').value = '';
      row.hidden = true;
      toast(`Пресет «${name}» сохранён`);
    };
    $('btnSavePresetOk').addEventListener('click', savePreset);
    $('presetName').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePreset(); if (e.key === 'Escape') row.hidden = true; });

    // Область
    $('scopeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) api.update({ scope: b.dataset.scope }).then(onState);
    });
    const addApp = (name) => {
      let n = String(name || '').trim().split(/[\\/]/).pop();
      if (!n) return;
      if (!/\.exe$/i.test(n)) n += '.exe';
      if (state.apps.some((a) => a.toLowerCase() === n.toLowerCase())) { toast('Уже в списке'); return; }
      api.update({ apps: state.apps.concat([n]) }).then(onState);
    };
    $('btnAddApp').addEventListener('click', () => { addApp($('appInput').value); $('appInput').value = ''; });
    $('appInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { addApp($('appInput').value); $('appInput').value = ''; } });
    $('btnPickApp').addEventListener('click', async () => {
      if (!api.isDesktop) { toast('Доступно в приложении для Windows'); return; }
      const btn = $('btnPickApp');
      btn.disabled = true;
      let left = 3;
      btn.textContent = `Переключитесь в игру… ${left}`;
      const t = setInterval(() => { left--; if (left > 0) btn.textContent = `Переключитесь в игру… ${left}`; }, 1000);
      const exe = await api.pickForeground();
      clearInterval(t);
      btn.disabled = false;
      btn.textContent = 'Выбрать окно';
      if (exe) { addApp(exe); toast(`Добавлено: ${exe}`); } else toast('Не удалось определить окно');
    });

    // Переключатели
    $('optAutostart').addEventListener('change', (e) => api.update({ autostart: e.target.checked }).then(onState));
    $('optStartMin').addEventListener('change', (e) => api.update({ startMinimized: e.target.checked }).then(onState));
    $('optTray').addEventListener('change', (e) => api.update({ closeToTray: e.target.checked }).then(onState));
    $('optHotkeys').addEventListener('change', (e) => api.update({ hotkeys: e.target.checked }).then(onState));

    $('btnUnlockGamma').addEventListener('click', async () => {
      const r = await api.unlockGamma();
      msg($('settingsMsg'), r.ok ? 'Готово. Перезагрузите компьютер, чтобы Windows разрешила полный диапазон гаммы.' : r.error, r.ok);
    });
    $('btnReset').addEventListener('click', async () => { onState(await api.resetAll()); toast('Сброшено в сток'); });
    $('btnQuit').addEventListener('click', () => api.quit());
    $('btnQuit').hidden = !api.isDesktop;
  }

  /* ---------------- Старт ---------------- */

  async function start() {
    preview = new window.QWEPreview({
      compare: $('compare'), before: $('canvasBefore'), after: $('canvasAfter'),
      line: $('compareLine'), loading: $('compareLoading'),
    });
    buildSliders();
    bind();
    api.onState(onState);
    onState(await api.getState());
    preview.load('assets/sample.jpg').catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', start);
})();
