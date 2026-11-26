'use strict';
/*
 * Привязки к WinAPI через koffi (FFI). Загружаются лениво и только в Windows.
 */

let cache = null;

function load() {
  if (cache) return cache;
  if (process.platform !== 'win32') throw new Error('WinAPI доступен только в Windows');
  const koffi = require('koffi');

  const user32 = koffi.load('user32.dll');
  const gdi32 = koffi.load('gdi32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const api = {
    koffi,
    // --- дисплеи и гамма ---
    EnumDisplayDevicesW: user32.func('int __stdcall EnumDisplayDevicesW(void *lpDevice, uint32_t iDevNum, void *lpDisplayDevice, uint32_t dwFlags)'),
    GetDC: user32.func('void * __stdcall GetDC(void *hwnd)'),
    ReleaseDC: user32.func('int __stdcall ReleaseDC(void *hwnd, void *hdc)'),
    CreateDCW: gdi32.func('void * __stdcall CreateDCW(str16 driver, str16 device, void *output, void *initData)'),
    DeleteDC: gdi32.func('int __stdcall DeleteDC(void *hdc)'),
    SetDeviceGammaRamp: gdi32.func('int __stdcall SetDeviceGammaRamp(void *hdc, void *ramp)'),
    GetDeviceGammaRamp: gdi32.func('int __stdcall GetDeviceGammaRamp(void *hdc, void *ramp)'),

    // --- активное окно ---
    GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)'),
    OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
    QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, void *exeName, _Inout_ uint32_t *size)'),
    CloseHandle: kernel32.func('int __stdcall CloseHandle(void *h)'),

    // --- загрузка драйверных DLL ---
    GetModuleHandleW: kernel32.func('void * __stdcall GetModuleHandleW(str16 name)'),
    LoadLibraryW: kernel32.func('void * __stdcall LoadLibraryW(str16 name)'),
    GetProcAddress: kernel32.func('void * __stdcall GetProcAddress(void *module, str name)'),
    GetLastError: kernel32.func('uint32_t __stdcall GetLastError()'),
  };

  cache = api;
  return api;
}

/** Список подключённых к рабочему столу мониторов: [{ name: '\\\\.\\DISPLAY1', primary }] */
function listDisplays() {
  const w = load();
  const SIZE = 840; // sizeof(DISPLAY_DEVICEW)
  const out = [];
  for (let i = 0; i < 32; i++) {
    const buf = Buffer.alloc(SIZE);
    buf.writeUInt32LE(SIZE, 0);
    if (!w.EnumDisplayDevicesW(null, i, buf, 0)) break;
    const name = buf.toString('utf16le', 4, 68).replace(/\0.*$/s, '');
    const desc = buf.toString('utf16le', 68, 324).replace(/\0.*$/s, '');
    const flags = buf.readUInt32LE(324);
    const ATTACHED = 0x1, PRIMARY = 0x4, MIRROR = 0x8;
    if ((flags & ATTACHED) && !(flags & MIRROR)) out.push({ name, description: desc, primary: !!(flags & PRIMARY) });
  }
  return out;
}

/** Имя exe активного окна (например, "RobloxPlayerBeta.exe") или null. */
function foregroundExe() {
  const w = load();
  const hwnd = w.GetForegroundWindow();
  if (!hwnd) return null;
  const pid = [0];
  w.GetWindowThreadProcessId(hwnd, pid);
  if (!pid[0]) return null;
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const h = w.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid[0]);
  if (!h) return null;
  try {
    const buf = Buffer.alloc(1040);
    const size = [520];
    if (!w.QueryFullProcessImageNameW(h, 0, buf, size)) return null;
    const full = buf.toString('utf16le', 0, size[0] * 2);
    return { pid: pid[0], path: full, exe: full.split('\\').pop() };
  } finally {
    w.CloseHandle(h);
  }
}

module.exports = { load, listDisplays, foregroundExe };
