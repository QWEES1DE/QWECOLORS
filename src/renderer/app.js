/* QWECOLORS — логика интерфейса */
(function () {
  'use strict';
  const CM = window.QWEColorMath;
  const PR = window.QWEPresets;
  const api = window.qwe;
  const $ = (id) => document.getElementById(id);

  const signed = (v) => (v > 0 ? `+${v}` : `${v}`);
  const CHANNELS = [
    { key: 'vibrance', name: 'Вибра\u00ADция', tag: ['drv', 'ДРАЙВЕР'],
      desc: 'Цифровая вибрация видеокарты (NVIDIA / AMD). 50% — как в стоке. Работает и в полноэкранных играх.',
      fmt: (v) => [Math.round(v), '%'] },
    { key: 'saturation', name: 'Насыщен­ность', tag: ['hot', 'ДО 300%'],
      desc: 'Насыщенность всего экрана — выходит за пределы драйвера, до 300%.',
      fmt: (v) => [Math.round(v), '%'] },
    { key: 'gamma', name: 'Тени', tag: ['', 'ГАММА'],
      desc: 'Гамма теней: больше 1 — тёмные участки светлее, меньше 1 — глубже.',
      fmt: (v) => [v.toFixed(2), ''] },
    { key: 'shadowBoost', name: 'Подъём теней', tag: ['', 'BOOST'],
      desc: 'Вытягивает тёмные углы и переулки, почти не трогая светлые участки.',
      fmt: (v) => (v === 0 ? ['ВЫКЛ', ''] : [Math.round(v), '%']) },
    { key: 'contrast', name: 'Конт\u00ADраст', tag: ['', ''],
      desc: 'Контраст вокруг середины яркости.',
      fmt: (v) => [signed(v), ''] },
    { key: 'brightness', name: 'Яркость', tag: ['', ''],
      desc: 'Общая яркость изображения.',
      fmt: (v) => [signed(v), ''] },
    { key: 'temperature', name: 'Темпе­ратура', tag: ['', 'KELVIN'], cls: 'temp',
      desc: 'Цветовая температура: ниже 6500K — теплее, выше — холоднее.',
      fmt: (v) => [Math.round(v), 'K'] },
  ];

  const VIEW_TITLES = { color: 'Цвет', games: 'Игры', system: 'Система' };

  let state = null;
  let local = CM.neutralSettings();
  const channels = {};
  let preview;
  let editingSlot = false;

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
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }

  // Отправка в главный процесс не чаще ~40 раз/с
  let sendTimer = null, sendPatch = {};
  function sendSettings(patch) {
    Object.assign(sendPatch, patch);
    if (sendTimer) return;
    sendTimer = setTimeout(async () => {
      const p = sendPatch; sendPatch = {}; sendTimer = null;
      await api.update({ settings: p });
    }, 25);
  }

  /* ---------------- Навигация ---------------- */

  function showView(name) {
    document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'view-' + name));
    $('viewTitle').textContent = VIEW_TITLES[name];
    $('app').querySelector('.content').scrollTop = 0;
  }

  /* ---------------- Микшер ---------------- */

  function buildMixer() {
    const root = $('mixer');
    const info = $('channelInfo');
    const defaultInfo = info.textContent;
    for (const def of CHANNELS) {
      const L = CM.LIMITS[def.key];
      const val = el('div', { class: 'ch-val' });
      const fader = new window.QWEFader({
        min: L.min, max: L.max, step: L.step, neutral: L.neutral, value: L.neutral,
        className: def.cls, label: def.name.replace(/\u00AD/g, ''),
        onInput: (v) => {
          local[def.key] = v;
          paintChannel(def.key);
          preview.render(local);
          sendSettings({ [def.key]: v });
        },
      });
      const ch = el('div', { class: 'ch', 'data-key': def.key },
        val,
        el('div', { class: 'ch-tag ' + def.tag[0] }, def.tag[1]),
        fader.el,
        el('div', { class: 'ch-name' }, def.name));
      const showInfo = () => {
        info.textContent = '';
        info.append(el('b', {}, def.name.replace(/\u00AD/g, '') + ' — '), def.desc);
      };
      ch.addEventListener('mouseenter', showInfo);
      ch.addEventListener('mouseleave', () => { if (!ch.classList.contains('focus')) info.textContent = defaultInfo; });
      fader.el.addEventListener('focus', () => { ch.classList.add('focus'); showInfo(); });
      fader.el.addEventListener('blur', () => { ch.classList.remove('focus'); info.textContent = defaultInfo; });
      root.append(ch);
      channels[def.key] = { def, fader, val, ch };
    }
  }

  function paintChannel(key) {
    const { def, val, ch } = channels[key];
    const v = local[key];
    const [num, unit] = def.fmt(v);
    val.textContent = '';
    val.append(String(num));
    if (unit) val.append(el('small', {}, unit));
    ch.classList.toggle('neutral', Math.abs(v - CM.LIMITS[key].neutral) < 1e-6);
  }

  function syncMixer() {
    for (const key of Object.keys(channels)) {
      const { fader } = channels[key];
      if (!fader.dragging) fader.set(local[key]);
      paintChannel(key);
    }
  }

  /* ---------------- Банк пресетов ---------------- */

  function presetMeta(s) {
    return `НАС ${Math.round(s.saturation)}% · ВИБ ${Math.round(s.vibrance)}%`;
  }

  function renderBank() {
    const root = $('bank');
    root.textContent = '';
    const all = state.userPresets || [];
    all.forEach((p, i) => {
      const del = el('span', { class: 'slot-del', title: 'Удалить пресет' }, '×');
      del.addEventListener('click', (e) => { e.stopPropagation(); api.deletePreset(p.id).then(onState); });
      const slot = el('button', { class: 'slot' + (state.presetId === p.id ? ' on' : ''), title: 'Применить «' + p.name + '»' },
        el('span', { class: 'slot-num' }, 'M' + String(i + 1).padStart(2, '0')),
        el('span', { class: 'slot-name' }, p.name),
        el('span', { class: 'slot-meta' }, presetMeta(CM.sanitize(p.settings))),
        del);
      slot.addEventListener('click', () => api.update({ presetId: p.id }).then(onState));
      root.append(slot);
    });

    if (editingSlot) {
      const input = el('input', { class: 'input', maxlength: '32', placeholder: 'Название пресета' });
      const save = async () => {
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        editingSlot = false;
        onState(await api.savePreset(name));
        toast(`Пресет «${name}» сохранён`);
      };
      const cancel = () => { editingSlot = false; renderBank(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); });
      const box = el('div', { class: 'slot editing' }, input,
        el('div', { class: 'slot-actions' },
          el('button', { class: 'btn primary tiny', onclick: save }, 'Сохранить'),
          el('button', { class: 'btn tiny', onclick: cancel }, 'Отмена')));
      root.append(box);
      setTimeout(() => input.focus(), 0);
    } else {
      const add = el('button', { class: 'slot add', title: 'Сохранить текущие значения микшера' },
        el('span', { class: 'plus' }, '+'), el('span', {}, 'Сохранить текущие'));
      add.addEventListener('click', () => { editingSlot = true; renderBank(); });
      root.append(add);
    }

    $('bankHint').textContent = all.length === 0
      ? 'Пока пусто — настройте микшер под себя и сохраните.'
      : (PR.findPreset(state.presetId, all) ? 'Клик — применить' : 'Текущие значения не сохранены');
  }

  /* ---------------- Верхняя панель ---------------- */

  function renderState() {
    const preset = PR.findPreset(state.presetId, state.userPresets);
    const waiting = state.enabled && !state.active && !state.peek;
    const box = $('stateBox');
    box.classList.toggle('off', !state.enabled);
    box.classList.toggle('wait', waiting);
    $('stateMain').textContent = !state.enabled ? 'ЭФФЕКТ ВЫКЛЮЧЕН'
      : state.peek ? 'ПОКАЗАН СТОК'
      : waiting ? 'ЖДЁТ ИГРУ' : 'ЭФФЕКТ АКТИВЕН';
    const where = state.scope === 'everywhere'
      ? 'Везде'
      : (state.apps.length ? state.apps.slice(0, 2).join(', ') + (state.apps.length > 2 ? ` +${state.apps.length - 2}` : '') : 'Список игр пуст');
    $('stateSub').textContent = where + (preset ? ' · ' + preset.name : '');
    $('btnPower').setAttribute('aria-checked', String(state.enabled));
    const led = $('railLed');
    led.classList.toggle('on', state.enabled && state.active);
    led.classList.toggle('wait', waiting);
    $('appVersion').textContent = state.version && state.version !== 'web' ? 'v' + state.version : '';
  }

  function renderPreviewNote() {
    const live = api.isDesktop && !state.engine.simulated && state.active;
    $('previewNote').textContent = live
      ? 'Эффект уже наложен на весь экран — зажмите «Сток» вверху, чтобы сравнить вживую.'
      : 'Вибрация здесь приблизительная — на экране её делает драйвер.';
  }

  /* ---------------- Игры ---------------- */

  function renderGames() {
    document.querySelectorAll('#scopeOptions .option').forEach((o) => o.classList.toggle('on', o.dataset.scope === state.scope));
    $('appsPanel').classList.toggle('disabled', state.scope !== 'apps');
    const list = $('appList');
    list.textContent = '';
    const fg = state.foreground && state.foreground.exe ? state.foreground.exe.toLowerCase() : null;
    for (const a of state.apps) {
      const live = state.scope === 'apps' && fg === a.toLowerCase();
      const del = el('button', { class: 'app-del', title: 'Убрать из списка' }, '×');
      del.addEventListener('click', () => api.update({ apps: state.apps.filter((x) => x !== a) }).then(onState));
      list.append(el('div', { class: 'app-row' },
        el('span', { class: 'app-ico' }, a.slice(0, 1).toUpperCase()),
        el('span', { class: 'app-exe' }, a),
        el('span', { class: 'app-state' + (live ? ' live' : '') }, live ? '● АКТИВНА' : 'ОЖИДАНИЕ'),
        del));
    }
    if (!state.apps.length) list.append(el('div', { class: 'app-empty' }, 'Список пуст. Добавьте exe игры — эффект будет включаться только в ней.'));
    $('fgInfo').textContent = state.scope === 'apps' && state.foreground && state.foreground.exe
      ? `Сейчас: ${state.foreground.exe} — ${state.foreground.inScope ? 'эффект включён' : 'на паузе'}`
      : '';
  }

  /* ---------------- Система ---------------- */

  function renderSystem() {
    $('optAutostart').checked = state.autostart;
    $('optStartMin').checked = state.startMinimized;
    $('optTray').checked = state.closeToTray;
    $('optHotkeys').checked = state.hotkeys;
    $('btnUnlockGamma').hidden = !(api.isDesktop && state.engine.platform === 'win32');
    $('btnQuit').hidden = !api.isDesktop;

    const e = state.engine;
    const list = $('engineList');
    const badge = $('engineBadge');
    list.textContent = '';
    badge.className = 'rail-badge';

    const row = (cls, label, title, desc) => list.append(el('div', { class: 'module' },
      el('b', {}, title), el('span', { class: 'st ' + cls }, label), el('div', { class: 'desc' }, desc)));

    if (e.simulated) {
      row('warn', 'ДЕМО', api.isDesktop ? 'Движок доступен только в Windows' : 'Это веб-демо',
        'Микшер и предпросмотр работают. Чтобы цвета менялись на всём экране, запустите QWECOLORS для Windows.');
      $('engineSummary').textContent = 'режим предпросмотра';
      badge.classList.add('warn');
      return;
    }

    const items = [
      { st: e.matrix.ok ? 'ok' : 'err', title: 'Цветовая матрица Windows',
        desc: e.matrix.error || 'Насыщенность до 300% — рабочий стол и игры в оконном / безрамочном режиме' },
      { st: !e.gamma.ok ? 'err' : e.gamma.mode === 'fallback' ? 'warn' : 'ok',
        title: `Гамма-рампа видеокарты · мониторов: ${e.gamma.monitors}`,
        desc: e.gamma.error || 'Тени, подъём теней, контраст, яркость и температура — работает и в полноэкранных играх' },
      { st: !e.vibrance.vendor ? 'warn' : e.vibrance.ok ? 'ok' : 'err',
        title: e.vibrance.vendor ? `Вибрация драйвера · ${e.vibrance.vendor}` : 'Вибрация драйвера',
        desc: e.vibrance.error || 'Цифровая вибрация через драйвер — как в панели управления видеокарты' },
    ];
    const label = { ok: 'ГОТОВ', warn: 'ЧАСТИЧНО', err: 'ОШИБКА' };
    let worst = 'ok';
    for (const it of items) {
      if (it.st === 'err') worst = 'err'; else if (it.st === 'warn' && worst === 'ok') worst = 'warn';
      row(it.st, label[it.st], it.title, it.desc);
    }
    if (worst !== 'ok') badge.classList.add(worst);
    $('engineSummary').textContent = worst === 'ok' ? 'всё работает' : worst === 'warn' ? 'работает частично' : 'есть ошибки';
  }

  /* ---------------- Состояние ---------------- */

  function onState(s) {
    if (!s) return;
    state = s;
    const dragging = Object.values(channels).some((c) => c.fader.dragging);
    if (!dragging && !sendTimer) {
      local = CM.sanitize(s.settings);
      syncMixer();
      preview.render(local);
    }
    renderState();
    renderBank();
    renderGames();
    renderSystem();
    renderPreviewNote();
  }

  /* ---------------- События ---------------- */

  function bind() {
    document.querySelectorAll('.rail-btn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

    $('btnMin').addEventListener('click', () => api.minimize());
    $('btnMax').addEventListener('click', () => api.toggleMaximize());
    $('btnClose').addEventListener('click', () => api.close());
    document.querySelector('.topbar').addEventListener('dblclick', (e) => {
      if (!e.target.closest('button')) api.toggleMaximize();
    });

    $('btnPower').addEventListener('click', () => api.update({ enabled: !state.enabled }).then(onState));

    // «Сток» — пока зажато, экран без эффекта
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

    // Режим сравнения
    $('compareMode').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      $('compareMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      preview.setMode(b.dataset.mode);
    });

    // Источник картинки
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

    $('btnReset').addEventListener('click', async () => { onState(await api.resetAll()); toast('Сброшено в сток'); });

    // Игры
    $('scopeOptions').addEventListener('click', (e) => {
      const o = e.target.closest('.option');
      if (o) api.update({ scope: o.dataset.scope }).then(onState);
    });
    const addApp = (name) => {
      let n = String(name || '').trim().split(/[\\/]/).pop();
      if (!n) return;
      if (!/\.exe$/i.test(n)) n += '.exe';
      if (state.apps.some((a) => a.toLowerCase() === n.toLowerCase())) { toast('Уже в списке'); return; }
      api.update({ apps: state.apps.concat([n]) }).then(onState);
    };
    $('appInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { addApp($('appInput').value); $('appInput').value = ''; }
    });
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
      btn.textContent = 'Определить окно';
      if (exe) { addApp(exe); toast(`Добавлено: ${exe}`); } else toast('Не удалось определить окно');
    });

    // Система
    $('optAutostart').addEventListener('change', (e) => api.update({ autostart: e.target.checked }).then(onState));
    $('optStartMin').addEventListener('change', (e) => api.update({ startMinimized: e.target.checked }).then(onState));
    $('optTray').addEventListener('change', (e) => api.update({ closeToTray: e.target.checked }).then(onState));
    $('optHotkeys').addEventListener('change', (e) => api.update({ hotkeys: e.target.checked }).then(onState));
    $('btnUnlockGamma').addEventListener('click', async () => {
      const r = await api.unlockGamma();
      msg($('settingsMsg'), r.ok ? 'Готово. Перезагрузите компьютер, чтобы Windows разрешила полный диапазон гаммы.' : r.error, r.ok);
    });
    $('btnQuit').addEventListener('click', () => api.quit());
  }

  /* ---------------- Старт ---------------- */

  async function start() {
    preview = new window.QWEPreview({
      compare: $('compare'), before: $('canvasBefore'), after: $('canvasAfter'), loading: $('compareLoading'),
    });
    buildMixer();
    bind();
    api.onState(onState);
    onState(await api.getState());
    preview.load('assets/sample.jpg').catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', start);
})();
