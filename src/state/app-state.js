'use strict';
/**
 * Centralized Application State — Angel AI
 *
 * All mutable main-process state lives in a single exported object (APP_STATE).
 * Every module that previously declared its own `let` variables now imports
 * and mutates this shared object instead.
 *
 * Pattern:
 *   const { APP_STATE } = require('../state/app-state');
 *   APP_STATE.isRecording = true;
 *
 * This is intentionally a plain object (not a class) for simplicity.
 * Electron main-process modules are singletons — Node's module cache ensures
 * every `require` of this file returns the exact same object reference.
 */

const state = {

  // ── BrowserWindow ─────────────────────────────────────────────────────────
  /** @type {Electron.BrowserWindow|null} */
  mainWindow: null,

  /** Last-known window geometry; restored on next launch */
  windowState: { width: 380, height: 680, x: null, y: null },

  // ── Recording / Voice ─────────────────────────────────────────────────────
  isRecording:          false,
  isProcessingAudio:    false,

  // ── Screen Sharing / Hide Mode ────────────────────────────────────────────
  isInScreenSharingMode: false,

  // ── Always-on-Top ─────────────────────────────────────────────────────────
  alwaysOnTopEnabled:         true,
  /** True while the sign-in screen is shown; suspends AoT so modal dialogs work */
  authAlwaysOnTopSuspended:   false,

  // ── AI / Model preferences ────────────────────────────────────────────────
  selectedModel: 'default',   // 'default' | 'openai' | 'gemini'
  responseSize:  'small',     // 'small' | 'medium' | 'big'
  screenshotMode: 'online_tests',

  // ── Authentication & Plan ─────────────────────────────────────────────────
  /** @type {import('firebase/auth').User|null} */
  currentUser: null,

  /**
   * Result of checkUserPlan(uid).
   * Shape: { planName, credits, isLifetimePlan, isPaidUser, … }
   * @type {object|null}
   */
  currentPlan: null,

  /**
   * Lifetime-user-supplied API keys (stored in Firebase, never in code).
   * @type {{ openai: string, gemini: string }}
   */
  lifetimeUserKeys: { openai: '', gemini: '' },

  // ── Conversation History (shared across voice / vision / chat) ────────────
  /** @type {Array<{role:'user'|'assistant', content: string}>} */
  conversationHistory: [],

  // ── Onboarding / Profile ──────────────────────────────────────────────────
  /** @type {{ resume: string, jobDescription: string }|null} */
  userProfile: null,

  // ── Misc ──────────────────────────────────────────────────────────────────
  appVersion: '',
  preferredTranslationLanguage: 'en',
};

module.exports = { APP_STATE: state };
