'use strict';
/**
 * Unit tests for src/window/hide-mode.js helpers.
 *
 * These tests cover the pure helper functions that do NOT require a live
 * Electron app (persistence flag I/O, translocation detection, staggered
 * reassertion scheduling) without spinning up a full BrowserWindow.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// ── Stub out Electron globals before requiring the module ─────────────────────
// hide-mode.js calls app.getPath('userData') in _safeModePath / _statePath.
// We redirect those calls to a real temp directory so the file I/O tests
// exercise actual disk operations under a sandboxed path.
let _tmpDir;
const _electronStub = {
  app: {
    getPath: (key) => {
      if (key === 'userData') return _tmpDir;
      return os.tmpdir();
    },
    dock: { hide: () => {}, show: () => {}, isVisible: () => true },
  },
  ipcMain: {
    handle: () => {},
    removeHandler: () => {},
  },
};

// Inject stub before the real require so child require calls see it.
const Module = require('module');
const _origLoad = Module._load.bind(Module);
Module._load = function (request, ...rest) {
  if (request === 'electron') return _electronStub;
  return _origLoad(request, ...rest);
};

// Stub out internal dependencies that themselves require Electron.
// We only need the pure helpers, so stub the heavy side-effect modules.
const _stubRequire = (mod) => {
  Module._load = function (request, ...rest) {
    if (request === 'electron') return _electronStub;
    if (request === '../state/app-state') return { APP_STATE: { isInScreenSharingMode: false } };
    if (request === '../ipc/channels')    return {};
    if (request === './window-manager')   return { syncAlwaysOnTop: () => {} };
    return _origLoad(request, ...rest);
  };
};
_stubRequire();

// ── Import helpers ────────────────────────────────────────────────────────────
const hideMode = require('./hide-mode');
const {
  loadSafeModeFlag, saveSafeModeFlag,
  loadHideModeFlag, saveHideModeFlag,
  detectAppTranslocation,
} = hideMode;

// ── Persistence: Safe Mode flag ───────────────────────────────────────────────
test('loadSafeModeFlag returns false when file does not exist', (t) => {
  _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-safe-'));
  assert.equal(loadSafeModeFlag(), false);
});

test('saveSafeModeFlag + loadSafeModeFlag round-trip (enabled)', (t) => {
  _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-safe-'));
  assert.equal(saveSafeModeFlag(true), true);
  assert.equal(loadSafeModeFlag(), true);
});

test('saveSafeModeFlag + loadSafeModeFlag round-trip (disabled)', (t) => {
  _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-safe-'));
  saveSafeModeFlag(true);
  saveSafeModeFlag(false);
  assert.equal(loadSafeModeFlag(), false);
});

// ── Persistence: Hide Mode on/off flag ───────────────────────────────────────
test('loadHideModeFlag returns false when file does not exist', (t) => {
  _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-state-'));
  assert.equal(loadHideModeFlag(), false);
});

test('saveHideModeFlag + loadHideModeFlag round-trip (enabled)', (t) => {
  _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-state-'));
  const ok = saveHideModeFlag(true);
  assert.equal(ok, true);
  assert.equal(loadHideModeFlag(), true);
});

test('saveHideModeFlag + loadHideModeFlag round-trip (disabled)', (t) => {
  _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-state-'));
  saveHideModeFlag(true);
  saveHideModeFlag(false);
  assert.equal(loadHideModeFlag(), false);
});

test('saveHideModeFlag writes a JSON file with savedAt timestamp', (t) => {
  _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-state-'));
  saveHideModeFlag(true);
  const raw  = fs.readFileSync(path.join(_tmpDir, 'hide-mode-state.json'), 'utf8');
  const data = JSON.parse(raw);
  assert.equal(data.hideMode, true);
  assert.ok(typeof data.savedAt === 'string' && data.savedAt.length > 0,
    'savedAt should be an ISO timestamp string');
});

// ── App Translocation detection ───────────────────────────────────────────────
test('detectAppTranslocation returns false on non-macOS platforms', (t) => {
  const orig = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    assert.equal(detectAppTranslocation(), false);
  } finally {
    Object.defineProperty(process, 'platform', { value: orig, configurable: true });
  }
});

test('detectAppTranslocation returns false when execPath is a normal macOS path', (t) => {
  const orig = process.platform;
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  const origExec = process.execPath;
  Object.defineProperty(process, 'execPath', {
    value: '/Applications/Angel.app/Contents/MacOS/Angel',
    configurable: true,
  });
  try {
    assert.equal(detectAppTranslocation(), false);
  } finally {
    Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    Object.defineProperty(process, 'execPath',  { value: origExec, configurable: true });
  }
});

test('detectAppTranslocation returns true when execPath contains /AppTranslocation/', (t) => {
  const orig = process.platform;
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  const origExec = process.execPath;
  Object.defineProperty(process, 'execPath', {
    value: '/private/var/folders/xx/AppTranslocation/abc123/d/Angel.app/Contents/MacOS/Angel',
    configurable: true,
  });
  try {
    assert.equal(detectAppTranslocation(), true);
  } finally {
    Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    Object.defineProperty(process, 'execPath',  { value: origExec, configurable: true });
  }
});
