'use strict';
// Run with: node --test src/services/assemblyai-stream.test.js
//
// Locks in the URL/parameter contract for the AssemblyAI Universal-Streaming
// (v3) wrapper used by the proactive-listening pipeline. The wrapper's
// public surface MUST stay parallel to deepgram-stream.js so the IPC handler
// can swap providers without per-call branching, and the streaming params
// MUST stay aligned with what the renderer is actually feeding the socket
// (16-kHz mono linear-16 PCM).

const test   = require('node:test');
const assert = require('node:assert/strict');
const { mapLanguage, _buildUrl } = require('./assemblyai-stream');

test('mapLanguage: English and empty input are marked supported', () => {
  // Empty / undefined input falls back to 'en' so a missing renderer
  // language preference still produces a working session instead of
  // bailing out before the WS handshake. The wrapper now targets the
  // universal-streaming-english model — see _buildUrl tests for why.
  const expected = { language: 'en', supported: true, model: 'universal-streaming-english' };
  assert.deepEqual(mapLanguage('en'),       expected);
  assert.deepEqual(mapLanguage('EN'),       expected);
  assert.deepEqual(mapLanguage(''),         expected);
  assert.deepEqual(mapLanguage(undefined),  expected);
  assert.deepEqual(mapLanguage(null),       expected);
});

test('mapLanguage: non-English codes are flagged unsupported (English-only model)', () => {
  // universal-streaming-english is English-only by design. Non-English
  // input still produces output but quality is best-effort. The
  // descriptor exposes `supported:false` so the call site can route to
  // Deepgram for non-English users.
  for (const code of ['hi', 'fr', 'de', 'ja', 'zh', 'ar', 'te', 'xyz']) {
    const out = mapLanguage(code);
    assert.equal(out.supported, false, `${code} must be flagged unsupported`);
    assert.equal(out.model,    'universal-streaming-english');
  }
});

test('_buildUrl: defaults match the documented v3 streaming endpoint', () => {
  const url = _buildUrl();
  assert.ok(url.startsWith('wss://streaming.assemblyai.com/v3/ws?'),
    'must target the v3 streaming endpoint');
  // Required parameters baked into the wrapper. universal-streaming-english
  // emits partials word-by-word as audio is processed; u3-rt-pro emits
  // its first partial only after ~750ms of continuous speech, which made
  // the bubble feel "stuck" during streaming. Locking the model in here
  // prevents a future "let's switch to the latest" PR from silently
  // reverting the cadence fix.
  assert.match(url, /speech_model=universal-streaming-english/);
  assert.match(url, /sample_rate=16000/);
  // `format_turns` must NOT be present. universal-streaming-english
  // *does* support it, but enabling it would emit two terminal Turn
  // messages per turn_order (unformatted then formatted) — both with
  // the FULL turn transcript — causing the renderer's append-final
  // path to render the turn twice. Locking absence here prevents a
  // future "let's enable formatting" PR from regressing the cadence.
  assert.doesNotMatch(url, /format_turns=/);
});

test('_buildUrl: turn-detection params use the universal-streaming names', () => {
  // universal-streaming-english uses min_turn_silence (NOT
  // min_end_of_turn_silence_when_confident — that name is u3-rt-pro
  // specific and is silently ignored on this endpoint). Documented
  // defaults are 400ms / 0.4 / 1280ms ("balanced"); we ship slightly
  // patient values to match Deepgram's perceived end-of-turn cadence
  // without the over-conservative 0.9 threshold the previous u3-rt-pro
  // tuning forced. Locking these in stops a "param cleanup" PR from
  // silently regressing UX.
  const url = _buildUrl();
  assert.match(url, /min_turn_silence=600/);
  assert.match(url, /max_turn_silence=2400/);
  assert.match(url, /end_of_turn_confidence_threshold=0\.7/);
  // The u3-rt-pro-only param must NOT leak in.
  assert.doesNotMatch(url, /min_end_of_turn_silence_when_confident=/);
});

test('_buildUrl: caller-supplied params merge over defaults', () => {
  const url = _buildUrl({ sample_rate: '24000', custom_flag: 'yes' });
  assert.match(url, /sample_rate=24000/);
  assert.match(url, /custom_flag=yes/);
  // Original defaults that were not overridden must still be present.
  assert.match(url, /speech_model=universal-streaming-english/);
});

test('_buildUrl: parameter values are URI-encoded', () => {
  // Defensive against future params with reserved chars (e.g. a future
  // `language=zh-TW`) silently breaking the WS handshake.
  const url = _buildUrl({ tag: 'a b/c?d' });
  assert.match(url, /tag=a%20b%2Fc%3Fd/);
});
