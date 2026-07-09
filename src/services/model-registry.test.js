'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODELS,
  resolveModel,
  modelChain,
  nextFallback,
  isDeprecationError,
  callWithFallback,
} = require('./model-registry');

test('resolveModel returns registry id for known key', () => {
  assert.equal(resolveModel('CHAT_FAST'), 'gpt-4o-mini');
  assert.equal(resolveModel('TRANSCRIBE_FAST'), 'gpt-4o-mini-transcribe');
  assert.equal(resolveModel('GEMINI_VISION'), 'gemini-2.5-flash-lite');
});

test('resolveModel honours non-empty override', () => {
  assert.equal(resolveModel('CHAT_FAST', 'gpt-4.1-nano'), 'gpt-4.1-nano');
  // whitespace is trimmed; falsy/empty overrides fall through to registry
  assert.equal(resolveModel('CHAT_FAST', '  gpt-4o  '), 'gpt-4o');
  assert.equal(resolveModel('CHAT_FAST', ''), 'gpt-4o-mini');
  assert.equal(resolveModel('CHAT_FAST', null), 'gpt-4o-mini');
});

test('resolveModel throws on unknown key', () => {
  assert.throws(() => resolveModel('NOPE'), /Unknown model key/);
});

test('modelChain returns [primary, ...fallbacks]', () => {
  const chain = modelChain('CHAT_FAST');
  assert.equal(chain[0], 'gpt-4o-mini');
  assert.ok(chain.length >= 2);
  assert.ok(chain.includes('gpt-4.1-mini'));
  // gpt-3.5-turbo was removed (legacy); gpt-4.1-nano is the new last-resort
  assert.ok(!chain.includes('gpt-3.5-turbo'), 'gpt-3.5-turbo must be gone from CHAT_FAST');
  assert.ok(chain.includes('gpt-4.1-nano'), 'gpt-4.1-nano should be the last-resort fallback');
});

test('modelChain with override puts override first and de-dupes registry', () => {
  // Override matches a fallback already in the chain — must not appear twice
  const chain = modelChain('CHAT_FAST', 'gpt-4.1-mini');
  assert.equal(chain[0], 'gpt-4.1-mini');
  assert.equal(chain.filter(id => id === 'gpt-4.1-mini').length, 1);
});

test('nextFallback walks the chain and returns null at the end', () => {
  assert.equal(nextFallback('CHAT_FAST', 'gpt-4o-mini'), 'gpt-4.1-mini');
  assert.equal(nextFallback('CHAT_FAST', 'gpt-4.1-mini'), 'gpt-4.1-nano');
  assert.equal(nextFallback('CHAT_FAST', 'gpt-4.1-nano'), null); // last in chain
  assert.equal(nextFallback('CHAT_FAST', 'totally-unknown'), null);
});

test('isDeprecationError detects HTTP 404 across SDK error shapes', () => {
  assert.equal(isDeprecationError({ status: 404 }), true);
  assert.equal(isDeprecationError({ statusCode: 404 }), true);
  assert.equal(isDeprecationError({ response: { status: 404 } }), true);
  assert.equal(isDeprecationError({ status: 500 }), false);
});

test('isDeprecationError detects deprecation messages from both vendors', () => {
  // OpenAI shapes
  assert.equal(isDeprecationError({ code: 'model_not_found' }), true);
  assert.equal(isDeprecationError({ message: 'The model `gpt-4o-old` does not exist' }), true);
  assert.equal(isDeprecationError({ message: 'This model has been deprecated' }), true);
  // Gemini shapes
  assert.equal(isDeprecationError({ message: 'models/gemini-1.0-pro is not found for API version v1' }), true);
  assert.equal(isDeprecationError({ message: 'gemini-x is not supported for generateContent' }), true);
  // Negative
  assert.equal(isDeprecationError({ message: 'Rate limit exceeded' }), false);
  assert.equal(isDeprecationError(null), false);
  assert.equal(isDeprecationError(undefined), false);
});

test('callWithFallback returns on first success without rotating', async () => {
  let calls = 0;
  const result = await callWithFallback('CHAT_FAST', async (id) => {
    calls++;
    assert.equal(id, 'gpt-4o-mini');
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('callWithFallback rotates to next model on 404, fires onSwitch', async () => {
  const switches = [];
  const seen = [];
  const result = await callWithFallback(
    'CHAT_FAST',
    async (id) => {
      seen.push(id);
      if (id === 'gpt-4o-mini') {
        const e = new Error('model_not_found'); e.status = 404; throw e;
      }
      return `answered-by-${id}`;
    },
    { onSwitch: (info) => switches.push(info) },
  );
  assert.equal(result, 'answered-by-gpt-4.1-mini');
  assert.deepEqual(seen, ['gpt-4o-mini', 'gpt-4.1-mini']);
  assert.equal(switches.length, 1);
  assert.equal(switches[0].from, 'gpt-4o-mini');
  assert.equal(switches[0].to, 'gpt-4.1-mini');
});

test('callWithFallback rethrows non-deprecation errors immediately', async () => {
  let calls = 0;
  await assert.rejects(
    callWithFallback('CHAT_FAST', async () => {
      calls++;
      const e = new Error('429 rate limit'); e.status = 429; throw e;
    }),
    /rate limit/,
  );
  assert.equal(calls, 1, 'must NOT rotate to fallback for rate-limit / non-deprecation errors');
});

test('callWithFallback throws last deprecation error after exhausting chain', async () => {
  await assert.rejects(
    callWithFallback('CHAT_NANO', async () => {
      const e = new Error('model deprecated'); e.status = 404; throw e;
    }),
    /deprecated/,
  );
});

test('gemini-1.5-flash is not in any fallback chain (retired May 2025)', () => {
  const geminiKeys = ['GEMINI_CHAT', 'GEMINI_FLASH_LITE', 'GEMINI_VISION'];
  for (const key of geminiKeys) {
    const chain = modelChain(key);
    assert.ok(
      !chain.includes('gemini-1.5-flash'),
      `${key} must not contain the retired gemini-1.5-flash model`,
    );
  }
});

test('MODELS table is frozen (no accidental runtime mutation)', () => {
  assert.equal(Object.isFrozen(MODELS), true);
  // Mutating an entry's fallback array is allowed in vanilla freeze, but the
  // top-level keys are immutable — that's the contract callers depend on.
  assert.throws(() => { MODELS.NEW_KEY = { id: 'x', provider: 'openai', fallbacks: [] }; });
});
