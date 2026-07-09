'use strict';
/**
 * Instant Highlight Response — Angel AI (NEW FEATURE)
 *
 * Allows the user to get an instant AI explanation of any text they have
 * highlighted/selected in ANY application (VS Code, browser, PDF, Slack…).
 *
 * How it works:
 *   1. User highlights text in any app and copies it (Cmd/Ctrl+C).
 *   2. User presses the Angel shortcut  Cmd+Shift+X  (Mac)
 *                                   or  Ctrl+Shift+X (Win/Linux).
 *   3. Angel reads the clipboard, sends the text to the AI, and streams
 *      the answer back to the renderer via the HIGHLIGHT_RESULT channel.
 *   4. The renderer shows a compact "Quick Explain" panel with the answer.
 *
 * Design goals:
 *   • Zero friction  — one keyboard shortcut, no UI to open.
 *   • Isolated context — highlight answers never pollute the main conversation.
 *   • Concise answers — responseSize is always 'small' for quick scanning.
 *   • Privacy-safe  — clipboard text is never stored or logged.
 */

const { globalShortcut, clipboard, ipcMain } = require('electron');
const { APP_STATE }    = require('../../state/app-state');
const CH               = require('../../ipc/channels');
const { getOpenAIKey, getGeminiKey } = require('../../auth/tiers');
const { resolveModel } = require('../model-registry');

const SHORTCUT = process.platform === 'darwin' ? 'Command+Shift+X' : 'Control+Shift+X';
const MAX_CHARS = 4000;

// ── Internal ──────────────────────────────────────────────────────────────
let _registered = false;

function _send(channel, payload) {
  try { APP_STATE.mainWindow?.webContents?.send(channel, payload); } catch (_) {}
}

// ── Prompt builder ────────────────────────────────────────────────────────
function _buildPrompt(text) {
  const profile = APP_STATE.userProfile;
  const context = profile
    ? `The user is a ${profile.jobDescription || 'professional'}.`
    : '';
  return (
    `${context}\n\nThe user highlighted the following text and wants a quick, clear explanation. ` +
    `Be concise (2–4 sentences) unless it is complex code, in which case add a short example.\n\n` +
    `Highlighted text:\n"""\n${text}\n"""\n\nExplain this clearly:`
  );
}

// ── Core handler ──────────────────────────────────────────────────────────
async function handleHighlight() {
  const text = clipboard.readText('clipboard').trim();

  if (!text) {
    _send(CH.HIGHLIGHT_RESULT, {
      error: 'Clipboard is empty. Highlight text and copy it (Cmd/Ctrl+C), then press the shortcut.',
    });
    return;
  }

  if (text.length > MAX_CHARS) {
    _send(CH.HIGHLIGHT_RESULT, {
      error: `Text is too long (${text.length} chars). Please highlight a smaller section (max ${MAX_CHARS} chars).`,
    });
    return;
  }

  // Notify renderer that analysis is starting
  _send(CH.HIGHLIGHT_EXPLAIN, { text });

  try {
    const { getAnswerWithModelSelection } = require('../answer');

    await getAnswerWithModelSelection(_buildPrompt(text), {
      userOpenAIKey:       getOpenAIKey(),
      userGeminiKey:       getGeminiKey(),
      selectedModel:       APP_STATE.selectedModel,
      responseSize:        'small',   // always concise for inline explanations
      conversationHistory: [],        // isolated — never contaminates main chat
      // Route highlight explains to CHAT_NANO (currently gpt-4.1-nano) —
      // cheapest OpenAI tier, fine for short explanations. Resolved through
      // the model registry so deprecation swaps happen in one place.
      openaiModel:         resolveModel('CHAT_NANO'),
      // Minimal self-contained system prompt — bypass the full interview
      // boilerplate so we don't pay for unused context on a one-shot explain.
      userConfiguration:   { mode: 'chatgpt' },
      systemPromptOverride: 'You are Angel AI. Explain the highlighted text the user provides clearly and concisely in the same language as the text. Keep it to 2–4 sentences unless the text is code, in which case add a short example.',

      // Bridge the standard answer-stream events to the highlight channel
      send(streamChannel, payload) {
        if (streamChannel === 'answer-start')
          _send(CH.HIGHLIGHT_RESULT, { start: true });
        else if (streamChannel === 'answer-part')
          _send(CH.HIGHLIGHT_RESULT, { part: payload });
        else if (streamChannel === 'answer-done')
          _send(CH.HIGHLIGHT_RESULT, { done: true });
        else if (streamChannel === 'answer-error')
          _send(CH.HIGHLIGHT_RESULT, { error: payload });
      },
    });
  } catch (err) {
    console.error('[HIGHLIGHT] AI error:', err.message);
    _send(CH.HIGHLIGHT_RESULT, { error: err.message });
  }
}

// ── Registration ──────────────────────────────────────────────────────────
/**
 * Register the global shortcut. Call once from main.js inside app.whenReady().
 * Idempotent — safe to call multiple times (unregisters first if needed).
 */
function registerHighlightShortcut() {
  if (_registered) {
    globalShortcut.unregister(SHORTCUT);
    _registered = false;
  }
  _registered = globalShortcut.register(SHORTCUT, handleHighlight);
  if (_registered) {
    console.log(`[HIGHLIGHT] Shortcut registered: ${SHORTCUT}`);
  } else {
    console.warn(`[HIGHLIGHT] Could not register shortcut ${SHORTCUT} — may be taken by another app`);
  }
  return _registered;
}

function unregisterHighlightShortcut() {
  if (_registered) {
    globalShortcut.unregister(SHORTCUT);
    _registered = false;
    console.log('[HIGHLIGHT] Shortcut unregistered');
  }
}

/** Register the ipcMain handler so the renderer can also trigger a highlight explain. */
function registerHighlightIpcHandler() {
  try { ipcMain.removeHandler(CH.HIGHLIGHT_EXPLAIN); } catch (_) {}
  ipcMain.handle(CH.HIGHLIGHT_EXPLAIN, (_event, text) => {
    if (text) clipboard.writeText(text);
    return handleHighlight();
  });
}

module.exports = {
  registerHighlightShortcut,
  unregisterHighlightShortcut,
  registerHighlightIpcHandler,
  SHORTCUT,
};
