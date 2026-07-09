'use strict';
/**
 * Window Manager — Angel AI
 *
 * Owns BrowserWindow creation, always-on-top logic, and window-level
 * utility helpers. Extracted from the monolithic main.js so that window
 * concerns are decoupled from IPC, auth, and AI logic.
 */

const { BrowserWindow, screen, ipcMain, shell } = require('electron');
const path  = require('path');
const { APP_STATE } = require('../state/app-state');

// ── Always-on-top ──────────────────────────────────────────────────────────
/**
 * Apply the correct always-on-top level for the current platform.
 * @param {boolean} enabled
 */
function applyPlatformAlwaysOnTop(enabled) {
  const win = APP_STATE.mainWindow;
  if (!win || win.isDestroyed()) return;
  if (process.platform === 'darwin') {
    win.setAlwaysOnTop(enabled, 'floating', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    win.setAlwaysOnTop(enabled, 'pop-up-menu');
  }
}

/**
 * Synchronise always-on-top state using APP_STATE flags.
 * Call this whenever either flag changes.
 * @param {string} [caller] — optional debug label
 */
function syncAlwaysOnTop(caller = '') {
  const { alwaysOnTopEnabled, authAlwaysOnTopSuspended } = APP_STATE;
  const should = alwaysOnTopEnabled && !authAlwaysOnTopSuspended;
  console.log(`[AOT] syncAlwaysOnTop(${caller}): enabled=${alwaysOnTopEnabled} suspended=${authAlwaysOnTopSuspended} → ${should}`);
  applyPlatformAlwaysOnTop(should);
}

/** Temporarily disable AoT (e.g., while sign-in modal is open). */
function suspendAlwaysOnTop() {
  APP_STATE.authAlwaysOnTopSuspended = true;
  syncAlwaysOnTop('suspend');
}

/** Re-enable AoT after the modal is dismissed. */
function resumeAlwaysOnTop() {
  APP_STATE.authAlwaysOnTopSuspended = false;
  syncAlwaysOnTop('resume');
}

// ── Window creation ────────────────────────────────────────────────────────
/**
 * Create and return the main BrowserWindow.
 * Stores the reference in APP_STATE.mainWindow.
 * @returns {Electron.BrowserWindow}
 */
function createMainWindow() {
  const { windowState } = APP_STATE;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  // Default position: right-center of the primary display
  const x = windowState.x ?? Math.round(sw - windowState.width - 40);
  const y = windowState.y ?? Math.round((sh - windowState.height) / 2);

  const win = new BrowserWindow({
    width:           windowState.width,
    height:          windowState.height,
    x,
    y,
    transparent:     true,
    backgroundColor: '#00000000',
    frame:           false,
    resizable:       true,
    movable:         true,
    hasShadow:       true,
    skipTaskbar:     false,
    titleBarStyle:   'hidden',
    vibrancy:        'sidebar',
    visualEffectState: 'followWindow',
    roundedCorners:  true,
    webPreferences: {
      nodeIntegration:       true,
      contextIsolation:      false,
      backgroundThrottling:  false,
      devTools:              false,
    },
  });

  APP_STATE.mainWindow = win;

  // Persist window geometry on every move/resize
  const saveGeometry = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const [w, h] = win.getSize();
    const [px, py] = win.getPosition();
    APP_STATE.windowState = { width: w, height: h, x: px, y: py };
  };
  win.on('resize', saveGeometry);
  win.on('moved',  saveGeometry);

  // Open external links in the system browser, not a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadFile(path.join(__dirname, '../../index.html'));

  // Apply always-on-top after the window is ready to show
  win.once('ready-to-show', () => syncAlwaysOnTop('window-ready'));

  return win;
}

module.exports = {
  createMainWindow,
  syncAlwaysOnTop,
  suspendAlwaysOnTop,
  resumeAlwaysOnTop,
  applyPlatformAlwaysOnTop,
};
