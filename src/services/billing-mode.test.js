const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTextInputBilling } = require('./billing-mode');

test('default text-input bills 1 credit (chat)', () => {
  const r = resolveTextInputBilling({});
  assert.equal(r.skip, false);
  assert.equal(r.count, 1);
  assert.equal(r.reason, 'chat');
});

test('voiceCommit bills 2 credits (Manual mode voice answer)', () => {
  const r = resolveTextInputBilling({ voiceCommit: true });
  assert.equal(r.skip, false);
  assert.equal(r.count, 2);
  assert.equal(r.reason, 'voice-commit');
});

test('skipBilling skips deduction (Full-Auto meter covers it)', () => {
  const r = resolveTextInputBilling({ skipBilling: true });
  assert.equal(r.skip, true);
  assert.equal(r.count, 0);
  assert.equal(r.reason, 'metered');
});

test('skipBilling overrides voiceCommit (defense against ordering bugs)', () => {
  const r = resolveTextInputBilling({ skipBilling: true, voiceCommit: true });
  assert.equal(r.skip, true);
  assert.equal(r.count, 0);
});

test('falsy / missing inputs default to chat billing', () => {
  assert.equal(resolveTextInputBilling().count, 1);
  assert.equal(resolveTextInputBilling({ skipBilling: false, voiceCommit: false }).count, 1);
  assert.equal(resolveTextInputBilling({ skipBilling: undefined, voiceCommit: undefined }).count, 1);
});

test('REGRESSION: Manual mode commit must bill 2 credits, not skip', () => {
  // Bug fixed in this changeset: previously the renderer sent
  // skipBilling=!!proactiveActive on every commit, which meant Manual mode
  // (no meter) silently skipped the voice charge. Manual must now send
  // voiceCommit=true, skipBilling=false → 2 credits deducted.
  const r = resolveTextInputBilling({ voiceCommit: true, skipBilling: false });
  assert.equal(r.skip, false, 'Manual voice commits must NOT be skipped');
  assert.equal(r.count, 2, 'Manual voice commits must bill exactly 2 credits');
});

test('REGRESSION: Full-Auto commit must skip per-answer charge', () => {
  // Full-Auto runs the 6s meter; per-answer billing on top would
  // double-charge. The renderer sends skipBilling=true for these.
  const r = resolveTextInputBilling({ skipBilling: true, voiceCommit: false });
  assert.equal(r.skip, true);
  assert.equal(r.count, 0);
});
