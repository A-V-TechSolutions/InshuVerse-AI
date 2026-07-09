'use strict';
// Run with: node --test src/services/keypool.test.js
const test   = require('node:test');
const assert = require('node:assert/strict');
const {
  KeyPool,
  SHORT_COOLDOWN_MS,
  LONG_COOLDOWN_MS,
  QUARANTINE_MS,
} = require('./keypool');

// Helper: stub Date.now so cooldown expiry is deterministic.
function withFakeNow(fn) {
  const realNow = Date.now;
  let t = 1_700_000_000_000;
  Date.now = () => t;
  try { return fn({ advance: (ms) => { t += ms; } }); }
  finally { Date.now = realNow; }
}

test('addKey + acquireKey: round-robin across healthy keys', () => {
  const p = new KeyPool();
  p.addKey({ provider: 'openai', org: 'org-a', id: 'k1', value: 'v1' });
  p.addKey({ provider: 'openai', org: 'org-a', id: 'k2', value: 'v2' });
  p.addKey({ provider: 'openai', org: 'org-a', id: 'k3', value: 'v3' });
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(p.acquireKey({ provider: 'openai', org: 'org-a' }).id);
  assert.deepEqual(ids, ['k1', 'k2', 'k3', 'k1', 'k2', 'k3']);
});

test('acquireKey: empty/missing bucket returns null', () => {
  const p = new KeyPool();
  assert.equal(p.acquireKey({ provider: 'openai', org: 'nope' }), null);
});

test('addKey: idempotent on (bucket,id) — same id replaces, no duplicates', () => {
  const p = new KeyPool();
  p.addKey({ provider: 'gemini', org: 'free', id: 'k1', value: 'v1' });
  p.addKey({ provider: 'gemini', org: 'free', id: 'k1', value: 'v1-rotated' });
  const snap = p.snapshot()['gemini/free'];
  assert.equal(snap.length, 1);
  assert.equal(p.acquireKey({ provider: 'gemini', org: 'free' }).value, 'v1-rotated');
});

test('reportResult: 429 ladder → short → long → quarantine', () => {
  withFakeNow(({ advance: _ }) => {
    const p = new KeyPool();
    p.addKey({ provider: 'openai', org: 'org-a', id: 'k1', value: 'v1' });
    // Fail #1 → short cooldown
    p.reportResult('k1', { ok: false, errCode: 429 });
    let s = p.snapshot()['openai/org-a'][0];
    assert.equal(s.state, 'cooldown');
    assert.equal(s.until - Date.now(), SHORT_COOLDOWN_MS);
    // Fail #2 → long cooldown
    p.reportResult('k1', { ok: false, errCode: 429 });
    s = p.snapshot()['openai/org-a'][0];
    assert.equal(s.state, 'cooldown');
    assert.equal(s.until - Date.now(), LONG_COOLDOWN_MS);
    // Fail #3 → quarantine
    p.reportResult('k1', { ok: false, errCode: 429 });
    s = p.snapshot()['openai/org-a'][0];
    assert.equal(s.state, 'quarantined');
    assert.equal(s.until - Date.now(), QUARANTINE_MS);
  });
});

test('reportResult: 401/403 → immediate quarantine', () => {
  withFakeNow(() => {
    const p = new KeyPool();
    p.addKey({ provider: 'openai', org: 'org-a', id: 'k1', value: 'v1' });
    p.addKey({ provider: 'openai', org: 'org-a', id: 'k2', value: 'v2' });
    p.reportResult('k1', { ok: false, errCode: 401 });
    p.reportResult('k2', { ok: false, errCode: 403 });
    const snap = p.snapshot()['openai/org-a'];
    assert.equal(snap[0].state, 'quarantined');
    assert.equal(snap[1].state, 'quarantined');
  });
});

test('reportResult: 5xx → short cooldown only (does not escalate to quarantine)', () => {
  withFakeNow(() => {
    const p = new KeyPool();
    p.addKey({ provider: 'gemini', org: 'premium', id: 'g1', value: 'v1' });
    for (let i = 0; i < 5; i++) p.reportResult('g1', { ok: false, errCode: 503 });
    const s = p.snapshot()['gemini/premium'][0];
    assert.equal(s.state, 'cooldown');
    assert.equal(s.until - Date.now(), SHORT_COOLDOWN_MS);
  });
});

test('reportResult: ok → resets state and fail counter', () => {
  withFakeNow(() => {
    const p = new KeyPool();
    p.addKey({ provider: 'openai', org: 'org-a', id: 'k1', value: 'v1' });
    p.reportResult('k1', { ok: false, errCode: 429 });
    p.reportResult('k1', { ok: false, errCode: 429 });
    p.reportResult('k1', { ok: true });
    const s = p.snapshot()['openai/org-a'][0];
    assert.equal(s.state, 'healthy');
    assert.equal(s.fail, 0);
    assert.equal(s.until, 0);
  });
});

