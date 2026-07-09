'use strict';
// Run with: node --test src/services/deepgram-stream.test.js
//
// Locks in the contract of mapLanguage() so future edits to the
// language/model routing table can't silently regress the proactive
// pipeline for non-English users. Specifically:
//   • English stays on the English-tuned nova-2-general model.
//   • Every other directly-supported Nova-2 streaming language flips to
//     the base nova-2 model (nova-2-general is English-only).
//   • Codes Deepgram does not stream natively (Telugu, Tamil, Arabic, …)
//     fall through to `multi` instead of being silently transcribed as
//     English.
//   • Falsy / unknown / oddly-cased input returns a safe default.

const test   = require('node:test');
const assert = require('node:assert/strict');
const { mapLanguage } = require('./deepgram-stream');

test('English maps to en-US on the English-tuned model', () => {
  assert.deepEqual(mapLanguage('en'), { language: 'en-US', model: 'nova-2-general' });
});

test('directly-supported non-English codes use the base nova-2 model', () => {
  // Sample across the supported set; full table is exercised below.
  assert.deepEqual(mapLanguage('hi'), { language: 'hi', model: 'nova-2' });
  assert.deepEqual(mapLanguage('fr'), { language: 'fr', model: 'nova-2' });
  assert.deepEqual(mapLanguage('de'), { language: 'de', model: 'nova-2' });
  assert.deepEqual(mapLanguage('ja'), { language: 'ja', model: 'nova-2' });
  assert.deepEqual(mapLanguage('zh'), { language: 'zh', model: 'nova-2' });
});

test('every directly-supported code resolves to its own language id', () => {
  const supported = [
    'es', 'fr', 'de', 'pt', 'it', 'ru', 'zh', 'ja', 'ko', 'nl',
    'pl', 'tr', 'sv', 'da', 'fi', 'no', 'uk', 'vi', 'id', 'th',
    'ms', 'hi',
  ];
  for (const code of supported) {
    const out = mapLanguage(code);
    assert.equal(out.language, code, `language for ${code}`);
    assert.equal(out.model, 'nova-2',  `model for ${code}`);
  }
});

test('multi-fallback codes route through Deepgram multilingual mode', () => {
  const fallback = ['ar', 'te', 'kn', 'ta', 'mr', 'bn', 'gu', 'ml', 'pa', 'ur', 'bho'];
  for (const code of fallback) {
    assert.deepEqual(
      mapLanguage(code),
      { language: 'multi', model: 'nova-2' },
      `${code} should fall back to multi`
    );
  }
});

test('unknown codes default to multi rather than failing the WS handshake', () => {
  // Anything Deepgram doesn't know — including yet-to-be-added languages —
  // should still produce a valid streaming session via `multi`.
  assert.deepEqual(mapLanguage('xyz'),     { language: 'multi', model: 'nova-2' });
  assert.deepEqual(mapLanguage('klingon'), { language: 'multi', model: 'nova-2' });
  assert.deepEqual(mapLanguage('zh-TW'),   { language: 'multi', model: 'nova-2' });
});

test('falsy / non-string inputs fall back to the English default', () => {
  // Renderer occasionally hasn't loaded the language preference yet — the
  // session should still start cleanly on en-US instead of throwing.
  const expected = { language: 'en-US', model: 'nova-2-general' };
  assert.deepEqual(mapLanguage(undefined), expected);
  assert.deepEqual(mapLanguage(null),      expected);
  assert.deepEqual(mapLanguage(''),        expected);
  assert.deepEqual(mapLanguage(0),         expected);
  assert.deepEqual(mapLanguage(false),     expected);
});

test('input is trimmed and case-folded before lookup', () => {
  // Defensive — the language picker writes lower-case codes today, but a
  // future settings import could surface 'EN' or '  hi  '.
  assert.deepEqual(mapLanguage('EN'),      { language: 'en-US', model: 'nova-2-general' });
  assert.deepEqual(mapLanguage('  hi  '),  { language: 'hi',    model: 'nova-2' });
  assert.deepEqual(mapLanguage('Fr'),      { language: 'fr',    model: 'nova-2' });
  assert.deepEqual(mapLanguage('AR'),      { language: 'multi', model: 'nova-2' });
});

test('English alone uses nova-2-general; no other code does', () => {
  // Guards against a future edit that accidentally widens nova-2-general
  // to non-English codes (it is an English-only domain model).
  const englishLike = ['es', 'fr', 'hi', 'ja', 'ar', 'te', 'xyz'];
  for (const code of englishLike) {
    assert.notEqual(
      mapLanguage(code).model,
      'nova-2-general',
      `${code} must not be routed to the English-only model`
    );
  }
});
