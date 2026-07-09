'use strict';
/**
 * Ghost Typing — synthesizes human-paced keystrokes into the focused window.
 *
 * Trigger: Cmd/Ctrl+Shift+V (registered in main.js). Reads the current
 * clipboard text and types it character-by-character with variable cadence,
 * occasional thinking pauses, and a small chance of typo+backspace+correct
 * — so monitoring tools (and humans) see organic typing instead of an
 * instant paste.
 *
 * Cancel triggers (any of):
 *   • Re-press Cmd/Ctrl+Shift+V  (handled in main.js, calls stop()).
 *   • Mouse pointer moves > MOUSE_MOVE_PX from the cursor position sampled
 *     when typing started.
 *
 * macOS requires Accessibility permission for the Electron binary. The
 * service exposes checkPermission() / requestPermission() so the renderer
 * can drive a one-time onboarding flow.
 */

const { systemPreferences } = require('electron');

let _nut = null;          // lazy-loaded @nut-tree-fork/nut-js handle
let _loadError = null;    // sticky error from the first failed require
let _typing = false;      // active session flag
let _abort = false;       // cooperative cancel flag observed by typing loop
let _watchdog = null;     // mouse-move polling interval
let _onStatus = null;     // optional status callback (set by main.js)

const MOUSE_MOVE_PX = 12;            // pixels of jitter tolerated before cancel
const PRE_TYPE_DELAY_MS = 120;       // wait for shortcut modifiers to release
const SPACE_SPEEDUP = 0.7;           // spaces/punct slightly faster
const TYPO_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

// Speed profiles. 'fast' is the original default; 'slow' / 'very-slow' add
// more padding between keys, longer thinking pauses, and slightly more
// frequent typo+correction cycles so the cadence reads as deliberate
// (e.g. when typing into a monitored text box where speed is the tell).
const SPEED_PROFILES = {
  'fast':      { base: 70,  jitter: 50, pauseEvery: [12, 22], pauseMs: [220, 480], typo: 0.04 },
  'slow':      { base: 140, jitter: 70, pauseEvery: [10, 18], pauseMs: [380, 720], typo: 0.05 },
  'very-slow': { base: 230, jitter: 90, pauseEvery: [8,  14], pauseMs: [550, 1050], typo: 0.06 },
};
const DEFAULT_SPEED = 'fast';

function _profile(speed) {
  return SPEED_PROFILES[speed] || SPEED_PROFILES[DEFAULT_SPEED];
}

function _emit(state, extra) {
  try { _onStatus && _onStatus({ state, ...(extra || {}) }); } catch (_) {}
}

function _loadNut() {
  if (_nut || _loadError) return _nut;
  try {
    _nut = require('@nut-tree-fork/nut-js');
    // We control all timing ourselves; default 300 ms is far too slow.
    _nut.keyboard.config.autoDelayMs = 0;
  } catch (e) {
    _loadError = e;
    console.warn('[GT] nut.js unavailable:', e.message);
  }
  return _nut;
}

function _sleep(ms) { return new Promise(r => setTimeout(r, Math.max(0, ms))); }
function _rand(a, b) { return a + Math.random() * (b - a); }

/** macOS-only: is the Electron binary trusted for Accessibility? */
function checkPermission() {
  if (process.platform !== 'darwin') return { granted: true, platform: process.platform };
  try {
    const granted = systemPreferences.isTrustedAccessibilityClient(false);
    return { granted, platform: 'darwin' };
  } catch (e) { return { granted: false, platform: 'darwin', error: String(e) }; }
}

/** macOS-only: prompts the user (opens System Settings → Accessibility). */
function requestPermission() {
  if (process.platform !== 'darwin') return { granted: true, platform: process.platform };
  try {
    const granted = systemPreferences.isTrustedAccessibilityClient(true);
    return { granted, platform: 'darwin' };
  } catch (e) { return { granted: false, platform: 'darwin', error: String(e) }; }
}

