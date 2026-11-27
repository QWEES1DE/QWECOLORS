'use strict';
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut,
  screen, powerMonitor, desktopCapturer, shell,
} = require('electron');

const { Store } = require('./store');
const { ColorEngine } = require('./engine');
const CM = require('../shared/colormath');
const { findPreset, matchPreset } = require('../shared/presets');

app.setAppUserModelId('com.qwees1de.qwecolors');

// Путь к «настоящему» exe (у portable-версии process.execPath указывает во временную папку)
const LAUNCH_EXE = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

if (!app.requestSingleInstanceLock({ version: app.getVersion(), exe: LAUNCH_EXE })) {
  // Уже запущена копия. Если она старее — она сама закроется и перезапустит эту (новую) версию.
  app.quit();
  process.exit(0);
}

/** Сравнение версий вида 1.2.3: >0 если a новее b */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

const ASSETS = path.join(__dirname, '..', 'assets');
let logFile = null;
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}\n`;
  if (!app.isPackaged) process.stdout.write(line);
  try { if (logFile) fs.appendFileSync(logFile, line); } catch (_) { /* ignore */ }
}

let store, engine, win = null, tray = null, quitting = false;
let foreground = { exe: null, inScope: true };
let fgTimer = null;
let peekStock = false; // «Удерживайте — сток»

/* ------------------------------------------------------------------ */
/* Состояние                                                          */
/* ------------------------------------------------------------------ */

function effectiveActive() {
  const d = store.get();
  if (!d.enabled || peekStock) return false;
  if (d.scope === 'everywhere') return true;
  return foreground.inScope;
}

function publicState() {
  const d = store.get();
  return {
    ...d,
    active: effectiveActive(),
    peek: peekStock,
    foreground,
    engine: engine.status,
    version: app.getVersion(),
    hotkeyToggle: 'Ctrl+Alt+Q',
  };
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('state', publicState());
  updateTray();
}

function applyNow() {
  try {
    engine.apply(store.get().settings, effectiveActive());
  } catch (e) {
    log('apply error', e);
  }
  broadcast();
}

function update(patch) {
  const before = store.get();
  const next = { ...patch };
  if (next.settings) {
    next.settings = CM.sanitize({ ...before.settings, ...next.settings });
    // Если пресет явно не указан — определить, совпадают ли значения с каким-то пресетом
    if (!('presetId' in next)) {
      const p = matchPreset(next.settings, before.userPresets);
      next.presetId = p ? p.id : null;
    }
  }
  if ('presetId' in patch && patch.presetId && !patch.settings) {
    const p = findPreset(patch.presetId, before.userPresets);
    if (p) next.settings = CM.sanitize(p.settings);
  }
  store.update(next);
  if ('autostart' in patch) setAutostart(store.get().autostart);
  if ('hotkeys' in patch) registerHotkeys();
  if ('scope' in patch || 'apps' in patch) restartForegroundWatch();
  applyNow();
  return publicState();
}

/* ------------------------------------------------------------------ */
/* Активное окно (режим «только в выбранных играх»)                   */
/* ------------------------------------------------------------------ */

function restartForegroundWatch() {
  clearInterval(fgTimer);
  fgTimer = null;
  const d = store.get();
  if (d.scope !== 'apps' || process.platform !== 'win32') {
    foreground = { exe: null, inScope: true };
    return;
  }
  const win32 = require('./engine/win32');
  const tick = () => {
    let fg = null;
    try { fg = win32.foregroundExe(); } catch (_) { /* ignore */ }
    const exe = fg ? fg.exe : null;
    const ownExe = path.basename(process.execPath).toLowerCase();
    let inScope = foreground.inScope;
    if (exe && exe.toLowerCase() !== ownExe && fg.pid !== process.pid) {
      const list = store.get().apps.map((a) => a.toLowerCase());
      inScope = list.includes(exe.toLowerCase());
    }
    // Пока пользователь в окне QWECOLORS — показываем эффект, чтобы было видно настройку
    if (exe && (exe.toLowerCase() === ownExe)) inScope = true;
    if (exe !== foreground.exe || inScope !== foreground.inScope) {
      const changedScope = inScope !== foreground.inScope;
      foreground = { exe, inScope };
      if (changedScope) applyNow(); else broadcast();
    }
  };
  foreground.inScope = false;
  tick();
  fgTimer = setInterval(tick, 700);
}

/* ------------------------------------------------------------------ */
/* Окно                                                               */
/* ------------------------------------------------------------------ */

function createWindow(show = true) {
  const d = store.get();
  const bounds = d.window || {};
  win = new BrowserWindow({
    width: Math.max(440, bounds.width || 1180),
    height: Math.max(640, bounds.height || 790),
    x: Number.isFinite(bounds.x) ? bounds.x : undefined,
    y: Number.isFinite(bounds.y) ? bounds.y : undefined,
    minWidth: 440,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: '#0b0709',
    title: 'QWECOLORS',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (show) win.show(); });

  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
    store.update({ window: win.getBounds() });
  };
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);

  win.on('close', (e) => {
    if (!quitting && store.get().closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });

  // Внешние ссылки — в браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showWindow() {
  if (!win) createWindow(true);
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

/* ------------------------------------------------------------------ */
/* Трей и горячие клавиши                                             */
/* ------------------------------------------------------------------ */

function trayIcon(active) {
  return nativeImage.createFromPath(path.join(ASSETS, active ? 'tray.png' : 'tray-off.png'));
}

function createTray() {
  tray = new Tray(trayIcon(effectiveActive()));
  tray.on('click', showWindow);
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const d = store.get();
  const active = effectiveActive();
  tray.setImage(trayIcon(active));
  const preset = findPreset(d.presetId, d.userPresets);
  tray.setToolTip(`QWECOLORS — ${d.enabled ? 'включено' : 'выключено'}${preset ? ' · ' + preset.name : ''}`);
  const presetItems = d.userPresets.map((p) => ({
    label: p.name, type: 'radio', checked: d.presetId === p.id,
    click: () => update({ presetId: p.id }),
  }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'QWECOLORS', enabled: false },
    { type: 'separator' },
    { label: d.enabled ? 'Выключить  (Ctrl+Alt+Q)' : 'Включить  (Ctrl+Alt+Q)', click: () => update({ enabled: !d.enabled }) },
    ...(presetItems.length ? [{ label: 'Мои пресеты', submenu: presetItems }] : []),
    { label: 'Открыть', click: showWindow },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } },
  ]));
}

function cyclePreset(dir) {
  const d = store.get();
  const all = d.userPresets;
  if (!all.length) return;
  const idx = all.findIndex((p) => p.id === d.presetId);
  const next = all[(idx + dir + all.length) % all.length];
  update({ presetId: next.id });
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (!store.get().hotkeys) return;
  const reg = (acc, fn) => { try { if (!globalShortcut.register(acc, fn)) log('hotkey busy', acc); } catch (e) { log('hotkey error', acc, e); } };
  reg('Control+Alt+Q', () => update({ enabled: !store.get().enabled }));
  reg('Control+Alt+PageUp', () => cyclePreset(-1));
  reg('Control+Alt+PageDown', () => cyclePreset(1));
}

function setAutostart(on) {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] });
  } catch (e) { log('autostart error', e); }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                */
/* ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('state:get', () => publicState());
  ipcMain.handle('state:update', (_e, patch) => update(patch || {}));

  ipcMain.handle('preset:save', (_e, { name }) => {
    const d = store.get();
    const clean = String(name || '').trim().slice(0, 32) || 'Мой пресет';
    const id = 'user-' + Date.now().toString(36);
    const userPresets = d.userPresets.concat([{ id, name: clean, settings: d.settings }]);
    return update({ userPresets, presetId: id, settings: d.settings });
  });
  ipcMain.handle('preset:delete', (_e, { id }) => {
    const d = store.get();
    const userPresets = d.userPresets.filter((p) => p.id !== id);
    return update({ userPresets, presetId: d.presetId === id ? null : d.presetId });
  });

  ipcMain.handle('screen:capture', async () => {
    const display = screen.getPrimaryDisplay();
    const scale = Math.min(1, 1600 / (display.size.width * display.scaleFactor));
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.size.width * display.scaleFactor * scale),
        height: Math.round(display.size.height * display.scaleFactor * scale),
      },
    });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    return src ? src.thumbnail.toDataURL() : null;
  });

  // «Добавить игру»: через 3 секунды берём exe активного окна
  ipcMain.handle('fg:pick', async () => {
    if (process.platform !== 'win32') return null;
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const fg = require('./engine/win32').foregroundExe();
      if (!fg || fg.pid === process.pid) return null;
      return fg.exe;
    } catch (_) { return null; }
  });

  ipcMain.handle('system:unlockGamma', async () => {
    if (process.platform !== 'win32') return { ok: false, error: 'Только для Windows' };
    // Снимает ограничение Windows на диапазон гамма-рампы (нужны права администратора, потом перезагрузка)
    const cmd = "Start-Process -FilePath reg.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList 'add','\"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ICM\"','/v','GdiIcmGammaRange','/t','REG_DWORD','/d','256','/f'";
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true }, (err) => {
        resolve(err ? { ok: false, error: 'Отменено или нет прав администратора' } : { ok: true });
      });
    });
  });

  ipcMain.handle('engine:peek', (_e, on) => {
    if (peekStock === !!on) return true;
    peekStock = !!on;
    applyNow();
    return true;
  });

  ipcMain.handle('system:resetAll', () => {
    return update({ settings: CM.neutralSettings(), presetId: null });
  });

  ipcMain.on('window:minimize', () => win && win.minimize());
  ipcMain.on('window:toggleMaximize', () => { if (!win) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
  ipcMain.on('window:close', () => win && win.close());
  ipcMain.on('app:quit', () => { quitting = true; app.quit(); });
}

/* ------------------------------------------------------------------ */
/* Жизненный цикл                                                     */
/* ------------------------------------------------------------------ */

app.on('second-instance', (_e, _argv, _cwd, data) => {
  // Запустили более новую версию, пока старая сидит в трее, — уступаем место новой
  if (data && data.version && data.exe && compareVersions(data.version, app.getVersion()) > 0) {
    log(`обнаружена новая версия ${data.version} (${data.exe}) — перезапуск`);
    try { store && store.saveNow(); } catch (_) { /* ignore */ }
    try { engine && engine.shutdown(); } catch (_) { /* ignore */ }
    globalShortcut.unregisterAll();
    app.relaunch({ execPath: data.exe, args: [] });
    quitting = true;
    app.exit(0);
    return;
  }
  showWindow();
});

app.whenReady().then(() => {
  const dir = app.getPath('userData');
  logFile = path.join(dir, 'qwecolors.log');
  try { fs.mkdirSync(dir, { recursive: true }); if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2e6) fs.unlinkSync(logFile); } catch (_) { /* ignore */ }

  store = new Store(dir);
  engine = new ColorEngine({ log });
  engine.init();

  registerIpc();
  restartForegroundWatch();
  applyNow();
  engine.startWatchdog(2000);

  const hidden = process.argv.includes('--hidden') || store.get().startMinimized;
  createWindow(!hidden);
  createTray();
  registerHotkeys();
  setAutostart(store.get().autostart);

  screen.on('display-added', () => engine.onDisplaysChanged());
  screen.on('display-removed', () => engine.onDisplaysChanged());
  screen.on('display-metrics-changed', () => applyNow());
  powerMonitor.on('resume', () => setTimeout(applyNow, 1500));
  powerMonitor.on('unlock-screen', () => setTimeout(applyNow, 800));
  powerMonitor.on('shutdown', () => engine.shutdown());
});

app.on('window-all-closed', (e) => {
  // Остаёмся в трее
  if (!quitting) e.preventDefault();
});

app.on('before-quit', () => { quitting = true; });

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearInterval(fgTimer);
  try { store && store.saveNow(); } catch (_) { /* ignore */ }
  try { engine && engine.shutdown(); } catch (_) { /* ignore */ }
});

process.on('uncaughtException', (e) => log('uncaught', e));
process.on('unhandledRejection', (e) => log('unhandled', e));
