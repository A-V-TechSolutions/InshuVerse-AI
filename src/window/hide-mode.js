'use strict';
/**
 * Hide Mode — Screen Sharing Protection
 *
 * Extracted from main.js so the hide-mode logic is fully self-contained and
 * testable. Registers the ipcMain.handle for 'toggle-screen-sharing-mode' and
 * exposes helpers used by other modules.
 *
 * OS behaviour:
 *   macOS  — setContentProtection + dock hide + always-on-top all workspaces
 *   Windows — setContentProtection + skip taskbar
 */

const { app, ipcMain } = require('electron');
const path             = require('path');
const fs               = require('fs');
const os               = require('os');
const { APP_STATE }    = require('../state/app-state');
const CH               = require('../ipc/channels');
const { syncAlwaysOnTop } = require('./window-manager');

/** @returns {Electron.BrowserWindow|null} */
function win() { return APP_STATE.mainWindow; }

// ── Safe Mode (hardware acceleration disable) ─────────────────────────────
// Some GPU drivers (older Intel/NVIDIA on Windows with hardware overlay or
// DWM compositor quirks) bypass setContentProtection so the window leaks
// into screen-share buffers. Safe Mode disables Chromium GPU acceleration,
// forcing CPU compositing where setContentProtection is reliably honoured
// by the OS.
//
// Persisted in userData/hide-mode-safe.json so main.js can read it
// synchronously BEFORE app.whenReady() — disableHardwareAcceleration()
// must be called pre-ready to take effect.
const SAFE_MODE_FILE  = 'hide-mode-safe.json';
const STATE_FILE      = 'hide-mode-state.json';

function _safeModePath() {
  try { return path.join(app.getPath('userData'), SAFE_MODE_FILE); }
  catch (_) { return null; }
}

function _statePath() {
  try { return path.join(app.getPath('userData'), STATE_FILE); }
  catch (_) { return null; }
}

function loadSafeModeFlag() {
  const p = _safeModePath();
  if (!p) return false;
  try {
    if (!fs.existsSync(p)) return false;
    return JSON.parse(fs.readFileSync(p, 'utf8')).safeMode === true;
  } catch (_) { return false; }
}

function saveSafeModeFlag(enabled) {
  const p = _safeModePath();
  if (!p) return false;
  try {
    fs.writeFileSync(p, JSON.stringify({ safeMode: !!enabled }));
    return true;
  } catch (e) {
    console.warn('[HIDE] Failed to persist safe-mode flag:', e.message);
    return false;
  }
}

// ── Hide Mode on/off persistence ──────────────────────────────────────────
// Auto-restore: when the user enables Hide Mode and closes the app, the next
// launch should come up already protected. Stored in userData/hide-mode-state.json
// and read at did-finish-load time (after the renderer is wired so the
// toggle UI can sync).
function loadHideModeFlag() {
  const p = _statePath();
  if (!p) return false;
  try {
    if (!fs.existsSync(p)) return false;
    return JSON.parse(fs.readFileSync(p, 'utf8')).hideMode === true;
  } catch (_) { return false; }
}

function saveHideModeFlag(enabled) {
  const p = _statePath();
  if (!p) return false;
  try {
    fs.writeFileSync(p, JSON.stringify({ hideMode: !!enabled, savedAt: new Date().toISOString() }));
    return true;
  } catch (e) {
    console.warn('[HIDE] Failed to persist hide-mode state:', e.message);
    return false;
  }
}