function isAvailable() {
  if (_nut) return { ok: true };
  if (_loadError) return { ok: false, error: _loadError.message };
  _loadNut();
  if (_nut) return { ok: true };
  return { ok: false, error: _loadError ? _loadError.message : 'nut.js failed to load' };
}

function isTyping() { return _typing; }

function setStatusListener(fn) { _onStatus = (typeof fn === 'function') ? fn : null; }

function stop(reason) {
  if (!_typing) return false;
  _abort = true;
  _emit('stopping', { reason: reason || 'user' });
  return true;
}

async function _armMouseWatchdog() {
  const nut = _nut;
  let origin;
  try { origin = await nut.mouse.getPosition(); } catch (_) { origin = null; }
  if (!origin) return;
  if (_watchdog) clearInterval(_watchdog);
  _watchdog = setInterval(async () => {
    if (!_typing) return;
    try {
      const p = await nut.mouse.getPosition();
      const dx = p.x - origin.x, dy = p.y - origin.y;
      if ((dx * dx + dy * dy) > (MOUSE_MOVE_PX * MOUSE_MOVE_PX)) {
        stop('mouse-move');
      }
    } catch (_) {}
  }, 80);
}

function _disarmMouseWatchdog() {
  if (_watchdog) { clearInterval(_watchdog); _watchdog = null; }
}

async function start(text, opts) {
  if (_typing) return { ok: false, error: 'Already typing.' };
  const av = isAvailable();
  if (!av.ok) return { ok: false, error: av.error };
  const perm = checkPermission();
  if (!perm.granted) return { ok: false, error: 'permission-required', platform: perm.platform };
  const body = String(text || '');
  if (!body.trim()) return { ok: false, error: 'Clipboard is empty.' };
  const prof = _profile(opts && opts.speed);

  _typing = true; _abort = false;
  _emit('start', { length: body.length, speed: (opts && opts.speed) || DEFAULT_SPEED });
  await _sleep(PRE_TYPE_DELAY_MS);
  await _armMouseWatchdog();

  const nut = _nut, Key = nut.Key;
  let nextPauseAt = Math.floor(_rand(prof.pauseEvery[0], prof.pauseEvery[1]));
  try {
    for (let i = 0; i < body.length; i++) {
      if (_abort) break;
      const ch = body[i];
      const isWS = /\s/.test(ch);
      const isLetter = /[a-zA-Z]/.test(ch);
      // Occasional typo + backspace + correct (only on letters, not at line starts)
      if (isLetter && Math.random() < prof.typo && i > 0 && !/\s/.test(body[i - 1])) {
        const wrong = TYPO_LETTERS[Math.floor(Math.random() * TYPO_LETTERS.length)];
        await nut.keyboard.type(wrong);
        await _sleep(_rand(120, 260));
        if (_abort) break;
        await nut.keyboard.pressKey(Key.Backspace);
        await nut.keyboard.releaseKey(Key.Backspace);
        await _sleep(_rand(60, 140));
        if (_abort) break;
      }
      await nut.keyboard.type(ch);
      const base = isWS ? prof.base * SPACE_SPEEDUP : prof.base;
      await _sleep(base + _rand(-prof.jitter, prof.jitter));
      if (--nextPauseAt <= 0) {
        await _sleep(_rand(prof.pauseMs[0], prof.pauseMs[1]));
        nextPauseAt = Math.floor(_rand(prof.pauseEvery[0], prof.pauseEvery[1]));
      }
    }
    const aborted = _abort;
    _emit(aborted ? 'cancelled' : 'done');
    return { ok: true, aborted };
  } catch (e) {
    console.error('[GT] type error:', e.message);
    _emit('error', { error: e.message });
    return { ok: false, error: e.message };
  } finally {
    _typing = false; _abort = false;
    _disarmMouseWatchdog();
  }
}

module.exports = {
  start, stop, isTyping, isAvailable, checkPermission, requestPermission,
  setStatusListener, SPEED_PROFILES, DEFAULT_SPEED,
};
