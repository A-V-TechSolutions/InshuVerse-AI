'use strict';
// Run with: node --test src/renderer/audio-startup-noleak.test.js
//
// Regression suite for the macOS mic-indicator leak fix. Two leaks were
// fixed: (1) initMicIfNeeded() was calling initializeRecording() at startup,
// which fired getUserMedia / getDisplayMedia and never released the stream;
// (2) the proactive teardown was closing the AudioContext before stopping
// MediaStreamTracks, which produced the audio_loopback_input_mac_impl.mm
// "Failed to stop a stream that is already stopped" error and left the OS
// indicator stuck.
//
// This file locks in the no-startup-capture contract structurally (matching
// the pattern in reset-conversation.test.js) and runtime-tests the
// window.__activeAudioStreams counter helpers in BaseAudioService.

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'index.html'),
  'utf8'
);

// Extract a function body by walking braces from the first `{` after the
// supplied marker through to its matching `}`. Works for both
// `function name() {` and `const name = () => {` openers.
function extractBody(marker) {
  const startIdx = INDEX_HTML.indexOf(marker);
  assert.notEqual(startIdx, -1, `marker not found: ${marker}`);
  const openIdx = INDEX_HTML.indexOf('{', startIdx);
  assert.notEqual(openIdx, -1, `opening brace not found after: ${marker}`);

  let depth = 0;
  let i = openIdx;
  for (; i < INDEX_HTML.length; i++) {
    const ch = INDEX_HTML[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return INDEX_HTML.slice(startIdx, i);
}

// ── Structural: initMicIfNeeded must not initiate any capture ─────────
test('initMicIfNeeded: never calls getUserMedia / getDisplayMedia', () => {
  const body = extractBody('const initMicIfNeeded = () =>');
  assert.ok(body.length > 100, 'body should be substantive');
  assert.doesNotMatch(body, /getUserMedia/,
    'startup warmup must not directly request a microphone stream');
  assert.doesNotMatch(body, /getDisplayMedia/,
    'startup warmup must not directly request a display-media stream');
});

test('initMicIfNeeded: never calls initializeRecording or captureAudio', () => {
  // initializeRecording() chains into captureAudio() which acquires and
  // never releases a stream. Must not run before user intent.
  const body = extractBody('const initMicIfNeeded = () =>');
  assert.doesNotMatch(body, /initializeRecording\s*\(/,
    'startup warmup must not call initializeRecording');
  assert.doesNotMatch(body, /captureAudio\s*\(/,
    'startup warmup must not call captureAudio');
});

test('initMicIfNeeded: warms up via initializeAudioSystem', () => {
  // The warmup path must use the no-capture initializer so device labels
  // resolve and toggleRecording can start cleanly on the first user click.
  const body = extractBody('const initMicIfNeeded = () =>');
  assert.match(body, /initializeAudioSystem\s*\(/,
    'startup warmup must call initializeAudioSystem (no-capture path)');
});

// ── Structural: initializeAudioSystem must not directly capture ──────
test('initializeAudioSystem: never calls getUserMedia / getDisplayMedia directly', () => {
  // The function may delegate to AudioManager.initialize(), which in turn
  // probes permissions in BaseAudioService — those probes are guarded by
  // try…finally and stop the stream, and instrumented by _trackStream.
  // The renderer-side function itself must not bypass that path.
  const body = extractBody('async function initializeAudioSystem()');
  assert.ok(body.length > 100, 'body should be substantive');
  assert.doesNotMatch(body, /navigator\.mediaDevices\.getUserMedia/,
    'initializeAudioSystem must not bypass AudioManager via direct getUserMedia');
  assert.doesNotMatch(body, /navigator\.mediaDevices\.getDisplayMedia/,
    'initializeAudioSystem must not bypass AudioManager via direct getDisplayMedia');
});

// ── Structural: stopProactiveListening teardown order ────────────────
test('stopProactiveListening: stops tracks before closing AudioContext', () => {
  // On macOS Chromium, closing the AudioContext tears down the loopback
  // implementation; subsequent track.stop() calls then fail with
  // "Failed to stop a stream that is already stopped".
  const body = extractBody('function stopProactiveListening');
  const stopTracksIdx   = body.search(/getTracks\s*\(\s*\)\s*\.\s*forEach\s*\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*=>[^)]*\.stop\s*\(\s*\)/);
  const closeContextIdx = body.search(/proactiveAudioCtx\.close\s*\(\s*\)/);
  assert.notEqual(stopTracksIdx, -1, 'must stop MediaStreamTracks during teardown');
  assert.notEqual(closeContextIdx, -1, 'must close AudioContext during teardown');
  assert.ok(stopTracksIdx < closeContextIdx,
    'tracks must be stopped before the AudioContext is closed');
});

// ── Runtime: BaseAudioService._trackStream maintains a balanced counter ─
test('BaseAudioService._trackStream: increments + decrements window.__activeAudioStreams', () => {
  // Set up a minimal renderer-like global so the static helpers run.
  // We deliberately avoid jsdom — the helpers only touch window and an
  // optional window.require('electron').ipcRenderer.send (skipped here).
  const prevWindow = global.window;
  global.window = { __activeAudioStreams: 0 };

  // Re-require with fresh module cache so the class binds to our window.
  const modPath = require.resolve(path.join(__dirname, '..', 'services', 'audio', 'BaseAudioService.js'));
  delete require.cache[modPath];
  const BaseAudioService = require(modPath);

  // Fake MediaStream / MediaStreamTrack — the helper only needs getTracks(),
  // addEventListener, removeEventListener, and stop() to work.
  const makeFakeTrack = () => {
    const listeners = {};
    return {
      addEventListener:    (ev, fn) => { listeners[ev] = fn; },
      removeEventListener: (ev)     => { delete listeners[ev]; },
      stop:                () => { /* no-op; wrapped stop fires release */ },
      _fire:               (ev) => { if (listeners[ev]) listeners[ev](); },
    };
  };
  const trackA = makeFakeTrack();
  const trackB = makeFakeTrack();
  const fakeStream = { getTracks: () => [trackA, trackB] };

  BaseAudioService._trackStream(fakeStream, 'unit-test');
  assert.equal(global.window.__activeAudioStreams, 2,
    'two tracks should bump the counter to 2');

  trackA.stop();
  assert.equal(global.window.__activeAudioStreams, 1,
    'explicit stop() must decrement the counter');

  trackB._fire('ended');
  assert.equal(global.window.__activeAudioStreams, 0,
    'natural ended event must decrement the counter');

  // Idempotency: a second stop() on an already-released track must not
  // double-decrement (would otherwise drive the counter negative on
  // streams whose ended event fires after an explicit stop).
  trackA.stop();
  assert.equal(global.window.__activeAudioStreams, 0,
    'double-release must clamp at 0');

  global.window = prevWindow;
});
