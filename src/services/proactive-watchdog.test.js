'use strict';
// Run with: node --test src/services/proactive-watchdog.test.js
//
// Structural regression suite for the proactive open-handshake watchdog in
// main.js#proactive-start. The watchdog short-circuits a stalled WS upgrade
// (DNS hang, regional outage, captive portal) by promoting it to a silent
// fallover within OPEN_WATCHDOG_MS — without this, the wrappers' 3-step
// reconnect ladder takes ~3.5s before declaring `terminal:true`, which the
// user perceives as a frozen mic.
//
// main.js can't be `require()`-d directly (Electron runtime), so this file
// reads the source and asserts the wiring is in place via regex — same
// pattern used by audio-startup-noleak.test.js for index.html.

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

const MAIN_JS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'main.js'),
  'utf8'
);

// Extract a function body by walking braces from the first `{` after the
// supplied marker through to its matching `}`. Mirrors the pattern in
// audio-startup-noleak.test.js so a non-greedy regex doesn't truncate at
// the first inner `}` (e.g. arrow-function literals inside the body).
function extractBody(marker) {
  const startIdx = MAIN_JS.indexOf(marker);
  assert.notEqual(startIdx, -1, `marker not found in main.js: ${marker}`);
  const openIdx = MAIN_JS.indexOf('{', startIdx);
  assert.notEqual(openIdx, -1, `opening brace not found after: ${marker}`);
  let depth = 0;
  for (let i = openIdx; i < MAIN_JS.length; i++) {
    const ch = MAIN_JS[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return MAIN_JS.slice(openIdx + 1, i);
    }
  }
  throw new Error('unbalanced braces after marker: ' + marker);
}

test('OPEN_WATCHDOG_MS constant is declared at the proactive-state block', () => {
  // The constant must live alongside the other proactive-session module
  // state so a future refactor of that block keeps the wiring co-located.
  assert.match(MAIN_JS, /const\s+OPEN_WATCHDOG_MS\s*=\s*\d+/,
    'OPEN_WATCHDOG_MS must be declared as a const with a numeric value');
  assert.match(MAIN_JS, /let\s+_proactiveOpenWatchdog\s*=\s*null/,
    'module-scoped _proactiveOpenWatchdog timer handle must be declared');
});

test('_startProvider arms the open-handshake watchdog before invoking the wrapper', () => {
  // Locate _startProvider's body and assert it sets _proactiveOpenWatchdog
  // BEFORE the `wrapper.start(...)` call so a synchronous throw inside the
  // wrapper still leaves a clearable timer (cleaned up by the catch block).
  const body = extractBody('function _startProvider(');
  assert.match(body, /_proactiveOpenWatchdog\s*=\s*setTimeout\s*\(/,
    '_startProvider must arm the watchdog via setTimeout');
  assert.match(body, /OPEN_WATCHDOG_MS/,
    '_startProvider must reference the OPEN_WATCHDOG_MS constant for the delay');
  const armIdx   = body.indexOf('setTimeout(');
  const startIdx = body.indexOf('wrapper.start(');
  assert.ok(armIdx >= 0 && startIdx >= 0,
    'both setTimeout(...) and wrapper.start(...) must appear in _startProvider');
  assert.ok(armIdx < startIdx,
    'watchdog must be armed BEFORE wrapper.start() is invoked');
});

test('onOpen clears the open-handshake watchdog on a successful upgrade', () => {
  // The first successful WS open MUST null the timer so a subsequent stall
  // doesn't fire stale. Search for the clear pattern within the
  // _buildSessionConfig body (use the function name as the marker).
  const cfgBody = extractBody('function _buildSessionConfig(');
  // The clear pattern must appear inside an onOpen handler. We assert both
  // the handler exists and that the clearTimeout/null pair is present.
  assert.match(cfgBody, /onOpen:\s*\(/, 'onOpen handler must exist in _buildSessionConfig');
  assert.match(cfgBody, /clearTimeout\s*\(\s*_proactiveOpenWatchdog\s*\)/,
    '_buildSessionConfig must clearTimeout(_proactiveOpenWatchdog) inside onOpen');
  assert.match(cfgBody, /_proactiveOpenWatchdog\s*=\s*null/,
    '_buildSessionConfig must null _proactiveOpenWatchdog after clearing');
});

test('_stopProactiveSession defensively clears the watchdog on any teardown', () => {
  // Every teardown path (user stop, restart, exhausted credits, error) routes
  // through _stopProactiveSession, so this is the single chokepoint that must
  // null the watchdog so it cannot fire after the session is gone.
  const body = extractBody('function _stopProactiveSession(');
  assert.match(body, /clearTimeout\s*\(\s*_proactiveOpenWatchdog\s*\)/,
    '_stopProactiveSession must clearTimeout(_proactiveOpenWatchdog)');
  assert.match(body, /_proactiveOpenWatchdog\s*=\s*null/,
    '_stopProactiveSession must null _proactiveOpenWatchdog');
});

test('_onPrimaryStall reuses the silent-fallover branch (no parallel session)', () => {
  // The stall promoter MUST stop the existing session before starting the
  // fallback wrapper, otherwise a late-arriving onOpen on the original
  // socket would race with the new session and double-bill audio.
  const body = extractBody('function _onPrimaryStall(');
  assert.match(body, /proactiveSession\.stop\(\)/,
    '_onPrimaryStall must stop the stalled session before swapping');
  assert.match(body, /fallbackTried/,
    '_onPrimaryStall must check fallbackTried to prevent double-fallover');
  assert.match(body, /_startProvider\s*\(\s*fallback\s*\)/,
    '_onPrimaryStall must launch the fallback provider via _startProvider');
});