// ── macOS App Translocation detector ──────────────────────────────────────
// First-launch failure root cause: when a notarized DMG is opened directly
// from ~/Downloads, Gatekeeper runs the bundle from a randomized read-only
// AppTranslocation path. NSWindowSharingNone can be silently ignored in
// that mode, so the window leaks into screen captures on the very first
// launch. Once the user copies Angel.app to /Applications, translocation
// lifts and Hide Mode works. We surface the state to the renderer so the
// UI can show a one-time "Move to Applications" banner.
function detectAppTranslocation() {
  if (process.platform !== 'darwin') return false;
  try { return /\/AppTranslocation\//i.test(process.execPath || ''); }
  catch (_) { return false; }
}

// ── Content protection diagnostics ────────────────────────────────────────
// Electron does not expose a getContentProtection() getter, so verification
// is best-effort: (a) the setContentProtection() call completed without
// throwing, and (b) the OS supports the underlying capture-exclusion API.
//
// On Windows, WDA_EXCLUDEFROMCAPTURE was introduced in Windows 10 1903
// (build 18362). Earlier builds fall back to WDA_MONITOR which renders a
// black box during capture instead of full invisibility.
function getProtectionDiagnostics() {
  const out = {
    platform:        process.platform,
    safeModeEnabled: loadSafeModeFlag(),
    capture:         'unknown',
    warning:         null,
  };
  if (process.platform === 'win32') {
    const m = (os.release() || '').match(/^(\d+)\.(\d+)\.(\d+)/);
    const build = m ? parseInt(m[3], 10) : 0;
    if (build >= 18362)      out.capture = 'exclude';
    else if (build > 0)    { out.capture = 'black-box';
      out.warning = 'Windows build ' + build + ' is older than 10 1903; '
                  + 'Hide Mode will render a black box during screen '
                  + 'sharing instead of full invisibility. Update Windows '
                  + 'to 10 1903+ or 11 for full transparency.'; }
  } else if (process.platform === 'darwin') {
    out.capture = 'exclude';
  } else {
    out.warning = 'Hide Mode is only fully supported on macOS and Windows.';
  }
  return out;
}

// ── Re-assertion of content protection ────────────────────────────────────
// Windows is known to drop SetWindowDisplayAffinity on focus / restore /
// show / move events (e.g. after Alt-Tab, minimize-restore, or Win-D).
// macOS is generally robust but the cost is negligible — keep it applied
// across platforms for defence-in-depth.
//
// Listeners read APP_STATE.isInScreenSharingMode so they only re-apply
// while Hide Mode is active. The source of truth lives in app-state.
let _reassertInstalled    = false;
let _reassertWcInstalled  = false;
function _installReassertionListeners() {
  const w = win();
  if (!w || w.isDestroyed()) return;
  const reassert = () => {
    try {
      if (!APP_STATE.isInScreenSharingMode) return;
      const live = win();
      if (!live || live.isDestroyed()) return;
      live.setContentProtection(true);
    } catch (_) {}
  };
  if (!_reassertInstalled) {
    try {
      // Window-level lifecycle events. Idempotent — installed once per process.
      // resize / minimize / maximize / hide are added on top of the original
      // focus / blur / show / restore / move / ready-to-show set so that
      // every state change Windows is known to drop SetWindowDisplayAffinity
      // on is covered. Cheap to re-apply; setContentProtection is a single
      // DWM call.
      w.on('focus',         reassert);
      w.on('restore',       reassert);
      w.on('show',          reassert);
      w.on('blur',          reassert);
      w.on('move',          reassert);
      w.on('resize',        reassert);
      w.on('minimize',      reassert);
      w.on('maximize',      reassert);
      w.on('unmaximize',    reassert);
      w.on('hide',          reassert);
      w.on('ready-to-show', reassert);
      _reassertInstalled = true;
    } catch (_) {}
  }
  if (!_reassertWcInstalled) {
    try {
      // webContents.did-finish-load fires after the renderer has loaded;
      // on first launch this is the latest reliable moment to re-apply
      // setContentProtection so the NSWindow has been fully bound by
      // WindowServer before we assert the sharing-type flag.
      w.webContents.on('did-finish-load', reassert);
      _reassertWcInstalled = true;
    } catch (_) {}
  }
}

// ── Periodic re-assertion while Hide Mode is active ───────────────────────
// Belt-and-suspenders defense against any Windows event we did NOT subscribe
// to that might drop SetWindowDisplayAffinity (e.g. virtual-display changes,
// some HDR-mode transitions, certain GPU driver hot-swaps, RDP reconnects).
// While Hide Mode is enabled we re-assert setContentProtection every
// PERIODIC_REASSERT_MS. The call is a no-op when the flag is already set
// so cost is negligible. Cleared as soon as Hide Mode is disabled.
const PERIODIC_REASSERT_MS = 2000;
let _periodicReassertTimer = null;
function _startPeriodicReassertion() {
  if (_periodicReassertTimer) return;
  _periodicReassertTimer = setInterval(() => {
    try {
      if (!APP_STATE.isInScreenSharingMode) {
        _stopPeriodicReassertion();
        return;
      }
      const live = win();
      if (!live || live.isDestroyed()) return;
      live.setContentProtection(true);
    } catch (_) {}
  }, PERIODIC_REASSERT_MS);
}
function _stopPeriodicReassertion() {
  if (_periodicReassertTimer) {
    try { clearInterval(_periodicReassertTimer); } catch (_) {}
    _periodicReassertTimer = null;
  }
}

// Staggered re-assertion. macOS first-launch can ignore the very first
// setContentProtection(true) call because the NSWindow has not yet been
// committed to the WindowServer compositor. Re-applying the flag at
// 0ms / 150ms / 800ms guarantees at least one call lands on a settled
// window. The cost is three no-ops on warm launches.
const _REASSERT_DELAYS_MS = [0, 150, 800];
function _scheduleStaggeredReassertions(reason) {
  _REASSERT_DELAYS_MS.forEach((delay) => {
    setTimeout(() => {
      try {
        if (!APP_STATE.isInScreenSharingMode) return;
        const live = win();
        if (!live || live.isDestroyed()) return;
        live.setContentProtection(true);
      } catch (e) {
        console.warn('[HIDE] staggered reassert failed (' + reason + ', +' + delay + 'ms):', e.message);
      }
    }, delay);
  });
}

// ── Enable Hide Mode ──────────────────────────────────────────────────────
function enableHideMode() {
  const w = win();
  if (!w || w.isDestroyed()) throw new Error('Window not available');

  // Save window geometry before entering hide mode (once)
  if (!APP_STATE.isInScreenSharingMode) {
    const [width, height] = w.getSize();
    const [x, y]          = w.getPosition();
    APP_STATE.windowState  = { width, height, x, y };
  }

  APP_STATE.isInScreenSharingMode = true;

  // Stealth: hide the OS resize cursor on window edges
  try { w.setResizable(false); } catch (_) {}

  if (process.platform === 'darwin') {
    w.setContentProtection(true);
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    syncAlwaysOnTop('hide-enable-mac');
    w.setWindowButtonVisibility(false);
    w.setOpacity(0.99);
    _redrawWindow(w);
    app.dock.hide();
  } else if (process.platform === 'win32') {
    w.setContentProtection(true);
    syncAlwaysOnTop('hide-enable-win');
    w.setSkipTaskbar(true);
    // The Windows BrowserWindow is `transparent: true` (per-pixel alpha via
    // UpdateLayeredWindow). We deliberately do NOT call setOpacity or
    // setBackgroundColor here: those cycle WS_EX_LAYERED on the HWND and
    // can flip the layered window out of per-pixel-alpha mode, producing
    // a uniform opaque-white rectangle around the rounded container after
    // a Hide-Mode toggle. setContentProtection is the only call needed —
    // DWM applies WDA_EXCLUDEFROMCAPTURE on the next composited frame and
    // the window vanishes from capture buffers. _redrawWindow on Windows
    // is webContents.invalidate(), a cheap repaint hint so the
    // .transparent-mode CSS class change is picked up on the next frame.
    _redrawWindow(w);
  }

  // Cold-start safety net: re-apply setContentProtection three times over
  // the next ~800ms. See _scheduleStaggeredReassertions for rationale.
  _scheduleStaggeredReassertions('enable');

  // Defense-in-depth: keep the WDA flag asserted every 2s while Hide Mode is
  // on. Covers any Windows state-change that we did NOT subscribe to (RDP
  // reconnects, virtual-display swaps, certain HDR-mode transitions, etc.).
  _startPeriodicReassertion();

  w.webContents.send(CH.SCREEN_SHARING_ACTIVE, true);
  console.log('[HIDE] Screen sharing protection enabled');
}

// ── Disable Hide Mode ─────────────────────────────────────────────────────
function disableHideMode() {
  const w = win();
  if (!w || w.isDestroyed()) throw new Error('Window not available');

  APP_STATE.isInScreenSharingMode = false;

  try { w.setResizable(true); } catch (_) {}

  if (process.platform === 'darwin') {
    w.setOpacity(1.0);
    w.setWindowButtonVisibility(true);
    // Keep visible on ALL workspaces — do NOT call setVisibleOnAllWorkspaces(false)
    // as that removes the window from every Space except the current one.
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    app.dock.show();
    syncAlwaysOnTop('hide-disable-mac');
    w.setContentProtection(false);
    _redrawWindow(w);
  } else if (process.platform === 'win32') {
    w.setSkipTaskbar(false);
    syncAlwaysOnTop('hide-disable-win');
    // Clear WDA_EXCLUDEFROMCAPTURE and let DWM composite the next frame
    // normally. We do NOT call setOpacity/setBackgroundColor here — see
    // the matching note in enableHideMode: cycling WS_EX_LAYERED on the
    // per-pixel-alpha layered window can leave a uniform opaque-white
    // rectangle around the rounded container. _redrawWindow on Windows
    // is webContents.invalidate(), which nudges the renderer to drop the
    // .transparent-mode CSS class on the next frame without changing
    // bounds (a setBounds nudge would defeat the alpha mode in the same
    // way setBackgroundColor does).
    w.setContentProtection(false);
    _redrawWindow(w);
  } else {
    w.setContentProtection(false);
    _redrawWindow(w);
  }

  // Stop the periodic re-assertion timer — Hide Mode is off, no more flag to keep alive.
  _stopPeriodicReassertion();

  w.webContents.send(CH.SCREEN_SHARING_ACTIVE, false);
  console.log('[HIDE] Screen sharing protection disabled');
}

// ── Private helpers ───────────────────────────────────────────────────────
/**
 * Force a compositor flush so the renderer drops any stale frame (e.g. the
 * opaque buffer DWM/Chromium holds during a setContentProtection cycle).
 *
 * Platform split:
 *   • Windows — use webContents.invalidate() instead of a setBounds nudge.
 *     The previous bounds-change approach reliably caused the GPU compositor
 *     to reallocate its backing surface with Chromium's default opaque-white
 *     clear color, which is what the user was seeing as "white background
 *     adjusting with lag" during resize and "white layer behind the tool"
 *     after toggling Hide Mode off. invalidate() schedules a full repaint
 *     of the current surface without changing window bounds, so no
 *     reallocation, no white flash. setContentProtection still propagates
 *     through DWM's WDA_EXCLUDEFROMCAPTURE on the next composited frame.
 *   • macOS — keep the single-axis 1 px setBounds nudge. NSWindow's backing
 *     CALayer doesn't have the opaque-white-clear-color quirk, and the nudge
 *     is the cheapest reliable way to force AppKit to re-commit the window's
 *     sharing-type after setContentProtection / vibrancy state changes.
 */
function _redrawWindow(w) {
  try {
    if (process.platform === 'win32') {
      try { w.webContents.invalidate(); } catch (_) {}
      return;
    }
    const b = w.getBounds();
    w.setBounds({ ...b, width: b.width + 1 });
    setTimeout(() => { try { w.setBounds(b); } catch (_) {} }, 10);
  } catch (_) {}
}

// ── IPC handler registration ──────────────────────────────────────────────
/**
 * Call once from main.js after the app is ready.
 * Uses handle() so the renderer can await a result and detect failures.
 */
function registerHideModeHandlers() {
  // Guard: remove any previous handler registered in prior hot-reloads
  try { ipcMain.removeHandler(CH.TOGGLE_SCREEN_SHARING); } catch (_) {}
  try { ipcMain.removeHandler(CH.HIDE_MODE_FLUSH);       } catch (_) {}
  try { ipcMain.removeHandler('hide-mode-get-safe-mode'); } catch (_) {}
  try { ipcMain.removeHandler('hide-mode-set-safe-mode'); } catch (_) {}
  try { ipcMain.removeHandler('hide-mode-diagnostics');   } catch (_) {}

  // Install the focus/restore/show/blur/move re-assertion listeners on the
  // main window. Idempotent — safe to call across hot reloads.
  _installReassertionListeners();

  ipcMain.handle(CH.TOGGLE_SCREEN_SHARING, (_event, isScreenSharing) => {
    console.log(`[HIDE] toggle → ${isScreenSharing}`);
    try {
      if (isScreenSharing) enableHideMode();
      else                 disableHideMode();
      // DISABLED: Hide mode state is no longer persisted to avoid unwanted restoration
      // saveHideModeFlag(!!isScreenSharing);
      // Surface diagnostics so the renderer can show a warning toast when
      // the OS cannot fully apply the protection (older Windows builds,
      // missing Safe Mode on flaky GPU drivers, etc.).
      const diag = getProtectionDiagnostics();
      return { success: true, ...diag };
    } catch (err) {
      console.error('[HIDE] Error:', err.message);
      // Best-effort restore
      try {
        APP_STATE.mainWindow?.setContentProtection(false);
        APP_STATE.mainWindow?.setResizable(true);
        if (process.platform === 'darwin') app.dock.show();
        if (process.platform === 'win32')  APP_STATE.mainWindow?.setSkipTaskbar(false);
      } catch (_) {}
      return { success: false, error: err.message };
    }
  });

  // Compositor flush: forces a 1px resize so macOS/Windows clears any stale
  // backdrop-filter / setContentProtection paint frames. No-op when not in
  // screen-sharing mode (regular compositing handles redraws on its own).
  ipcMain.handle(CH.HIDE_MODE_FLUSH, () => {
    try {
      if (!APP_STATE.isInScreenSharingMode) return { success: true, flushed: false };
      const w = win();
      if (!w || w.isDestroyed()) return { success: false, error: 'no-window' };
      _redrawWindow(w);
      return { success: true, flushed: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Safe Mode read/write — used by Settings UI. Toggling requires a restart
  // because app.disableHardwareAcceleration() must run before whenReady().
  ipcMain.handle('hide-mode-get-safe-mode', () => ({
    enabled:     loadSafeModeFlag(),
    diagnostics: getProtectionDiagnostics(),
  }));
  ipcMain.handle('hide-mode-set-safe-mode', (_event, enabled) => {
    const ok = saveSafeModeFlag(!!enabled);
    return { success: ok, restartRequired: true };
  });
  ipcMain.handle('hide-mode-diagnostics', () => getProtectionDiagnostics());

  // Verification endpoint — used by tests and the renderer's debug panel.
  // Returns current protection status, translocation state, and dock visibility.
  // Electron has no getContentProtection() getter so contentProtected is
  // derived from the canonical APP_STATE flag rather than a direct OS query.
  try { ipcMain.removeHandler('hide-mode-verify'); } catch (_) {}
  ipcMain.handle('hide-mode-verify', () => {
    const w = win();
    return {
      contentProtected:    APP_STATE.isInScreenSharingMode,
      translocated:        detectAppTranslocation(),
      dockHidden:          process.platform === 'darwin'
                             ? (() => { try { return !app.dock.isVisible(); } catch (_) { return false; } })()
                             : false,
      safeModeEnabled:     loadSafeModeFlag(),
      hideModePersistedOn: loadHideModeFlag(),
      windowReady:         !!(w && !w.isDestroyed()),
    };
  });

  // Lightweight translocation query — renderer uses this to decide whether
  // to show the "Move to Applications" banner independent of full-verify.
  try { ipcMain.removeHandler('check-app-translocation'); } catch (_) {}
  ipcMain.handle('check-app-translocation', () => ({
    translocated: detectAppTranslocation(),
    execPath:     process.execPath,
  }));

  console.log('[HIDE] IPC handlers registered');
}

module.exports = {
  registerHideModeHandlers,
  enableHideMode,
  disableHideMode,
  loadSafeModeFlag,
  saveSafeModeFlag,
  loadHideModeFlag,
  saveHideModeFlag,
  detectAppTranslocation,
  getProtectionDiagnostics,
};
