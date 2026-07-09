'use strict';
/**
 * IPC Channel Name Constants
 *
 * Single source of truth for every IPC channel used between the main process
 * and the renderer. Import this in any file that sends or listens on a channel.
 * Using constants eliminates the class of bugs caused by mismatched string literals.
 *
 * Convention: group channels by domain; prefix renderer→main with a verb;
 * prefix main→renderer notifications with a noun or past-tense verb.
 */
module.exports = Object.freeze({

  // ── Voice / Audio ─────────────────────────────────────────────────────────
  TOGGLE_RECORDING:       'toggle-recording',
  TRANSCRIBE_AUDIO:       'transcribe-audio',
  PLAY_AUDIO:             'play-audio',
  RECORDING_STARTED:      'recording-started',
  RECORDING_STOPPED:      'recording-stopped',
  AUDIO_LEVEL:            'audio-level',

  // ── Answer / AI Stream ────────────────────────────────────────────────────
  GET_ANSWER:             'get-answer',
  ANSWER_START:           'answer-start',
  ANSWER_PART:            'answer-part',
  ANSWER_DONE:            'answer-done',
  ANSWER_STATUS:          'answer-status',
  ANSWER_ERROR:           'answer-error',

  // ── Screenshot / Vision ───────────────────────────────────────────────────
  TAKE_SCREENSHOT:        'take-screenshot',
  SCREENSHOT_CAPTURED:    'screenshot-captured',
  SCREENSHOT_ERROR:       'screenshot-error',
  SCREENSHOT_ANSWER:      'screenshot-answer',

  // ── Instant Highlight Response (NEW) ──────────────────────────────────────
  // Cmd/Ctrl+Shift+X → read clipboard → AI explanation → renderer shows result
  HIGHLIGHT_EXPLAIN:      'highlight-explain',   // main → renderer: clipboard text incoming
  HIGHLIGHT_RESULT:       'highlight-result',    // main → renderer: streamed answer parts

  // ── Window / Hide Mode ────────────────────────────────────────────────────
  TOGGLE_SCREEN_SHARING:  'toggle-screen-sharing-mode',
  SCREEN_SHARING_ACTIVE:  'screen-sharing-active',
  HIDE_MODE_FLUSH:        'hide-mode-flush',
  SET_TRANSPARENCY:       'set-transparency',
  SET_ALWAYS_ON_TOP:      'set-always-on-top',
  MINIMIZE_WINDOW:        'minimize-window',
  CLOSE_WINDOW:           'close-window',
  WINDOW_READY:           'window-ready',
  WINDOW_MOVE:            'window-move',

  // ── Authentication ────────────────────────────────────────────────────────
  FIREBASE_SIGN_IN:       'firebase-sign-in',
  FIREBASE_SIGN_OUT:      'firebase-sign-out',
  AUTH_STATE_CHANGED:     'auth-state-changed',
  GET_USER_PLAN:          'get-user-plan',
  REFRESH_CREDITS:        'refresh-credits',
  DEDUCT_CREDITS:         'deduct-credits',

  // ── Settings / API Keys ───────────────────────────────────────────────────
  GET_API_KEYS:           'get-api-keys',
  SAVE_API_KEYS:          'save-api-keys',
  TEST_API_KEY:           'test-api-key',
  SET_RESPONSE_SIZE:      'set-response-size',
  SET_MODEL_SELECTION:    'set-model-selection',
  GET_MODEL_SELECTION:    'get-model-selection',

  // ── System / Shell ────────────────────────────────────────────────────────
  OPEN_EXTERNAL_URL:      'open-external-url',
  CHECK_UPDATE:           'check-update',
  APP_VERSION:            'app-version',
  SHOW_HISTORY:           'show-history',
  RESTART_APP:            'restart-app',
  GET_MIC_DEVICES:        'get-mic-devices',
  TEST_AUDIO:             'test-audio',

  // ── Profile / Onboarding ──────────────────────────────────────────────────
  SAVE_PROFILE:           'save-profile',
  GET_PROFILE:            'get-profile',
  PROFILE_UPDATED:        'profile-updated',
});
