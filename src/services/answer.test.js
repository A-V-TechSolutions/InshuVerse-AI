'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { emitDeltaSmoothly, detectDegeneracy } = require('./answer');

// Helper: collect every send('answer-part', payload) call so the assertions
// can introspect both the count of fragments and their payloads.
function makeRecorder() {
  const calls = [];
  const send = (channel, payload) => {
    calls.push({ channel, payload });
  };
  return { send, calls };
}

test('emitDeltaSmoothly passes short deltas straight through', async () => {
  const { send, calls } = makeRecorder();
  await emitDeltaSmoothly(send, 'hello world');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, 'answer-part');
  assert.equal(calls[0].payload, 'hello world');
});

test('emitDeltaSmoothly is a no-op for empty / falsy delta', async () => {
  const { send, calls } = makeRecorder();
  await emitDeltaSmoothly(send, '');
  await emitDeltaSmoothly(send, undefined);
  await emitDeltaSmoothly(send, null);
  assert.equal(calls.length, 0);
});

test('emitDeltaSmoothly splits a long delta into multiple whitespace-aligned fragments', async () => {
  const { send, calls } = makeRecorder();
  // 9 short words → ~70 chars, well over the 24-char fragment budget so it
  // must be split into at least 3 sends. Words are short enough to never
  // require a hard mid-word cut.
  const delta = 'alpha bravo charlie delta echo foxtrot golf hotel india';
  await emitDeltaSmoothly(send, delta);

  assert.ok(calls.length >= 3, `expected >=3 fragments, got ${calls.length}`);
  for (const c of calls) {
    assert.equal(c.channel, 'answer-part');
    assert.ok(c.payload.length <= 24 || /^\S+$/.test(c.payload),
      `fragment too large and not a single word: "${c.payload}"`);
  }
  // Concatenation must round-trip the original delta exactly — no characters
  // dropped, no characters duplicated.
  const joined = calls.map(c => c.payload).join('');
  assert.equal(joined, delta);
});

test('emitDeltaSmoothly preserves single oversized words via hard cut fallback', async () => {
  const { send, calls } = makeRecorder();
  // One 60-char word with no whitespace forces the hard-cut branch.
  const delta = 'x'.repeat(60);
  await emitDeltaSmoothly(send, delta);

  assert.ok(calls.length >= 2);
  const joined = calls.map(c => c.payload).join('');
  assert.equal(joined, delta);
});


test('detectDegeneracy flags the observed Gemini "I\'m not in the mood" loop', () => {
  // Real-world failure pattern from the bug report.
  const phrase = "I'm not in the mood ";
  const degenerate = phrase.repeat(20);
  assert.equal(detectDegeneracy(degenerate), true);
});

test('detectDegeneracy ignores normal prose with incidental word reuse', () => {
  const prose = 'The quick brown fox jumps over the lazy dog. The dog '
    + 'barks loudly and the fox runs quickly through the forest.';
  assert.equal(detectDegeneracy(prose), false);
});

test('detectDegeneracy returns false for short / empty / non-string input', () => {
  assert.equal(detectDegeneracy(''), false);
  assert.equal(detectDegeneracy(null), false);
  assert.equal(detectDegeneracy(undefined), false);
  assert.equal(detectDegeneracy('hi'), false);
  // Just under the minRepeat * minChunkLen floor → must not trip.
  assert.equal(detectDegeneracy('abcabc'), false);
});

test('detectDegeneracy requires the configured minimum repetition count', () => {
  const tail = 'foo bar baz ';
  // 3 copies — below the default minRepeat of 4
  assert.equal(detectDegeneracy(tail.repeat(3)), false);
  // 4 copies — at the threshold
  assert.equal(detectDegeneracy(tail.repeat(4)), true);
});