test('acquireKey: skips cooldown keys; returns null when all unhealthy', () => {
  withFakeNow(({ advance }) => {
    const p = new KeyPool();
    p.addKey({ provider: 'openai', org: 'org-a', id: 'k1', value: 'v1' });
    p.addKey({ provider: 'openai', org: 'org-a', id: 'k2', value: 'v2' });
    p.reportResult('k1', { ok: false, errCode: 429 });
    // k1 in cooldown — round-robin must hand out k2 only.
    assert.equal(p.acquireKey({ provider: 'openai', org: 'org-a' }).id, 'k2');
    assert.equal(p.acquireKey({ provider: 'openai', org: 'org-a' }).id, 'k2');
    p.reportResult('k2', { ok: false, errCode: 401 });
    assert.equal(p.acquireKey({ provider: 'openai', org: 'org-a' }), null);
    // After short cooldown elapses, k1 must come back; k2 still quarantined.
    advance(SHORT_COOLDOWN_MS + 1);
    assert.equal(p.acquireKey({ provider: 'openai', org: 'org-a' }).id, 'k1');
  });
});

test('removeLifetimeUser: isolates per-user pools', () => {
  const p = new KeyPool();
  p.addKey({ provider: 'openai', org: 'lifetime:userA', id: 'A-key', value: 'va' });
  p.addKey({ provider: 'gemini', org: 'lifetime:userA', id: 'A-gem', value: 'vag' });
  p.addKey({ provider: 'openai', org: 'lifetime:userB', id: 'B-key', value: 'vb' });
  p.addKey({ provider: 'openai', org: 'org-a',          id: 'sys',   value: 'vs' });

  p.removeLifetimeUser('userA');

  // Both userA buckets gone.
  assert.equal(p.acquireKey({ provider: 'openai', org: 'lifetime:userA' }), null);
  assert.equal(p.acquireKey({ provider: 'gemini', org: 'lifetime:userA' }), null);
  // userB and system pools untouched.
  assert.equal(p.acquireKey({ provider: 'openai', org: 'lifetime:userB' }).id, 'B-key');
  assert.equal(p.acquireKey({ provider: 'openai', org: 'org-a' }).id, 'sys');
  // reportResult on the removed key is a safe no-op (does not throw).
  assert.doesNotThrow(() => p.reportResult('A-key', { ok: false, errCode: 429 }));
});


// Integration-style test: mirrors main.js#withKeyRotation contract — a 401
// from the wrapped fn must quarantine the picked key, and the *next* call
// must rotate to the surviving key.
test('withKeyRotation contract: 401 from fn quarantines picked OpenAI key', () => {
  const p = new KeyPool();
  p.addKey({ provider: 'openai', org: 'org-a', id: 'k1', value: 'v1' });
  p.addKey({ provider: 'openai', org: 'org-a', id: 'k2', value: 'v2' });

  // Local replica of main.js helpers — keep in sync if those change.
  function _extractErrorStatus(err) {
    if (!err) return 0;
    if (typeof err.status === 'number') return err.status;
    if (typeof err.statusCode === 'number') return err.statusCode;
    if (err.response && typeof err.response.status === 'number') return err.response.status;
    const m = String(err.message || err).match(/\b(401|403|404|408|429|500|502|503|504)\b/);
    return m ? Number(m[1]) : 0;
  }
  async function withKeyRotation(fn) {
    const picked = p.acquireKey({ provider: 'openai', org: 'org-a' });
    try {
      const result = await fn({ userOpenAIKey: picked && picked.value });
      if (picked) p.reportResult(picked.id, { ok: true });
      return { result, pickedId: picked && picked.id };
    } catch (err) {
      const code = _extractErrorStatus(err);
      if (picked) p.reportResult(picked.id, { ok: false, errCode: code });
      throw Object.assign(err, { _pickedId: picked && picked.id });
    }
  }

  return (async () => {
    // First call: fn throws 401 → picked key must be quarantined.
    let firstPickedId = null;
    try {
      await withKeyRotation(async () => {
        const e = new Error('Unauthorized');
        e.status = 401;
        throw e;
      });
      assert.fail('expected withKeyRotation to rethrow');
    } catch (err) {
      firstPickedId = err._pickedId;
      assert.ok(firstPickedId, 'pickedId must be set on the rethrown error');
    }

    // Second call: fn succeeds. Acquire MUST rotate to the surviving key.
    const { pickedId: secondPickedId } = await withKeyRotation(async () => 'ok');
    assert.notEqual(secondPickedId, firstPickedId,
      'withKeyRotation must skip the quarantined key and rotate to the survivor');

    // And the original key must stay unhealthy until quarantine elapses.
    const stillBlocked = p.acquireKey({ provider: 'openai', org: 'org-a' });
    // We have only 2 keys; with one quarantined, the survivor is round-robined.
    assert.equal(stillBlocked.id, secondPickedId,
      'quarantined key must NOT be re-acquired while still in quarantine');
  })();
});

