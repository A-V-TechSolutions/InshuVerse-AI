'use strict';
// Run with: node --test src/renderer/reset-conversation.test.js
//
// Lock in the Hide Mode "ghosting" fix by asserting that resetConversation()
// in index.html still purges every renderer-scoped state buffer the fix
// relies on. The function lives in a 15K-line HTML file with renderer-only
// dependencies (DOM, Electron require, top-level let bindings), so a
// behavioral test would need a heavy jsdom + Electron mock harness. Instead
// we run a structural / contract test: parse out the resetConversation
// body and assert the required nullings + helper calls are present.
//
// If anyone removes one of these lines without removing the matching test
// here, the suite fails — preventing the ghosting regression from
// silently shipping.

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'index.html'),
  'utf8'
);

// Extract the resetConversation function body. We accept any whitespace and
// stop at the first matching closing brace at column-0 indentation that
// closes the function (the next "        }").
function extractResetConversationBody() {
  const startMarker = 'function resetConversation() {';
  const startIdx = INDEX_HTML.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'resetConversation() should be defined in index.html');

  // Walk forward counting braces from the opening { to its matching }.
  let depth = 0;
  let i = startIdx + startMarker.length - 1; // position of the opening {
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

const body = extractResetConversationBody();

test('resetConversation: function exists and has a non-trivial body', () => {
  assert.ok(body.length > 200, 'body should be substantive, not a stub');
  assert.match(body, /function resetConversation\(\)/);
});

// ── Proactive (Full-Auto) state purge ─────────────────────────────────────
// _proactiveAbandonBubble() is the canonical helper that nulls
// _proactiveBubble, _proactiveFinalText, _proactiveInterimText. Calling it
// here is what stops the bubble singleton from re-using a detached node
// after the DOM is wiped, which was the root cause of the Hide Mode
// "ghost bubbles" artifact under setContentProtection + backdrop-filter.
test('resetConversation: aborts the in-flight proactive bubble', () => {
  assert.match(body, /_proactiveAbandonBubble\(\)/,
    'must call _proactiveAbandonBubble to null _proactiveBubble + buffers');
});

test('resetConversation: clears the proactive silence timer', () => {
  // Without this, a queued auto-answer from a previous turn can fire
  // against a wiped DOM and resurrect a ghost bubble.
  assert.match(body, /_proactiveClearSilenceTimer\(\)/,
    'must call _proactiveClearSilenceTimer to drop pending auto-answers');
});

// ── Legacy streaming-transcript state purge ───────────────────────────────
test('resetConversation: nulls the legacy streaming transcript bubble', () => {
  assert.match(body, /_streamingTranscriptBubble\s*=\s*null/);
  assert.match(body, /_streamingTranscriptText\s*=\s*''/);
});

// ── AI streaming markdown state purge ─────────────────────────────────────
// streamingBuffer / streamingMessageDiv / partialLineBuffer drive the
// progressive markdown renderer. Leaving them populated after a reset
// causes the next AI delta to write into a detached node — observed as
// "ghost text" in Hide Mode where the compositor caches the stale paint.
test('resetConversation: nulls the AI streaming render state', () => {
  for (const name of [
    'streamingBuffer',
    'streamingMessageDiv',
    'streamingContentDiv',
    'partialLineBuffer',
  ]) {
    const re = new RegExp(name + '\\s*=\\s*(null|\'\'|"")');
    assert.match(body, re, name + ' must be cleared in resetConversation');
  }
});

test('resetConversation: resets the streaming-state machine', () => {
  // The markdown streaming state machine tracks fenced-code-block context
  // across deltas. A stale {inCodeBlock:true} after reset causes the next
  // AI message to start inside an open <pre> until the next ``` arrives.
  assert.match(body, /streamingState\s*=\s*\{[^}]*inCodeBlock\s*:\s*false/);
});

test('resetConversation: drops in-progress markdown block refs', () => {
  // currentUL/OL/Paragraph/CodePre/Code are append targets for streaming
  // chunks. Not nulling them here is the exact mechanism behind the
  // "list items appearing under the wrong message after reset" bug.
  assert.match(body, /currentUL\s*=\s*null/);
  assert.match(body, /currentOL\s*=\s*null/);
  assert.match(body, /currentParagraph\s*=\s*null/);
  assert.match(body, /currentCodePre\s*=\s*null/);
  assert.match(body, /currentCode\s*=\s*null/);
});

// ── DOM cleanup + compositor flush ────────────────────────────────────────
test('resetConversation: sweeps orphan quick-actions / proactive wraps', () => {
  // Belt-and-suspenders cleanup for nodes that escaped the chatMessages
  // children loop (detached but still referenced by the compositor).
  assert.match(body, /\.quick-actions/);
  assert.match(body, /\.proactive-bubble-wrap/);
});

test('resetConversation: clears suggestion chips', () => {
  assert.match(body, /clearSuggestionChips\(\)/);
});

test('resetConversation: triggers the Hide Mode compositor flush', () => {
  // The macOS/Windows compositor caches paint frames offscreen under
  // setContentProtection + backdrop-filter and fails to invalidate on
  // node removal alone. The hide-mode-flush IPC is the 1px-resize hack
  // that forces a redraw — without it, ghost bubbles linger after Reset.
  assert.match(body, /ipcRenderer\.invoke\(\s*['"]hide-mode-flush['"]\s*\)/,
    'must invoke hide-mode-flush to evict cached paint frames');
});

test('resetConversation: clears the AI conversation history', () => {
  assert.match(body, /conversationHistory\s*=\s*\[\]/);
  assert.match(body, /window\.conversationHistory\s*=\s*conversationHistory/);
});