// Integration-style test: mirrors main.js#withKeyRotation's NEW internal
// retry loop. On a transient 429 the failed key is cooled down and a second
// attempt MUST acquire a different (still-healthy) key — the user perceives
// one continuous request even when the first key hits its quota mid-flight.
// Auth (401/403) and other deterministic 4xx must NOT consume a second
// attempt because retrying with a rotated key would not change the outcome.
test('withKeyRotation retry: 429 transient triggers a second attempt with a rotated key', () => {
  const p = new KeyPool();
  p.addKey({ provider: 'openai', org: 'org-a', id: 'k1', value: 'v1' });
  p.addKey({ provider: 'openai', org: 'org-a', id: 'k2', value: 'v2' });

  const RETRY_CODES = new Set([0, 408, 429, 500, 502, 503, 504]);
  const MAX_ATTEMPTS = 2;

  function _extractErrorStatus(err) {
    if (!err) return 0;
    if (typeof err.status === 'number') return err.status;
    const m = String(err.message || err).match(/\b(401|403|404|408|429|500|502|503|504)\b/);
    return m ? Number(m[1]) : 0;
  }

  // Replica of main.js's _runKeyRotationOnce + retry loop.
  async function withKeyRotation(fn) {
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const picked = p.acquireKey({ provider: 'openai', org: 'org-a' });
      try {
        const result = await fn({ userOpenAIKey: picked && picked.value, _attempt: attempt });
        if (picked) p.reportResult(picked.id, { ok: true });
        return { result, pickedId: picked && picked.id, attempts: attempt };
      } catch (err) {
        const code = _extractErrorStatus(err);
        if (picked) p.reportResult(picked.id, { ok: false, errCode: code });
        lastErr = err;
        if (!RETRY_CODES.has(code)) break;
        if (attempt >= MAX_ATTEMPTS) break;
      }
    }
    throw lastErr;
  }

  return (async () => {
    const seen = [];
    const out = await withKeyRotation(async ({ userOpenAIKey, _attempt }) => {
      seen.push(userOpenAIKey);
      if (_attempt === 1) {
        const e = new Error('Too Many Requests');
        e.status = 429;
        throw e;
      }
      return 'ok';
    });

    assert.equal(out.attempts, 2, 'must retry exactly once on 429');
    assert.notEqual(seen[0], seen[1],
      'second attempt must use a DIFFERENT key — rotated by the cooldown');
    assert.equal(out.result, 'ok');
  })();
});

test('withKeyRotation retry: 401 auth error does NOT trigger a second attempt', () => {
  const p = new KeyPool();
  p.addKey({ provider: 'openai', org: 'org-a', id: 'k1', value: 'v1' });
  p.addKey({ provider: 'openai', org: 'org-a', id: 'k2', value: 'v2' });

  const RETRY_CODES = new Set([0, 408, 429, 500, 502, 503, 504]);
  const MAX_ATTEMPTS = 2;
  function _extractErrorStatus(err) {
    if (typeof err.status === 'number') return err.status;
    return 0;
  }
  async function withKeyRotation(fn) {
    let lastErr, attempts = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      attempts = attempt;
      const picked = p.acquireKey({ provider: 'openai', org: 'org-a' });
      try {
        const result = await fn({ userOpenAIKey: picked && picked.value });
        if (picked) p.reportResult(picked.id, { ok: true });
        return { result, attempts };
      } catch (err) {
        const code = _extractErrorStatus(err);
        if (picked) p.reportResult(picked.id, { ok: false, errCode: code });
        lastErr = err;
        if (!RETRY_CODES.has(code)) break;
        if (attempt >= MAX_ATTEMPTS) break;
      }
    }
    const out = new Error('exhausted'); out._cause = lastErr; out._attempts = attempts;
    throw out;
  }

  return (async () => {
    let thrown;
    try {
      await withKeyRotation(async () => {
        const e = new Error('Unauthorized'); e.status = 401; throw e;
      });
    } catch (err) { thrown = err; }
    assert.ok(thrown, 'must propagate the auth error');
    assert.equal(thrown._attempts, 1,
      '401 must short-circuit the retry loop after the first attempt');
  })();
});
